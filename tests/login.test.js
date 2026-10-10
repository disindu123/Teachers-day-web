import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDB } from './helpers.js';
import { FirebaseStore } from '../lib/store.js';
import { LoginService } from '../lib/login.js';
import { Timestamp } from 'firebase-admin/firestore';
import { ipKey } from '../lib/store.js';
const ip = '192.0.2.7';
function setup() {
  const db = new MemoryDB(),
    store = new FirebaseStore(db, {});
  const auth = {
    verifyIdToken: async () => ({ uid: 'staff' }),
    createCustomToken: async () => 'custom-token',
  };
  return { db, store, auth };
}
test('ten server-verified invalid passwords persist an IP block; unblocking clears attempts', async () => {
  const { store, auth } = setup();
  const login = new LoginService(store, auth, 'test-key', async () => ({
    ok: false,
    json: async () => ({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }),
  }));
  for (let i = 0; i < 10; i++)
    await assert.rejects(login.signIn(ip, 'staff@school.example', 'wrong'), {
      code: 'INVALID_CREDENTIALS',
    });
  assert.equal(await store.getIpBlock(ip), true);
  await assert.rejects(login.signIn(ip, 'staff@school.example', 'anything'), {
    code: 'IP_BLOCKED',
  });
  await store.unblockIp(ip);
  assert.equal(await store.getIpBlock(ip), false);
  await store.beginLogin(ip, 'new');
  assert.equal(await store.finishLogin(ip, 'new', 'invalid'), true);
});
test('concurrent guesses cannot race the count or release another request lease', async () => {
  const { store } = setup();
  await store.beginLogin(ip, 'first');
  await assert.rejects(store.beginLogin(ip, 'second'), { code: 'LOGIN_BUSY' });
  assert.equal(await store.finishLogin(ip, 'second', 'success'), false);
  await store.finishLogin(ip, 'first', 'invalid');
  await store.beginLogin(ip, 'third');
});
test('provider outages release the lease without recording invalid passwords', async () => {
  const { db, store, auth } = setup();
  const login = new LoginService(store, auth, 'test-key', async () => {
    throw new Error('network');
  });
  await assert.rejects(login.signIn(ip, 'staff@school.example', 'password'), {
    code: 'AUTH_SERVICE_UNAVAILABLE',
  });
  assert.equal((await db.collection('_loginAttempts').doc(ipKey(ip)).get()).data().failures, 0);
  await store.beginLogin(ip, 'retry');
});
test('successful login resets attempts only after Firebase verification and staff authorisation', async () => {
  const { db, store, auth } = setup();
  await db
    .collection('users')
    .doc('staff')
    .set({ email: 'staff@school.example', role: 'teacher', disabled: false });
  await store.beginLogin(ip, 'fail');
  await store.finishLogin(ip, 'fail', 'invalid');
  const login = new LoginService(store, auth, 'key', async () => ({
    ok: true,
    json: async () => ({ idToken: 'verified-by-firebase' }),
  }));
  assert.deepEqual(await login.signIn(ip, 'staff@school.example', 'SCMU password'), {
    customToken: 'custom-token',
    role: 'teacher',
  });
  assert.equal((await db.collection('_loginAttempts').doc(ipKey(ip)).get()).exists, false);
});
test('expired attempt windows reset; blocked addresses stay blocked', async () => {
  const { db, store } = setup();
  await db
    .collection('_loginAttempts')
    .doc(ipKey(ip))
    .set({
      failures: 9,
      windowUntil: Timestamp.fromMillis(0),
      leaseUntil: Timestamp.fromMillis(0),
    });
  await store.beginLogin(ip, 'fresh');
  await store.finishLogin(ip, 'fresh', 'invalid');
  assert.equal(await store.getIpBlock(ip), false);
  await store.blockIp(ip, 'Manual block');
  await assert.rejects(store.beginLogin(ip, 'again'), { code: 'IP_BLOCKED' });
});
