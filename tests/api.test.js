import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app.js';
import { loadConfig } from '../lib/config.js';
import { FirebaseStore } from '../lib/store.js';
import { HttpError } from '../lib/errors.js';
import { MemoryDB } from './helpers.js';
const db = new MemoryDB(),
  store = new FirebaseStore(db, { destroy: async () => {} });
let blocked = false,
  revoked = false,
  server,
  origin;
const services = {
  store,
  photos: {
    ticket: async (c, uid, type, size) => ({
      collection: c,
      uid,
      contentType: type,
      size,
      ticketId: 'permit',
      storagePath: 'path',
    }),
  },
  auth: {
    verifyIdToken: async (token, check) => {
      revoked = check;
      if (token === 'credential-error')
        throw Object.assign(new Error('private secret'), { code: 'app/invalid-credential' });
      if (!['admin', 'teacher', 'student', 'disabled'].includes(token)) throw new Error('bad');
      return { uid: token, email: `${token}@school.example` };
    },
  },
  accounts: {
    create: async (data) => ({ id: 'created', ...data, password: undefined }),
    change: async (id, data, actor, remove) => ({ id, ...data }),
  },
  login: {
    signIn: async () => {
      if (blocked) throw new HttpError(403, 'IP_BLOCKED', 'Blocked');
      return { customToken: 'test-only-token', role: 'admin' };
    },
  },
};
store.getIpBlock = async () => blocked;
before(async () => {
  for (const role of ['admin', 'teacher', 'student', 'disabled'])
    await db
      .collection('users')
      .doc(role)
      .set({
        role: role === 'disabled' ? 'admin' : role,
        email: `${role}@school.example`,
        disabled: role === 'disabled',
      });
  server = createApp({
    config: loadConfig({
      RATE_LIMIT_SALT: 'test-only-salt',
      FB_PRIVATE_KEY: 'private-test-secret',
    }),
    getServices: () => services,
  }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((r) => server.close(r)));
async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(origin + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    headers: res.headers,
    body: res.status === 204 ? null : await res.json(),
  };
}
test('public configuration omits Admin secrets and salts', async () => {
  const res = await request('/api/config');
  assert.equal(res.status, 200);
  assert.ok(!JSON.stringify(res.body).includes('private-test-secret'));
  assert.ok(!JSON.stringify(res.body).includes('test-only-salt'));
});
test('role matrix protects every management route independently of dashboard visibility', async () => {
  const cases = [
    ['/api/messages', 'GET', ['admin', 'teacher']],
    ['/api/messages/missing', 'DELETE', ['admin']],
    ['/api/gallery', 'POST', ['admin', 'teacher', 'student']],
    ['/api/slider', 'POST', ['admin', 'teacher']],
    ['/api/gallery/missing', 'DELETE', ['admin']],
    ['/api/slider/missing', 'PATCH', ['admin']],
    ['/api/accounts', 'GET', ['admin']],
    ['/api/accounts', 'POST', ['admin']],
    ['/api/accounts/missing', 'PATCH', ['admin']],
    ['/api/accounts/missing', 'DELETE', ['admin']],
    ['/api/popups', 'POST', ['admin']],
    ['/api/popups/missing', 'DELETE', ['admin']],
    ['/api/live', 'PUT', ['admin']],
    ['/api/settings', 'PUT', ['admin']],
    ['/api/blocked-ips', 'GET', ['admin']],
    ['/api/blocked-ips', 'POST', ['admin']],
    ['/api/blocked-ips/192.0.2.1', 'DELETE', ['admin']],
    ['/api/media-heads/president', 'PUT', ['admin']],
    ['/api/media-heads/president', 'DELETE', ['admin']],
  ];
  for (const [path, method, allowed] of cases)
    for (const token of [undefined, 'student', 'teacher']) {
      if (allowed.includes(token)) continue;
      assert.equal(
        (await request(path, { method, token, ...(method === 'GET' ? {} : { body: {} }) })).status,
        token ? 403 : 401,
        `${token || 'anonymous'} ${method} ${path}`,
      );
    }
});
test('revocation and disabled profiles are checked on every staff request', async () => {
  assert.equal((await request('/api/admin/me', { token: 'admin' })).status, 200);
  assert.equal(revoked, true);
  assert.equal((await request('/api/admin/me', { token: 'disabled' })).status, 403);
  assert.equal((await request('/api/messages', { token: 'invalid' })).status, 401);
  const res = await request('/api/admin/me', { token: 'credential-error' });
  assert.equal(res.status, 503);
  assert.ok(!JSON.stringify(res.body).includes('private secret'));
});
test('feedback is private, validates only Name/Message, and persists Sinhala safely', async () => {
  const body = { name: 'සඟබෝ සිසුවා', message: '<script>alert(1)</script> ස්තුතියි!' };
  assert.equal((await request('/api/messages', { method: 'POST', body })).status, 201);
  const feedback = await request('/api/messages', { token: 'teacher' });
  assert.equal(feedback.body.items[0].message, body.message);
  assert.ok(feedback.body.items[0].createdAt);
  for (const data of [
    { name: 'x', message: 'hello' },
    { name: 'User', message: '' },
    { name: 'User', message: 'x'.repeat(2001) },
  ])
    assert.equal((await request('/api/messages', { method: 'POST', body: data })).status, 400);
  assert.equal(
    (
      await request('/api/messages', {
        method: 'POST',
        body,
        headers: { Origin: 'https://other.example' },
      })
    ).status,
    403,
  );
});
test('public and Student gallery responses omit uploader/date metadata', async () => {
  const data = {
    imageUrl: 'https://images.example/photo.jpg',
    caption: 'SCMU',
    facebookAlbumUrl: 'https://www.facebook.com/media/set/?set=a.123',
    albumTitle: 'Our event',
    postedBy: 'forged',
    createdAt: 'forged',
  };
  const added = await request('/api/gallery', { method: 'POST', token: 'student', body: data });
  assert.equal(added.status, 201);
  assert.equal(added.body.postedBy, undefined);
  for (const token of [undefined, 'student']) {
    const res = await request('/api/gallery', { token });
    assert.equal(res.body.items[0].postedBy, undefined);
    assert.equal(res.body.items[0].createdAt, undefined);
    assert.equal(res.body.items[0].storagePath, undefined);
  }
  const staff = await request('/api/gallery', { token: 'teacher' });
  assert.equal(staff.body.items[0].postedBy, 'student');
  assert.notEqual(staff.body.items[0].createdAt, 'forged');
  assert.equal(staff.body.items[0].facebookAlbumUrl, data.facebookAlbumUrl);
  assert.equal(
    (await request(`/api/gallery/${added.body.id}`, { method: 'DELETE', token: 'admin' })).status,
    204,
  );
});
test('Students upload only gallery; Teachers can upload slides; Admins upload board/events', async () => {
  for (const [token, collection, status] of [
    ['student', 'gallery', 201],
    ['student', 'slider', 403],
    ['teacher', 'slider', 201],
    ['teacher', 'popups', 403],
    ['admin', 'mediaHeads', 201],
  ])
    assert.equal(
      (
        await request('/api/uploads/ticket', {
          method: 'POST',
          token,
          body: { collection, contentType: 'image/jpeg', size: 100 },
        })
      ).status,
      status,
    );
});
test('URL and order validation prevents unsafe photos and unrelated album links', async () => {
  for (const imageUrl of [
    'javascript:alert(1)',
    'http://example.com/a.jpg',
    'https://user:secret@example.com/a.jpg',
    'https://127.0.0.1/a.jpg',
  ])
    assert.equal(
      (await request('/api/slider', { method: 'POST', token: 'admin', body: { imageUrl } })).status,
      400,
    );
  assert.equal(
    (
      await request('/api/gallery', {
        method: 'POST',
        token: 'admin',
        body: {
          imageUrl: 'https://images.example/photo.jpg',
          facebookAlbumUrl: 'https://evil.example/a',
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/slider', {
        method: 'POST',
        token: 'teacher',
        body: { imageUrl: 'https://images.example/photo.jpg', order: 1.2 },
      })
    ).status,
    400,
  );
});
test('live viewer accepts exact YouTube/Facebook videos and clears when switched off', async () => {
  const added = await request('/api/live', {
    method: 'PUT',
    token: 'admin',
    body: { platform: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ', isLive: true },
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.embedUrl, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(
    (
      await request('/api/live', {
        method: 'PUT',
        token: 'admin',
        body: {
          platform: 'youtube',
          url: 'https://evil.example/watch?v=dQw4w9WgXcQ',
          isLive: true,
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (await request('/api/live', { method: 'PUT', token: 'admin', body: { isLive: false } })).body
      .embedUrl,
    '',
  );
});
test('board positions can be edited without replacing another position', async () => {
  for (const name of ['First President', 'New President'])
    assert.equal(
      (
        await request('/api/media-heads/president', {
          method: 'PUT',
          token: 'admin',
          body: { name },
        })
      ).status,
      200,
    );
  const res = await request('/api/media-heads');
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].name, 'New President');
});
test('maintenance applies to HTML/public writes but staff login and tools remain available', async () => {
  await request('/api/settings', {
    method: 'PUT',
    token: 'admin',
    body: { maintenanceMode: true },
  });
  assert.equal((await fetch(origin)).status, 503);
  assert.equal((await fetch(`${origin}/login/index.html`)).status, 200);
  assert.equal((await request('/api/gallery')).status, 503);
  assert.equal((await request('/api/gallery', { token: 'teacher' })).status, 200);
  assert.equal(
    (await request('/api/messages', { method: 'POST', body: { name: 'User', message: 'Hello' } }))
      .status,
    503,
  );
  await request('/api/settings', {
    method: 'PUT',
    token: 'admin',
    body: { maintenanceMode: false },
  });
});
test('blocked IP cannot load staff HTML or use APIs, but public pages remain accessible', async () => {
  blocked = true;
  try {
    assert.equal((await fetch(`${origin}/login/index.html`)).status, 403);
    assert.equal((await fetch(`${origin}/admin/index.html`)).status, 403);
    assert.equal((await request('/api/admin/me', { token: 'admin' })).status, 403);
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await request('/api/gallery')).status, 200);
  } finally {
    blocked = false;
  }
});
test('security headers, cache controls, body bounds and environment-file isolation', async () => {
  const home = await fetch(origin);
  assert.ok(home.headers.get('content-security-policy').includes("script-src 'self'"));
  assert.equal(home.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${origin}/.env`)).status, 404);
  assert.equal(
    (
      await request('/api/messages', {
        method: 'POST',
        body: { name: 'User', message: 'x'.repeat(30_000) },
      })
    ).status,
    413,
  );
});
