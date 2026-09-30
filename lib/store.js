import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpError } from './errors.js';

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const toItem = (doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    ...(data.createdAt ? { createdAt: data.createdAt.toDate().toISOString() } : {}),
  };
};

export class FirebaseStore {
  constructor(db, bucket) {
    this.db = db;
    this.bucket = bucket;
  }

  // The rate-limit and message write share one transaction, including on serverless hosts.
  async submitMessage(data, rateKey) {
    const now = Timestamp.now();
    const rate = this.db.collection('_rateLimits').doc(rateKey);
    const message = this.db.collection('messages').doc();
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(rate);
      const previous = snap.data();
      const active = previous?.expiresAt.toMillis() > now.toMillis();
      if (active && previous.count >= 5)
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'You have sent several messages. Please try again in 15 minutes.',
        );
      tx.set(rate, {
        count: active ? previous.count + 1 : 1,
        expiresAt: active
          ? previous.expiresAt
          : Timestamp.fromMillis(now.toMillis() + 15 * 60 * 1000),
      });
      tx.create(message, { ...data, createdAt: now });
    });
    return { id: message.id, ...data, createdAt: now.toDate().toISOString() };
  }

  async list(collection, { limit, cursor }) {
    let query = this.db
      .collection(collection)
      .orderBy('createdAt', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (cursor) {
      let parsed;
      try {
        parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (
          !Number.isInteger(parsed.s) ||
          !Number.isInteger(parsed.n) ||
          !/^[\w-]{1,128}$/.test(parsed.id)
        )
          throw new Error();
        query = query.startAfter(new Timestamp(parsed.s, parsed.n), parsed.id);
      } catch {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor.');
      }
    }
    const snap = await query.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit);
    const last = docs.at(-1);
    const timestamp = last?.data().createdAt;
    const nextCursor =
      snap.docs.length > limit && last
        ? Buffer.from(
            JSON.stringify({ s: timestamp.seconds, n: timestamp.nanoseconds, id: last.id }),
          ).toString('base64url')
        : null;
    return { items: docs.map(toItem), nextCursor };
  }

  async getSlider() {
    const snap = await this.db
      .collection('slider')
      .orderBy('order')
      .orderBy(FieldPath.documentId())
      .get();
    return { items: snap.docs.map(toItem) };
  }

  async uploadedImage(path) {
    const file = this.bucket.file(path);
    let metadata;
    try {
      [metadata] = await file.getMetadata();
    } catch (error) {
      if (Number(error.code) === 404)
        throw new HttpError(
          400,
          'UPLOAD_NOT_FOUND',
          'The upload could not be found. Please upload the photo again.',
        );
      throw error;
    }
    if (
      !MIME_TYPES.includes(metadata.contentType) ||
      !Number(metadata.size) ||
      Number(metadata.size) > MAX_BYTES
    ) {
      throw new HttpError(400, 'INVALID_IMAGE', 'Use a JPG, PNG, WebP, or GIF smaller than 10 MB.');
    }
    // Check the actual file signature; a renamed executable or SVG is not an image.
    const [header] = await file.download({ start: 0, end: 15, validation: false });
    const signatures = {
      'image/jpeg': header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff,
      'image/png': header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'image/gif': ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString()),
      'image/webp':
        header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8, 12).toString() === 'WEBP',
    };
    if (!signatures[metadata.contentType])
      throw new HttpError(400, 'INVALID_IMAGE', 'The file contents do not match its image type.');
    let token = metadata.metadata?.firebaseStorageDownloadTokens?.split(',')[0];
    if (!token) {
      token = randomUUID();
      await file.setMetadata({
        metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: token },
      });
    }
    return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(this.bucket.name)}/o/${encodeURIComponent(path)}?alt=media&token=${encodeURIComponent(token)}`;
  }

  async addImage(collection, data, path) {
    const imageUrl = path ? await this.uploadedImage(path) : data.imageUrl;
    // Re-registering the same upload after a network interruption is idempotent.
    const ref = path
      ? this.db
          .collection(collection)
          .doc(createHash('sha256').update(path).digest('hex').slice(0, 32))
      : this.db.collection(collection).doc();
    const item =
      collection === 'gallery'
        ? { imageUrl, caption: data.caption, createdAt: Timestamp.now() }
        : { imageUrl, order: data.order };
    await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (!existing.exists) tx.create(ref, item);
    });
    return toItem(await ref.get());
  }

  storagePath(url, collection) {
    try {
      const u = new URL(url);
      const prefix = `/v0/b/${encodeURIComponent(this.bucket.name)}/o/`;
      if (u.hostname !== 'firebasestorage.googleapis.com' || !u.pathname.startsWith(prefix))
        return null;
      const path = decodeURIComponent(u.pathname.slice(prefix.length));
      return path.startsWith(`${collection}/`) ? path : null;
    } catch {
      return null;
    }
  }

  async remove(collection, id) {
    const ref = this.db.collection(collection).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', 'This item has already been removed.');
    const path = this.storagePath(snap.data().imageUrl, collection);
    // Remove the binary before metadata; a failed deletion leaves a retryable record.
    if (path) await this.bucket.file(path).delete({ ignoreNotFound: true });
    await ref.delete();
  }

  async setSliderOrder(id, order) {
    const ref = this.db.collection('slider').doc(id);
    try {
      await ref.update({ order });
    } catch (error) {
      if (Number(error.code) === 5)
        throw new HttpError(404, 'NOT_FOUND', 'This slide could not be found.');
      throw error;
    }
  }

  async stats() {
    const counts = await Promise.all(
      ['messages', 'gallery', 'slider'].map(async (name) => [
        name,
        (await this.db.collection(name).count().get()).data().count,
      ]),
    );
    return Object.fromEntries(counts);
  }
}
