import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { FirebaseStore } from '../lib/store.js';
import { AccountService } from '../lib/accounts.js';
let env, adminApp, db;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-scmu',
    firestore: { rules: await readFile('firestore.rules', 'utf8') },
    storage: { rules: await readFile('storage.rules', 'utf8') },
  });
  adminApp = initializeApp({ projectId: 'demo-scmu' }, 'integration');
  db = getFirestore(adminApp);
  for (const role of ['admin', 'teacher', 'student'])
    await db
      .collection('users')
      .doc(role)
      .set({ role, disabled: false, email: `${role}@school.example`, createdAt: Timestamp.now() });
});
after(async () => {
  await env?.cleanup();
  if (adminApp) await deleteApp(adminApp);
});
async function permit(role, collection = 'gallery', changes = {}) {
  const id = randomUUID(),
    storagePath = `uploads/${collection}/${role}/${id}.png`;
  await db
    .collection('_uploads')
    .doc(id)
    .set({
      uid: role,
      collection,
      storagePath,
      contentType: 'image/png',
      size: 8,
      consumed: false,
      expiresAt: Timestamp.fromMillis(Date.now() + 30_000),
      ...changes,
    });
  return storagePath;
}
const put = (role, path, bytes = new Uint8Array(8), contentType = 'image/png') =>
  env.authenticatedContext(role).storage().ref(path).put(bytes, { contentType });
test('Firestore denies all direct client reads/writes, including privileged claimed users', async () => {
  for (const context of [
    env.unauthenticatedContext(),
    env.authenticatedContext('admin', { admin: true }),
  ]) {
    await assertFails(context.firestore().collection('messages').get());
    await assertFails(context.firestore().collection('users').doc('admin').set({ role: 'admin' }));
    await assertFails(
      context.firestore().collection('gallery').add({ imageUrl: 'https://example.com' }),
    );
  }
});
test('valid role, UID and expiring upload permit allow direct Storage creation only', async () => {
  const path = await permit('student');
  await assertSucceeds(put('student', path));
  const file = env.authenticatedContext('student').storage().ref(path);
  await assertFails(file.getDownloadURL());
  await assertFails(file.delete());
  await assertFails(put('student', path));
});
test('Storage rejects anonymous uploads, forged claims, another owner, missing/expired/consumed permits, wrong size or MIME', async () => {
  const path = await permit('student');
  await assertFails(
    env
      .unauthenticatedContext()
      .storage()
      .ref(path)
      .put(new Uint8Array(8), { contentType: 'image/png' }),
  );
  await assertFails(put('teacher', path));
  await assertFails(put('student', `uploads/gallery/student/${randomUUID()}.png`));
  await assertFails(
    put('student', await permit('student', 'gallery', { expiresAt: Timestamp.fromMillis(0) })),
  );
  await assertFails(put('student', await permit('student', 'gallery', { consumed: true })));
  await assertFails(put('student', await permit('student'), new Uint8Array(9)));
  await assertFails(put('student', await permit('student'), new Uint8Array(8), 'image/svg+xml'));
  const forged = await permit('outsider');
  await assertFails(
    env
      .authenticatedContext('outsider', { admin: true, role: 'admin' })
      .storage()
      .ref(forged)
      .put(new Uint8Array(8), { contentType: 'image/png' }),
  );
});
test('Storage roles and demotion apply immediately without relying on stale custom claims', async () => {
  await assertFails(put('student', await permit('student', 'slider')));
  await assertSucceeds(put('teacher', await permit('teacher', 'slider')));
  await assertFails(put('teacher', await permit('teacher', 'popups')));
  await assertSucceeds(put('admin', await permit('admin', 'mediaHeads')));
  await db.collection('users').doc('teacher').update({ role: 'student' });
  await assertFails(put('teacher', await permit('teacher', 'slider')));
  await db.collection('users').doc('teacher').update({ role: 'teacher', disabled: true });
  await assertFails(put('teacher', await permit('teacher')));
  await db.collection('users').doc('teacher').update({ disabled: false });
});
test('real Firestore transaction blocks on tenth failure and serialises concurrent guesses', async () => {
  const store = new FirebaseStore(db, {}),
    ip = '192.0.2.91';
  for (let i = 0; i < 10; i++) {
    await store.beginLogin(ip, String(i));
    await store.finishLogin(ip, String(i), 'invalid');
  }
  assert.equal(await store.getIpBlock(ip), true);
  await assert.rejects(store.beginLogin(ip, '11'), { code: 'IP_BLOCKED' });
  await store.unblockIp(ip);
  await store.beginLogin(ip, 'one');
  await assert.rejects(store.beginLogin(ip, 'two'), { code: 'LOGIN_BUSY' });
  await store.finishLogin(ip, 'one', 'success');
});
test('real Firestore pagination, upload consumption and fixed board edits', async () => {
  const store = new FirebaseStore(db, {});
  for (let i = 0; i < 4; i++)
    await db.collection('gallery').add({
      imageUrl: 'https://example.com/image.jpg',
      createdAt: Timestamp.fromMillis(1000 + i),
    });
  const first = await store.list('gallery', { limit: 2 });
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const next = await store.list('gallery', { limit: 2, cursor: first.nextCursor });
  assert.equal(next.items.length, 2);
  assert.equal(next.nextCursor, null);
  assert.equal(new Set([...first.items, ...next.items].map((p) => p.id)).size, 4);
  const ticketId = randomUUID(),
    storagePath = `uploads/gallery/admin/${ticketId}.png`;
  await db
    .collection('_uploads')
    .doc(ticketId)
    .set({ consumed: false, expiresAt: Timestamp.fromMillis(Date.now() + 10_000) });
  const image = { ticketId, storagePath, imageUrl: 'https://example.com/managed.png' };
  const item = await store.saveContent('gallery', { caption: 'First' }, image);
  assert.equal((await store.saveContent('gallery', { caption: 'Retry' }, image)).id, item.id);
  await store.saveContent(
    'mediaHeads',
    { role: 'President', name: 'First' },
    { imageUrl: '', storagePath: '' },
    'president',
  );
  await store.saveContent(
    'mediaHeads',
    { role: 'President', name: 'Edited' },
    { imageUrl: '', storagePath: '' },
    'president',
  );
  assert.equal((await store.getHeads()).items[0].name, 'Edited');
});
test('real account transaction keeps one active administrator during concurrent deletions', async () => {
  await db.collection('users').doc('admin-two').set({ role: 'admin', disabled: false });
  const accounts = new AccountService(db, { deleteUser: async () => {} });
  const results = await Promise.allSettled([
    accounts.change('admin', {}, 'actor', true),
    accounts.change('admin-two', {}, 'actor', true),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const admins = await db.collection('users').where('role', '==', 'admin').get();
  assert.equal(admins.docs.filter((d) => !d.data().disabled).length, 1);
});
