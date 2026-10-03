import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError } from './errors.js';
import * as validate from './validation.js';
import { validatePublicId } from './photos.js';

const publicPath = fileURLToPath(new URL('../public/', import.meta.url));
export function createApp({ config, getServices }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'https:', 'blob:'],
          connectSrc: [
            "'self'",
            'https://*.googleapis.com',
            'https://*.firebaseio.com',
            'https://api.cloudinary.com',
          ],
          frameSrc: ["'self'", 'https://*.firebaseapp.com'],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '16kb', strict: true }));
  // Bearer tokens are never sent via cookies; this additionally restricts browser writes.
  app.use('/api', (req, res, next) => {
    if (['POST', 'DELETE', 'PATCH', 'PUT'].includes(req.method) && req.get('origin')) {
      const expected = config.publicSiteUrl
        ? new URL(config.publicSiteUrl).origin
        : `${req.protocol}://${req.get('host')}`;
      if (req.get('origin') !== expected)
        return next(
          new HttpError(403, 'ORIGIN_DENIED', 'This request is not allowed from this website.'),
        );
    }
    next();
  });
  const burstGuard = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again in a minute.' },
    },
  });
  app.use('/api', burstGuard);

  async function requireAdmin(req, res, next) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('authorization') || '');
    if (!match) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    let decoded;
    const { auth } = getServices();
    try {
      decoded = await auth.verifyIdToken(match[1], true);
    } catch (error) {
      // Log only the SDK code: never log bearer tokens or credential contents.
      const code = typeof error.code === 'string' ? error.code : 'unknown';
      console.error('Firebase ID token verification failed:', code);
      if (
        [
          'app/invalid-credential',
          'app/network-error',
          'auth/internal-error',
          'auth/insufficient-permission',
          'auth/invalid-credential',
        ].includes(code)
      ) {
        throw new HttpError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'The server could not verify your login. Please contact SCMU to check the Firebase server credentials.',
        );
      }
      throw new HttpError(401, 'INVALID_TOKEN', 'Your session has expired. Please sign in again.');
    }
    if (decoded.admin !== true)
      throw new HttpError(
        403,
        'ADMIN_REQUIRED',
        'This account does not have administrator access.',
      );
    req.admin = decoded;
    next();
  }
  app.get('/api/config', (req, res) => res.json(config.public));
  app.get('/api/health', (req, res) =>
    res.json({
      status: 'ok',
      firebaseConfigured: config.configured,
      uploadsConfigured: config.cloudinary.configured,
    }),
  );
  app.post('/api/messages', async (req, res) => {
    const data = {
      name: validate.text(req.body?.name, 'Name', 2, 80),
      message: validate.text(req.body?.message, 'Message', 3, 2000),
    };
    const key = createHmac('sha256', config.rateLimitSalt || 'unconfigured')
      .update(`messages:${req.ip}`)
      .digest('hex');
    const result = await getServices().store.submitMessage(data, key);
    res.status(201).json({ id: result.id, message: 'Thank you. Your message has been received.' });
  });
  app.get('/api/messages', requireAdmin, async (req, res) =>
    res.json(await getServices().store.list('messages', validate.pagination(req.query))),
  );
  app.delete('/api/messages/:id', requireAdmin, async (req, res) => {
    await getServices().store.remove('messages', validate.id(req.params.id));
    res.status(204).end();
  });
  app.get('/api/gallery', async (req, res) =>
    res.json(await getServices().store.list('gallery', validate.pagination(req.query))),
  );
  app.get('/api/slider', async (req, res) => res.json(await getServices().store.getSlider()));
  app.get('/api/admin/me', requireAdmin, (req, res) =>
    res.json({ uid: req.admin.uid, email: req.admin.email || '' }),
  );
  app.get('/api/admin/stats', requireAdmin, async (req, res) =>
    res.json(await getServices().store.stats()),
  );
  app.post('/api/uploads/sign', requireAdmin, (req, res) => {
    const collection = req.body?.collection;
    if (!['gallery', 'slider'].includes(collection))
      throw new HttpError(400, 'VALIDATION_ERROR', 'Choose gallery or slider.');
    res.json(getServices().photos.signUpload(collection, req.admin.uid));
  });
  for (const collection of ['gallery', 'slider']) {
    app.post(`/api/${collection}`, requireAdmin, async (req, res) => {
      const body = req.body || {};
      const upload =
        body.publicId !== undefined
          ? validatePublicId(body.publicId, collection, req.admin.uid)
          : null;
      if (collection === 'gallery' && !upload)
        throw new HttpError(400, 'VALIDATION_ERROR', 'Upload a photo to the gallery first.');
      if (upload && body.imageUrl)
        throw new HttpError(400, 'VALIDATION_ERROR', 'Provide an upload or a URL, not both.');
      const data =
        collection === 'gallery'
          ? { caption: validate.text(body.caption ?? '', 'Caption', 0, 300) }
          : { order: validate.order(body.order ?? 0) };
      if (!upload) data.imageUrl = validate.imageUrl(body.imageUrl);
      res.status(201).json(await getServices().store.addImage(collection, data, upload));
    });
    app.delete(`/api/${collection}/:id`, requireAdmin, async (req, res) => {
      await getServices().store.remove(collection, validate.id(req.params.id));
      res.status(204).end();
    });
  }
  app.patch('/api/slider/:id', requireAdmin, async (req, res) => {
    await getServices().store.setSliderOrder(
      validate.id(req.params.id),
      validate.order(req.body?.order),
    );
    res.status(204).end();
  });
  app.use('/api', (req, res, next) =>
    next(new HttpError(404, 'NOT_FOUND', 'API endpoint not found.')),
  );
  app.get('/gallery', (req, res) => res.sendFile(path.join(publicPath, 'gallery.html')));
  app.get('/contact', (req, res) => res.sendFile(path.join(publicPath, 'contact.html')));
  app.use(
    express.static(publicPath, {
      dotfiles: 'deny',
      maxAge: config.production ? '1h' : 0,
      setHeaders: (res, file) => {
        if (file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      },
    }),
  );
  app.use((req, res) => res.status(404).sendFile(path.join(publicPath, '404.html')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    const known = error instanceof HttpError;
    if (!known && status >= 500)
      console.error(
        JSON.stringify({
          requestId: req.requestId,
          code: error.code || 'INTERNAL_ERROR',
          message: error.message,
        }),
      );
    let message = known ? error.message : 'Something went wrong. Please try again.';
    let code = known ? error.code : 'INTERNAL_ERROR';
    if (error.type === 'entity.parse.failed') {
      message = 'Send a valid JSON request.';
      code = 'INVALID_JSON';
    }
    if (error.type === 'entity.too.large') {
      message = 'The request is too large.';
      code = 'PAYLOAD_TOO_LARGE';
    }
    res.status(status).json({ error: { code, message, requestId: req.requestId } });
  });
  return app;
}
