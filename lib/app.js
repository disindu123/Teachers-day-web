import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { HttpError } from './errors.js';
import * as v from './validation.js';

const publicPath = fileURLToPath(new URL('../public/', import.meta.url));
const HEAD_ROLES = {
  president: 'President',
  secretary: 'Secretary',
  'vice-president': 'V.President',
  'vice-secretary': 'V.Secretary',
  treasurer: 'Treasurer',
};
export const privateGallery = (item, role) =>
  ['admin', 'teacher'].includes(role)
    ? item
    : Object.fromEntries(
        ['id', 'imageUrl', 'caption', 'albumTitle', 'facebookAlbumUrl']
          .filter((key) => item[key] !== undefined)
          .map((key) => [key, item[key]]),
      );
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
          scriptSrcAttr: ["'none'"],
          styleSrc: ["'self'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'https:', 'blob:'],
          connectSrc: ["'self'", 'https://*.googleapis.com', 'https://*.firebaseio.com'],
          frameSrc: [
            "'self'",
            'https://*.firebaseapp.com',
            'https://www.youtube-nocookie.com',
            'https://www.facebook.com',
          ],
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
    req.clientIp = v.ip(req.ip);
    next();
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '24kb', strict: true }));
  app.use('/api', (req, res, next) => {
    if (['POST', 'DELETE', 'PATCH', 'PUT'].includes(req.method)) {
      if (!req.is('application/json') && Number(req.get('content-length') || 0) > 0)
        throw new HttpError(415, 'JSON_REQUIRED', 'Send JSON content.');
      if (req.get('origin')) {
        const expected = config.publicSiteUrl
          ? new URL(config.publicSiteUrl).origin
          : `${req.protocol}://${req.get('host')}`;
        if (![expected, ...config.allowedOrigins].includes(req.get('origin')))
          throw new HttpError(
            403,
            'ORIGIN_DENIED',
            'This request is not allowed from this website.',
          );
      }
    }
    next();
  });
  // Burst protection is per process; important limits below are Firestore transactions.
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a minute.' },
      },
    }),
  );
  const tokenMiddleware = async (req, res, next) => {
    const header = req.get('authorization');
    if (!header) return next();
    const match = /^Bearer ([^\s]{1,8192})$/i.exec(header);
    if (!match) throw new HttpError(401, 'INVALID_TOKEN', 'Please sign in again.');
    let decoded;
    try {
      decoded = await getServices().auth.verifyIdToken(match[1], true);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (
        [
          'app/invalid-credential',
          'app/network-error',
          'auth/internal-error',
          'auth/insufficient-permission',
        ].includes(e.code)
      )
        throw new HttpError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'The server could not verify your login.',
        );
      throw new HttpError(401, 'INVALID_TOKEN', 'Your session has expired. Please sign in again.');
    }
    req.staff = await getServices().store.profile(decoded);
    next();
  };
  app.use('/api', tokenMiddleware);
  const role =
    (...roles) =>
    async (req, res, next) => {
      if (!req.staff) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in to continue.');
      if (!roles.includes(req.staff.role))
        throw new HttpError(403, 'ROLE_REQUIRED', 'Your role cannot perform this action.');
      if (await getServices().store.getIpBlock(req.clientIp))
        throw new HttpError(
          403,
          'IP_BLOCKED',
          'Staff access from this IP is blocked. Contact SCMU.',
        );
      next();
    };
  const admin = role('admin'),
    staff = role('admin', 'teacher', 'student'),
    teacher = role('admin', 'teacher');
  async function settings() {
    try {
      return await getServices().store.getSettings();
    } catch (e) {
      if (e.code === 'FIREBASE_NOT_CONFIGURED' && !config.production)
        return { maintenanceMode: false };
      throw e;
    }
  }
  const publicAvailable = async (req, res, next) => {
    if (!req.staff && (await settings()).maintenanceMode)
      throw new HttpError(
        503,
        'MAINTENANCE',
        'SCMU is updating the website. Please visit again soon.',
      );
    next();
  };
  app.get('/api/config', (req, res) => res.json(config.public));
  app.get('/api/health', (req, res) =>
    res.json({
      status: 'ok',
      firebaseConfigured: config.configured,
      uploadsConfigured: config.public.uploadsConfigured,
    }),
  );
  app.get('/api/auth/status', async (req, res) => {
    res.json({ blocked: await getServices().store.getIpBlock(req.clientIp) });
  });
  app.post('/api/auth/login', async (req, res) => {
    const email = v.email(req.body?.email);
    // Legacy Firebase passwords remain usable; new accounts use stronger validation.
    const password = req.body?.password;
    if (typeof password !== 'string' || !password.length || password.length > 128)
      v.bad('Enter your SCMU password.');
    res.json(await getServices().login.signIn(req.clientIp, email, password));
  });
  app.get('/api/admin/me', staff, (req, res) => res.json({ ...req.staff, ip: req.clientIp }));
  app.get('/api/admin/stats', staff, async (req, res) =>
    res.json(await getServices().store.stats(req.staff.role)),
  );
  app.post('/api/messages', publicAvailable, async (req, res) => {
    const data = {
      name: v.text(req.body?.name, 'Name', 2, 80),
      message: v.text(req.body?.message, 'Message', 3, 2000),
    };
    const key = createHmac('sha256', config.rateLimitSalt || 'unconfigured')
      .update(`messages:${req.clientIp}`)
      .digest('hex');
    const result = await getServices().store.submitMessage(data, key);
    res.status(201).json({
      id: result.id,
      message: 'Thank you. Your message has been received privately by SCMU.',
    });
  });
  app.get('/api/messages', teacher, async (req, res) =>
    res.json(await getServices().store.list('messages', v.pagination(req.query))),
  );
  app.delete('/api/messages/:id', admin, async (req, res) => {
    await getServices().store.remove('messages', v.id(req.params.id));
    res.status(204).end();
  });
  app.get('/api/gallery', publicAvailable, async (req, res) => {
    const result = await getServices().store.list('gallery', v.pagination(req.query));
    res.json({
      ...result,
      items: result.items.map((item) => privateGallery(item, req.staff?.role)),
    });
  });
  app.get('/api/slider', publicAvailable, async (req, res) => {
    const result = await getServices().store.getSlider();
    res.json({
      items: result.items.map((item) =>
        ['admin', 'teacher'].includes(req.staff?.role)
          ? item
          : {
              id: item.id,
              imageUrl: item.imageUrl,
              order: item.order,
              caption: item.caption || '',
            },
      ),
    });
  });
  app.post('/api/uploads/ticket', staff, async (req, res) => {
    const collection = req.body?.collection;
    const allowed =
      req.staff.role === 'admin'
        ? ['gallery', 'slider', 'popups', 'mediaHeads']
        : req.staff.role === 'teacher'
          ? ['gallery', 'slider', 'popups']
          : ['gallery', 'popups'];
    if (!allowed.includes(collection))
      throw new HttpError(403, 'ROLE_REQUIRED', 'Your role cannot upload to this section.');
    res
      .status(201)
      .json(
        await getServices().photos.ticket(
          collection,
          req.staff.uid,
          req.body.contentType,
          req.body.size,
        ),
      );
  });
  for (const collection of ['gallery', 'slider']) {
    app.post(`/api/${collection}`, collection === 'gallery' ? staff : teacher, async (req, res) => {
      const b = req.body || {};
      if (b.ticketId) v.id(b.ticketId);
      if (b.imageUrl) b.imageUrl = v.imageUrl(b.imageUrl);
      const image = await getServices().store.prepareImage(collection, b, req.staff.uid);
      const data = {
        caption: v.text(b.caption ?? '', 'Caption', 0, 300),
        postedBy: req.staff.uid,
        postedByEmail: req.staff.email,
      };
      if (collection === 'gallery') {
        data.albumTitle = v.text(b.albumTitle ?? '', 'Album title', 0, 120);
        data.facebookAlbumUrl = v.albumUrl(b.facebookAlbumUrl ?? '');
      } else data.order = v.order(b.order ?? 0);
      const item = await getServices().store.saveContent(collection, data, image);
      res.status(201).json(collection === 'gallery' ? privateGallery(item, req.staff.role) : item);
    });
    app.delete(`/api/${collection}/:id`, admin, async (req, res) => {
      await getServices().store.remove(collection, v.id(req.params.id));
      res.status(204).end();
    });
    app.patch(`/api/${collection}/:id`, admin, async (req, res) => {
      const b = req.body || {},
        data = {};
      if (b.caption !== undefined) data.caption = v.text(b.caption, 'Caption', 0, 300);
      if (collection === 'gallery') {
        if (b.albumTitle !== undefined)
          data.albumTitle = v.text(b.albumTitle, 'Album title', 0, 120);
        if (b.facebookAlbumUrl !== undefined)
          data.facebookAlbumUrl = v.albumUrl(b.facebookAlbumUrl);
      } else if (b.order !== undefined) data.order = v.order(b.order);
      if (!Object.keys(data).length) v.bad('Provide fields to update.');
      res.json(await getServices().store.patch(collection, v.id(req.params.id), data));
    });
  }
  app.get('/api/accounts', admin, async (req, res) => {
    const result = await getServices().store.list('users', v.pagination(req.query));
    res.json({ ...result, items: result.items.map(({ operationId, ...item }) => item) });
  });
  app.post('/api/accounts', admin, async (req, res) => {
    const b = req.body || {};
    res.status(201).json(
      await getServices().accounts.create({
        email: v.email(b.email),
        password: v.password(b.password),
        displayName: v.text(b.displayName ?? '', 'Name', 0, 80),
        role: v.role(b.role),
      }),
    );
  });
  app.patch('/api/accounts/:id', admin, async (req, res) => {
    const b = req.body || {},
      data = {};
    if (b.email !== undefined) data.email = v.email(b.email);
    if (b.password) data.password = v.password(b.password);
    if (b.displayName !== undefined) data.displayName = v.text(b.displayName, 'Name', 0, 80);
    if (b.role !== undefined) data.role = v.role(b.role);
    if (b.disabled !== undefined) data.disabled = v.bool(b.disabled, 'Account disabled');
    if (!Object.keys(data).length) v.bad('Provide fields to update.');
    res.json(await getServices().accounts.change(v.id(req.params.id), data, req.staff.uid));
  });
  app.delete('/api/accounts/:id', admin, async (req, res) => {
    await getServices().accounts.change(v.id(req.params.id), {}, req.staff.uid, true);
    res.status(204).end();
  });
  app.get('/api/popups', publicAvailable, async (req, res) =>
    res.json(await getServices().store.list('popups', v.pagination(req.query))),
  );
  app.post('/api/popups', staff, async (req, res) => {
    const b = req.body || {};
    if (b.ticketId) v.id(b.ticketId);
    if (b.imageUrl) b.imageUrl = v.imageUrl(b.imageUrl);
    const image = await getServices().store.prepareImage('popups', b, req.staff.uid, true);
    const item = await getServices().store.saveContent(
      'popups',
      {
        title: v.text(b.title, 'Title', 2, 120),
        message: v.text(b.message, 'Message', 1, 2000),
      },
      image,
    );
    res.status(201).json(item);
  });
  app.delete('/api/popups/:id', admin, async (req, res) => {
    await getServices().store.remove('popups', v.id(req.params.id));
    res.status(204).end();
  });
  app.patch('/api/popups/:id', admin, async (req, res) =>
    res.json(
      await getServices().store.patch('popups', v.id(req.params.id), {
        title: v.text(req.body?.title, 'Title', 2, 120),
        message: v.text(req.body?.message, 'Message', 1, 2000),
      }),
    ),
  );
  app.get('/api/live', publicAvailable, async (req, res) =>
    res.json(await getServices().store.getLive()),
  );
  app.put('/api/live', admin, async (req, res) =>
    res.json(await getServices().store.setLive(v.live(req.body || {}))),
  );
  app.get('/api/settings', async (req, res) => res.json(await settings()));
  app.put('/api/settings', admin, async (req, res) =>
    res.json(
      await getServices().store.setSettings({
        maintenanceMode: v.bool(req.body?.maintenanceMode, 'Maintenance mode'),
      }),
    ),
  );
  app.get('/api/blocked-ips', admin, async (req, res) =>
    res.json(await getServices().store.list('blockedIPs', v.pagination(req.query))),
  );
  app.post('/api/blocked-ips', admin, async (req, res) => {
    const ip = v.ip(req.body?.ip);
    if (ip === req.clientIp)
      throw new HttpError(
        409,
        'SELF_LOCKOUT',
        'You cannot block your current IP from the dashboard.',
      );
    await getServices().store.blockIp(
      ip,
      v.text(req.body?.reason ?? 'Blocked by administrator', 'Reason', 1, 300),
    );
    res.status(201).json({ ip });
  });
  app.delete('/api/blocked-ips/:ip', admin, async (req, res) => {
    await getServices().store.unblockIp(v.ip(req.params.ip));
    res.status(204).end();
  });
  app.get('/api/media-heads', publicAvailable, async (req, res) =>
    res.json(await getServices().store.getHeads()),
  );
  app.put('/api/media-heads/:role', admin, async (req, res) => {
    const headRole = HEAD_ROLES[req.params.role];
    if (!headRole) v.bad('Choose one of the five board positions.');
    const b = req.body || {};
    if (b.ticketId) v.id(b.ticketId);
    if (b.photoUrl) b.photoUrl = v.imageUrl(b.photoUrl);
    const image = await getServices().store.prepareImage(
      'mediaHeads',
      b,
      req.staff.uid,
      true,
      'photoUrl',
    );
    res.json(
      await getServices().store.saveContent(
        'mediaHeads',
        {
          role: headRole,
          name: v.text(b.name, 'Name', 2, 80),
          whatsapp: v.socialUrl(b.whatsapp, 'whatsapp'),
          facebook: v.socialUrl(b.facebook, 'facebook'),
          linkedin: v.socialUrl(b.linkedin, 'linkedin'),
          gmail: b.gmail ? v.email(b.gmail) : '',
        },
        image,
        req.params.role,
      ),
    );
  });
  app.delete('/api/media-heads/:role', admin, async (req, res) => {
    await getServices().store.remove('mediaHeads', v.id(req.params.role));
    res.status(204).end();
  });
  app.use('/api', (req, res, next) =>
    next(new HttpError(404, 'NOT_FOUND', 'API endpoint not found.')),
  );
  // All hosting targets route HTML through Express so IP and maintenance controls apply.
  app.use(async (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    if (/^\/(login|admin)(\/|$)/.test(req.path)) {
      res.set('Cache-Control', 'no-store');
      res.set('X-Robots-Tag', 'noindex, nofollow');
      try {
        if (await getServices().store.getIpBlock(req.clientIp))
          return res.status(403).sendFile(path.join(publicPath, 'blocked.html'));
      } catch (e) {
        if (e.code !== 'FIREBASE_NOT_CONFIGURED' || config.production) throw e;
      }
      return next();
    }
    if (
      /^\/(assets|css|js)(\/|$)/.test(req.path) ||
      req.path === '/robots.txt' ||
      req.path === '/sitemap.xml'
    )
      return next();
    if ((await settings()).maintenanceMode) {
      res.set('Retry-After', '600');
      res.set('Cache-Control', 'no-store');
      return res.status(503).sendFile(path.join(publicPath, 'maintenance.html'));
    }
    next();
  });
  app.get('/gallery', (req, res) => res.sendFile(path.join(publicPath, 'gallery.html')));
  app.get('/contact', (req, res) => res.sendFile(path.join(publicPath, 'contact.html')));
  app.get('/sitemap.xml', (req, res) => {
    const root = config.publicSiteUrl;
    if (!root) return res.status(404).end();
    const escaped = root.replace(
      /[<>&'"]/g,
      (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
    );
    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/gallery', '/contact'].map((p) => `<url><loc>${escaped.replace(/\/$/, '')}${p}</loc></url>`).join('')}</urlset>`,
      );
  });
  app.use(
    express.static(publicPath, {
      dotfiles: 'deny',
      maxAge: config.production ? '1h' : 0,
      setHeaders: (res, file) => {
        if (file.endsWith('.html')) res.set('Cache-Control', 'no-store');
      },
    }),
  );
  app.use((req, res) => res.status(404).sendFile(path.join(publicPath, '404.html')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = error instanceof HttpError,
      status = error.status || 500;
    if (!known && status >= 500)
      console.error(
        JSON.stringify({ requestId: req.requestId, code: error.code || 'INTERNAL_ERROR' }),
      );
    let message = known ? error.message : 'Something went wrong. Please try again.',
      code = known ? error.code : 'INTERNAL_ERROR';
    if (error.type === 'entity.parse.failed') {
      message = 'Send valid JSON.';
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
