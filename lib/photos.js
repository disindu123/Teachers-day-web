import { v2 as cloudinary } from 'cloudinary';
import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
export const ownerKey = (uid) => createHash('sha256').update(uid).digest('hex').slice(0, 32);
export function validatePublicId(value, collection, uid) {
  if (
    typeof value !== 'string' ||
    !['gallery', 'slider'].includes(collection) ||
    !new RegExp(`^scmu/${collection}/${ownerKey(uid)}/${UUID}$`).test(value)
  )
    throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a photo uploaded by your account.');
  return value;
}

export class CloudinaryPhotos {
  constructor(config, client = cloudinary) {
    this.client = client;
    this.options = {
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
      timeout: 20000,
    };
    this.configured = config.configured;
  }
  requireConfig() {
    if (!this.configured)
      throw new HttpError(503, 'CLOUDINARY_NOT_CONFIGURED', 'Photo uploads are being configured.');
  }
  signUpload(collection, uid) {
    this.requireConfig();
    const params = {
      timestamp: Math.floor(Date.now() / 1000),
      public_id: `scmu/${collection}/${ownerKey(uid)}/${randomUUID()}`,
      overwrite: false,
      allowed_formats: FORMATS.join(','),
    };
    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${this.options.cloud_name}/image/upload`,
      apiKey: this.options.api_key,
      params: {
        ...params,
        signature: this.client.utils.api_sign_request(params, this.options.api_secret),
      },
    };
  }
  async uploadedImage(publicId) {
    this.requireConfig();
    let asset;
    try {
      // Read Cloudinary's authoritative metadata; never trust a browser-supplied URL or size.
      asset = await this.client.api.resource(publicId, {
        ...this.options,
        resource_type: 'image',
        type: 'upload',
      });
    } catch (error) {
      if (error.http_code === 404)
        throw new HttpError(
          400,
          'UPLOAD_NOT_FOUND',
          'Upload the photograph again; it was not found.',
        );
      throw error;
    }
    if (
      asset.public_id !== publicId ||
      asset.resource_type !== 'image' ||
      asset.type !== 'upload' ||
      !FORMATS.includes(asset.format) ||
      !Number.isSafeInteger(asset.version) ||
      !Number.isSafeInteger(asset.bytes) ||
      asset.bytes < 1 ||
      asset.bytes > MAX_IMAGE_BYTES
    ) {
      // Clear an invalid managed upload instead of leaving it to consume storage credits.
      await this.destroy(publicId);
      throw new HttpError(400, 'INVALID_IMAGE', 'Use a JPG, PNG, WebP, or GIF smaller than 10 MB.');
    }
    const encoded = publicId.split('/').map(encodeURIComponent).join('/');
    return `https://res.cloudinary.com/${this.options.cloud_name}/image/upload/f_auto,q_auto,c_limit,w_2000/v${asset.version}/${encoded}.${asset.format}`;
  }
  publicIdFromUrl(value, collection) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'res.cloudinary.com' ||
        url.username ||
        url.password
      )
        return null;
      const prefix = `/${this.options.cloud_name}/image/upload/`;
      if (!url.pathname.startsWith(prefix)) return null;
      const match = new RegExp(
        `^(?:f_auto,q_auto,c_limit,w_2000/)?v[0-9]+/(scmu/${collection}/[a-f0-9]{32}/${UUID})\\.(?:jpg|jpeg|png|webp|gif)$`,
      ).exec(decodeURIComponent(url.pathname.slice(prefix.length)));
      return match?.[1] || null;
    } catch {
      return null;
    }
  }
  async destroy(publicId) {
    this.requireConfig();
    const result = await this.client.uploader.destroy(publicId, {
      ...this.options,
      resource_type: 'image',
      type: 'upload',
      invalidate: true,
    });
    if (!['ok', 'not found'].includes(result.result))
      throw new HttpError(
        502,
        'PHOTO_DELETE_FAILED',
        'The photograph could not be removed. Try again.',
      );
  }
  async uploadLocal(file, publicId) {
    this.requireConfig();
    await this.client.uploader.upload(file, {
      ...this.options,
      resource_type: 'image',
      public_id: publicId,
      overwrite: false,
      allowed_formats: FORMATS,
    });
  }
}
