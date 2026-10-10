import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { StoragePhotos, MAX_IMAGE_BYTES } from '../lib/photos.js';
import { FirebaseStore } from '../lib/store.js';
import { MemoryDB } from './helpers.js';
function setup() {
  const db = new MemoryDB(),
    files = new Map(),
    deleted = [];
  const bucket = {
    name: 'test.firebasestorage.app',
    file: (path) => ({
      getMetadata: async () => {
        if (!files.has(path)) throw { code: 404 };
        return [files.get(path).metadata];
      },
      download: async () => [files.get(path).bytes],
      setMetadata: async (data) => Object.assign(files.get(path).metadata, data),
      delete: async () => {
        deleted.push(path);
        files.delete(path);
      },
    }),
  };
  return { db, files, deleted, photos: new StoragePhotos(db, bucket) };
}
async function uploaded(ctx, collection = 'gallery', uid = 'owner') {
  const ticket = await ctx.photos.ticket(collection, uid, 'image/png', 12);
  ctx.files.set(ticket.storagePath, {
    metadata: { contentType: 'image/png', size: 12 },
    bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  });
  return ticket;
}
test('upload permits restrict MIME/size and are single-use and owned', async () => {
  const ctx = setup();
  for (const [type, size] of [
    ['image/svg+xml', 12],
    ['image/jpeg', 0],
    ['image/png', MAX_IMAGE_BYTES + 1],
  ])
    await assert.rejects(ctx.photos.ticket('gallery', 'owner', type, size), {
      code: 'INVALID_IMAGE',
    });
  const ticket = await uploaded(ctx);
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'other'), {
    code: 'INVALID_UPLOAD',
  });
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'slider', 'owner'), {
    code: 'INVALID_UPLOAD',
  });
  const inspected = await ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner');
  assert.ok(inspected.imageUrl.startsWith('https://firebasestorage.googleapis.com/'));
  assert.equal(inspected.storagePath, ticket.storagePath);
});
test('server checks binary signatures and metadata before publication', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx);
  ctx.files.get(ticket.storagePath).bytes = Buffer.from('<svg onload="evil()">');
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner'), {
    code: 'INVALID_IMAGE',
  });
  ctx.files.get(ticket.storagePath).metadata.size = 100;
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner'), {
    code: 'INVALID_IMAGE',
  });
});
test('expired uploads cannot be published; unavailable Storage fails closed', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx);
  await ctx.db
    .collection('_uploads')
    .doc(ticket.ticketId)
    .update({ expiresAt: Timestamp.fromMillis(0) });
  await assert.rejects(ctx.photos.inspect(ticket.ticketId, 'gallery', 'owner'), {
    code: 'UPLOAD_EXPIRED',
  });
  await assert.rejects(
    new StoragePhotos(ctx.db, null).ticket('gallery', 'owner', 'image/png', 12),
    { code: 'STORAGE_NOT_CONFIGURED' },
  );
});
test('registration is idempotent and cannot reuse an upload for another document', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx),
    store = new FirebaseStore(ctx.db, ctx.photos);
  const image = await store.prepareImage('gallery', { ticketId: ticket.ticketId }, 'owner');
  const first = await store.saveContent('gallery', { caption: 'First' }, image);
  const second = await store.saveContent('gallery', { caption: 'Changed' }, image);
  assert.equal(first.id, second.id);
  assert.equal(second.caption, 'First');
  await assert.rejects(store.saveContent('gallery', {}, image, 'different'), {
    code: 'UPLOAD_EXPIRED',
  });
  assert.equal((await ctx.db.collection('gallery').get()).size, 1);
});
test('editing a board contact retains its managed image; replacing it removes the old upload', async () => {
  const ctx = setup(),
    ticket = await uploaded(ctx, 'mediaHeads'),
    store = new FirebaseStore(ctx.db, ctx.photos);
  const image = await store.prepareImage(
    'mediaHeads',
    { ticketId: ticket.ticketId },
    'owner',
    true,
    'photoUrl',
  );
  const first = await store.saveContent('mediaHeads', { name: 'President' }, image, 'president');
  const keep = await store.prepareImage(
    'mediaHeads',
    { photoUrl: first.photoUrl },
    'owner',
    true,
    'photoUrl',
  );
  await store.saveContent('mediaHeads', { name: 'Edited President' }, keep, 'president');
  assert.deepEqual(ctx.deleted, []);
  assert.equal((await store.getItem('mediaHeads', 'president')).storagePath, ticket.storagePath);
  await store.saveContent(
    'mediaHeads',
    { name: 'New President' },
    { imageUrl: 'https://example.com/new.jpg', storagePath: '' },
    'president',
  );
  assert.deepEqual(ctx.deleted, [ticket.storagePath]);
});
test('failed Storage deletion retains metadata; external URLs are never deleted from a provider', async () => {
  const ctx = setup(),
    store = new FirebaseStore(ctx.db, ctx.photos);
  await ctx.db
    .collection('gallery')
    .doc('owned')
    .set({ storagePath: 'uploads/gallery/owner/photo.png' });
  ctx.photos.destroy = async () => {
    throw new Error('unavailable');
  };
  await assert.rejects(store.remove('gallery', 'owned'), /unavailable/);
  assert.equal((await ctx.db.collection('gallery').doc('owned').get()).exists, true);
  await ctx.db
    .collection('gallery')
    .doc('external')
    .set({ imageUrl: 'https://example.com/photo.jpg' });
  await store.remove('gallery', 'external');
  assert.equal((await ctx.db.collection('gallery').doc('external').get()).exists, false);
});
