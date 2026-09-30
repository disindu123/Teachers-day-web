import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryPhotos, ownerKey, validatePublicId, MAX_IMAGE_BYTES } from '../lib/photos.js';
import { FirebaseStore } from '../lib/store.js';

const config = {
  cloudName: 'test-cloud',
  apiKey: '123456',
  apiSecret: 'test-secret',
  configured: true,
};
const publicId = `scmu/gallery/${ownerKey('adminuid')}/00000000-0000-4000-8000-000000000000`;
function photosFor(overrides = {}) {
  const deleted = [];
  const client = {
    utils: cloudinary.utils,
    api: {
      async resource(id) {
        return {
          public_id: id,
          resource_type: 'image',
          type: 'upload',
          format: 'jpg',
          version: 123,
          bytes: 100,
          ...overrides,
        };
      },
    },
    uploader: {
      async destroy(id) {
        deleted.push(id);
        return { result: 'ok' };
      },
    },
  };
  return { photos: new CloudinaryPhotos(config, client), deleted };
}
test('signed upload restricts the public ID, formats and overwrite without exposing the secret', () => {
  const photos = photosFor().photos;
  const ticket = photos.signUpload('gallery', 'adminuid');
  validatePublicId(ticket.params.public_id, 'gallery', 'adminuid');
  assert.equal(ticket.params.overwrite, false);
  assert.equal(ticket.params.allowed_formats, 'jpg,jpeg,png,webp,gif');
  const { signature, ...params } = ticket.params;
  assert.equal(signature, cloudinary.utils.api_sign_request(params, config.apiSecret));
  assert.ok(!JSON.stringify(ticket).includes(config.apiSecret));
});
test('authoritative image metadata generates an optimized URL in this cloud', async () => {
  const photos = photosFor().photos;
  const url = await photos.uploadedImage(publicId);
  assert.ok(
    url.startsWith(
      'https://res.cloudinary.com/test-cloud/image/upload/f_auto,q_auto,c_limit,w_2000/v123/',
    ),
  );
  assert.equal(photos.publicIdFromUrl(url, 'gallery'), publicId);
  assert.equal(photos.publicIdFromUrl(url, 'slider'), null);
  assert.equal(photos.publicIdFromUrl(url.replace('test-cloud', 'other-cloud'), 'gallery'), null);
});
test('oversize and non-image assets are removed and never published', async () => {
  for (const metadata of [
    { bytes: MAX_IMAGE_BYTES + 1 },
    { format: 'svg' },
    { resource_type: 'raw' },
    { bytes: 0 },
  ]) {
    const { photos, deleted } = photosFor(metadata);
    await assert.rejects(photos.uploadedImage(publicId), { code: 'INVALID_IMAGE' });
    assert.deepEqual(deleted, [publicId]);
  }
});
test('missing Cloudinary configuration does not create a usable upload signature', () => {
  const photos = new CloudinaryPhotos({ ...config, configured: false });
  assert.throws(() => photos.signUpload('gallery', 'adminuid'), {
    code: 'CLOUDINARY_NOT_CONFIGURED',
  });
});
test('provider not-found errors give a retryable upload error', async () => {
  const photos = new CloudinaryPhotos(config, {
    api: {
      async resource() {
        throw { http_code: 404 };
      },
    },
  });
  await assert.rejects(photos.uploadedImage(publicId), { code: 'UPLOAD_NOT_FOUND' });
});
test('failed provider deletion retains metadata, while external URL items leave assets untouched', async () => {
  let removed = false,
    destroyed = 0;
  const photos = photosFor().photos;
  const url = await photos.uploadedImage(publicId);
  const { createHash } = await import('node:crypto');
  const managedId = createHash('sha256').update(publicId).digest('hex').slice(0, 32);
  const db = {
    collection() {
      return {
        doc() {
          return {
            async get() {
              return { exists: true, data: () => ({ imageUrl: url }) };
            },
            async delete() {
              removed = true;
            },
          };
        },
      };
    },
  };
  photos.destroy = async () => {
    destroyed++;
    throw new Error('Provider unavailable');
  };
  const store = new FirebaseStore(db, photos);
  await assert.rejects(store.remove('gallery', managedId), /Provider unavailable/);
  assert.equal(removed, false);
  await store.remove('gallery', 'external-url-item');
  assert.equal(removed, true);
  assert.equal(destroyed, 1);
});
