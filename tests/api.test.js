import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../lib/app.js';
import { loadConfig } from '../lib/config.js';
import { HttpError } from '../lib/errors.js';

// Test doubles are injected only here; the application has no demo admin or bypass.
const state = { messages: [], gallery: [], slider: [], count: 0, revokedChecked: false };
const services = {
  auth: {
    async verifyIdToken(token, checkRevoked) {
      state.revokedChecked = checkRevoked;
      if (token === 'admin-token')
        return { uid: 'adminuid', email: 'admin@gmail.com', admin: true };
      if (token === 'viewer-token') return { uid: 'viewer', admin: false };
      throw new Error('Invalid token');
    },
  },
  store: {
    async submitMessage(data) {
      if (state.count++ >= 5) throw new HttpError(429, 'RATE_LIMITED', 'Please try later.');
      const item = {
        id: `message-${state.messages.length}`,
        ...data,
        createdAt: new Date().toISOString(),
      };
      state.messages.push(item);
      return item;
    },
    async list(collection, options) {
      return { items: state[collection].slice(0, options.limit), nextCursor: null };
    },
    async getSlider() {
      return { items: state.slider };
    },
    async addImage(collection, data, path) {
      const item = {
        id: `image-${state[collection].length}`,
        ...data,
        imageUrl: data.imageUrl || `https://example.com/${path}`,
      };
      state[collection].push(item);
      return item;
    },
    async remove(collection, id) {
      const index = state[collection].findIndex((item) => item.id === id);
      if (index === -1) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      state[collection].splice(index, 1);
    },
    async setSliderOrder(id, order) {
      const item = state.slider.find((item) => item.id === id);
      if (!item) throw new HttpError(404, 'NOT_FOUND', 'Not found.');
      item.order = order;
    },
    async stats() {
      return {
        messages: state.messages.length,
        gallery: state.gallery.length,
        slider: state.slider.length,
      };
    },
  },
};
let server, origin;
before(async () => {
  const config = loadConfig({
    RATE_LIMIT_SALT: 'test-only-secret',
    FB_PRIVATE_KEY: 'private-test-value',
  });
  server = createApp({ config, getServices: () => services }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  const result = await fetch(origin + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return {
    status: result.status,
    headers: result.headers,
    body: result.status === 204 ? null : await result.json(),
  };
}
test('client configuration never exposes Admin secrets', async () => {
  const result = await request('/api/config');
  assert.equal(result.status, 200);
  assert.ok(!JSON.stringify(result.body).includes('private-test-value'));
  assert.ok(!JSON.stringify(result.body).includes('test-only-secret'));
});
test('missing and invalid tokens cannot read feedback', async () => {
  assert.equal((await request('/api/messages')).status, 401);
  assert.equal((await request('/api/messages', { token: 'invalid' })).status, 401);
});
test('an authenticated non-admin cannot access any admin management route', async () => {
  for (const [path, method] of [
    ['/api/messages', 'GET'],
    ['/api/messages/x', 'DELETE'],
    ['/api/gallery', 'POST'],
    ['/api/gallery/x', 'DELETE'],
    ['/api/slider', 'POST'],
    ['/api/slider/x', 'DELETE'],
    ['/api/slider/x', 'PATCH'],
    ['/api/admin/stats', 'GET'],
  ])
    assert.equal(
      (
        await request(path, {
          method,
          token: 'viewer-token',
          ...(method === 'POST' || method === 'PATCH' ? { body: {} } : {}),
        })
      ).status,
      403,
    );
});
test('valid admin authorization asks Firebase to check token revocation', async () => {
  assert.equal((await request('/api/admin/me', { token: 'admin-token' })).status, 200);
  assert.equal(state.revokedChecked, true);
});
test('feedback accepts Sinhala and keeps HTML as inert text', async () => {
  const data = { name: 'ගුරු උපහාර', message: '<script>alert(1)</script> ස්තුතියි!' };
  const result = await request('/api/messages', { method: 'POST', body: data });
  assert.equal(result.status, 201);
  assert.equal(state.messages.at(-1).message, data.message);
});
test('invalid feedback is rejected before writing to Firestore', async () => {
  const count = state.messages.length;
  for (const body of [
    { name: 'a', message: 'hello' },
    { name: 'User', message: '' },
    { name: 'User', message: 'a'.repeat(2001) },
    { name: 12, message: 'hello' },
  ])
    assert.equal((await request('/api/messages', { method: 'POST', body })).status, 400);
  assert.equal(state.messages.length, count);
});
test('browser mutations from another origin are rejected', async () => {
  assert.equal(
    (
      await request('/api/messages', {
        method: 'POST',
        body: { name: 'User', message: 'Thank you' },
        headers: { Origin: 'https://attacker.example' },
      })
    ).status,
    403,
  );
});
test('feedback rate-limit errors propagate correctly', async () => {
  state.count = 5;
  const result = await request('/api/messages', {
    method: 'POST',
    body: { name: 'User', message: 'Thank you' },
  });
  assert.equal(result.status, 429);
  state.count = 0;
});
test('gallery upload must belong to the authenticated admin and contain an accepted extension', async () => {
  const file = '00000000-0000-4000-8000-000000000000';
  for (const storagePath of [
    `gallery/other/${file}.jpg`,
    `gallery/adminuid/${file}.svg`,
    `gallery/adminuid/../../private.jpg`,
  ])
    assert.equal(
      (
        await request('/api/gallery', {
          method: 'POST',
          token: 'admin-token',
          body: { storagePath },
        })
      ).status,
      400,
    );
});
test('admin can register an uploaded gallery image and later delete it', async () => {
  const result = await request('/api/gallery', {
    method: 'POST',
    token: 'admin-token',
    body: {
      storagePath: 'gallery/adminuid/00000000-0000-4000-8000-000000000000.jpg',
      caption: 'Thank you, teachers',
    },
  });
  assert.equal(result.status, 201);
  assert.equal(result.body.caption, 'Thank you, teachers');
  assert.equal((await request('/api/gallery')).body.items.length, 1);
  assert.equal(
    (await request(`/api/gallery/${result.body.id}`, { method: 'DELETE', token: 'admin-token' }))
      .status,
    204,
  );
});
test('slider rejects unsafe URLs and noninteger orders', async () => {
  for (const body of [
    { imageUrl: 'javascript:alert(1)', order: 0 },
    { imageUrl: 'http://example.com/image.jpg', order: 0 },
    { imageUrl: 'https://user:password@example.com/image.jpg', order: 0 },
    { imageUrl: 'https://example.com/image.jpg', order: -1 },
    { imageUrl: 'https://example.com/image.jpg', order: 1.2 },
  ])
    assert.equal(
      (await request('/api/slider', { method: 'POST', token: 'admin-token', body })).status,
      400,
    );
});
test('admin can add, reorder, and remove a URL slide', async () => {
  const result = await request('/api/slider', {
    method: 'POST',
    token: 'admin-token',
    body: { imageUrl: 'https://example.com/photo.jpg', order: 1 },
  });
  assert.equal(result.status, 201);
  assert.equal(
    (
      await request(`/api/slider/${result.body.id}`, {
        method: 'PATCH',
        token: 'admin-token',
        body: { order: 3 },
      })
    ).status,
    204,
  );
  assert.equal((await request('/api/slider')).body.items[0].order, 3);
  assert.equal(
    (await request(`/api/slider/${result.body.id}`, { method: 'DELETE', token: 'admin-token' }))
      .status,
    204,
  );
});
test('pagination limits and item IDs are bounded', async () => {
  assert.equal((await request('/api/gallery?limit=101')).status, 400);
  assert.equal(
    (await request('/api/messages/bad.id', { method: 'DELETE', token: 'admin-token' })).status,
    400,
  );
});
test('public pages include CSP and do not expose environment files', async () => {
  const home = await fetch(origin);
  assert.equal(home.status, 200);
  assert.ok(home.headers.get('content-security-policy').includes("script-src 'self'"));
  const missing = await fetch(`${origin}/.env`);
  assert.equal(missing.status, 404);
});
test('unconfigured Firebase cannot silently accept or lose messages', async () => {
  const unavailable = createApp({
    config: loadConfig({}),
    getServices: () => {
      throw new HttpError(503, 'FIREBASE_NOT_CONFIGURED', 'Service unavailable');
    },
  }).listen(0, '127.0.0.1');
  await new Promise((r) => unavailable.once('listening', r));
  try {
    const result = await fetch(`http://127.0.0.1:${unavailable.address().port}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'User', message: 'Thank you' }),
    });
    assert.equal(result.status, 503);
  } finally {
    await new Promise((r) => unavailable.close(r));
  }
});
