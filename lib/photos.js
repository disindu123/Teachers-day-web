import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpError } from './errors.js';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
export class StoragePhotos {
  constructor(db, bucket) {
    this.db = db;
    this.bucket = bucket;
  }
  requireBucket() {
    if (!this.bucket)
      throw new HttpError(503, 'STORAGE_NOT_CONFIGURED', 'Photo uploads are being configured.');
  }
  async ticket(collection, uid, contentType, size) {
    this.requireBucket();
    if (
      typeof contentType !== 'string' ||
      !Object.hasOwn(IMAGE_TYPES, contentType) ||
      !Number.isSafeInteger(size) ||
      size < 1 ||
      size > MAX_IMAGE_BYTES
    )
      throw new HttpError(
        400,
        'INVALID_IMAGE',
        'Choose a JPG, PNG, WebP or GIF smaller than 10 MB.',
      );
    const ticketId = randomUUID();
    const storagePath = `uploads/${collection}/${uid}/${ticketId}.${IMAGE_TYPES[contentType]}`;
    await this.db
      .collection('_uploads')
      .doc(ticketId)
      .create({
        uid,
        collection,
        storagePath,
        contentType,
        size,
        consumed: false,
        createdAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 30 * 60_000),
      });
    return { ticketId, storagePath };
  }
  async inspect(ticketId, collection, uid) {
    this.requireBucket();
    const snap = await this.db.collection('_uploads').doc(ticketId).get();
    const ticket = snap.data();
    if (!ticket || ticket.uid !== uid || ticket.collection !== collection)
      throw new HttpError(400, 'INVALID_UPLOAD', 'Choose a photograph uploaded by your account.');
    if (!ticket.consumed && ticket.expiresAt.toMillis() < Date.now())
      throw new HttpError(
        400,
        'UPLOAD_EXPIRED',
        'The upload expired. Choose the photograph again.',
      );
    const file = this.bucket.file(ticket.storagePath);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (e) {
      if (Number(e.code) === 404)
        throw new HttpError(400, 'UPLOAD_NOT_FOUND', 'Upload the photo first.');
      throw e;
    }
    if (metadata.contentType !== ticket.contentType || Number(metadata.size) !== ticket.size)
      throw new HttpError(
        400,
        'INVALID_IMAGE',
        'The uploaded file does not match its upload permit.',
      );
    // Check a binary signature, client MIME and authoritative bucket metadata.
    const [bytes] = await file.download({ start: 0, end: 31 });
    const valid =
      ticket.contentType === 'image/jpeg'
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : ticket.contentType === 'image/png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : ticket.contentType === 'image/gif'
            ? /^GIF8[79]a/.test(bytes.toString('ascii', 0, 6))
            : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!valid)
      throw new HttpError(400, 'INVALID_IMAGE', 'This file is not a supported photograph.');
    const token = metadata.metadata?.firebaseStorageDownloadTokens?.split(',')[0] || randomUUID();
    if (!metadata.metadata?.firebaseStorageDownloadTokens)
      await file.setMetadata({
        metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: token },
        cacheControl: 'public,max-age=86400',
      });
    return {
      storagePath: ticket.storagePath,
      imageUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.bucket.name)}/o/${encodeURIComponent(ticket.storagePath)}?alt=media&token=${token}`,
    };
  }
  async destroy(storagePath) {
    this.requireBucket();
    if (
      !/^uploads\/(gallery|slider|popups|mediaHeads)\/[\w-]+\/[\w-]+\.(jpg|png|webp|gif)$/.test(
        storagePath,
      )
    )
      throw new HttpError(400, 'INVALID_UPLOAD', 'Invalid managed photograph.');
    await this.bucket.file(storagePath).delete({ ignoreNotFound: true });
  }
}
