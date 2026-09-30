import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FirebaseStore } from '../lib/store.js';
function storeFor(header, contentType = 'image/jpeg', size = 100) {
  const bucket = {
    name: 'example.firebasestorage.app',
    file() {
      return {
        async getMetadata() {
          return [
            { contentType, size, metadata: { firebaseStorageDownloadTokens: 'download-token' } },
          ];
        },
        async download() {
          return [header];
        },
      };
    },
  };
  return new FirebaseStore(null, bucket);
}
test('uploaded photos are checked by signature, not just MIME declaration', async () => {
  const store = storeFor(Buffer.from('<svg onload="alert(1)">'));
  await assert.rejects(store.uploadedImage('gallery/user/photo.jpg'), { code: 'INVALID_IMAGE' });
});
test('oversize images are rejected before reading their bytes', async () => {
  const store = storeFor(Buffer.from([255, 216, 255]), 'image/jpeg', 10 * 1024 * 1024 + 1);
  await assert.rejects(store.uploadedImage('gallery/user/photo.jpg'), { code: 'INVALID_IMAGE' });
});
test('valid image registration produces a Firebase download URL', async () => {
  const store = storeFor(Buffer.from([255, 216, 255, 224]));
  const url = new URL(await store.uploadedImage('gallery/user/photo.jpg'));
  assert.equal(url.hostname, 'firebasestorage.googleapis.com');
  assert.equal(url.searchParams.get('token'), 'download-token');
  assert.equal(url.searchParams.get('alt'), 'media');
});
test('deletion only derives object paths from this bucket and collection', () => {
  const store = storeFor(Buffer.from([255, 216, 255]));
  assert.equal(
    store.storagePath(
      'https://firebasestorage.googleapis.com/v0/b/another-bucket/o/gallery%2Fx.jpg',
      'gallery',
    ),
    null,
  );
  assert.equal(
    store.storagePath(
      'https://firebasestorage.googleapis.com/v0/b/example.firebasestorage.app/o/slider%2Fx.jpg',
      'gallery',
    ),
    null,
  );
  assert.equal(
    store.storagePath(
      'https://firebasestorage.googleapis.com/v0/b/example.firebasestorage.app/o/gallery%2Fx.jpg',
      'gallery',
    ),
    'gallery/x.jpg',
  );
});
