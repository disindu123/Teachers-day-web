import { createHash } from 'node:crypto';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { HttpError } from './errors.js';

export const ipKey = (ip) => createHash('sha256').update(ip).digest('hex');
export function serialise(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialise);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialise(v)]));
  return value;
}
export const toItem = (doc) => ({ id: doc.id, ...serialise(doc.data()) });

export class FirebaseStore {
  constructor(db, photos) {
    this.db = db;
    this.photos = photos;
  }
  async submitMessage(data, rateKey) {
    const now = Timestamp.now(),
      rate = this.db.collection('_rateLimits').doc(rateKey);
    const ref = this.db.collection('messages').doc();
    await this.db.runTransaction(async (tx) => {
      const previous = (await tx.get(rate)).data();
      const active = previous?.expiresAt.toMillis() > now.toMillis();
      if (active && previous.count >= 5)
        throw new HttpError(
          429,
          'RATE_LIMITED',
          'Please wait 15 minutes before sending another message.',
        );
      tx.set(rate, {
        count: active ? previous.count + 1 : 1,
        expiresAt: active ? previous.expiresAt : Timestamp.fromMillis(now.toMillis() + 15 * 60_000),
      });
      tx.create(ref, { ...data, createdAt: now });
    });
    return { id: ref.id };
  }
  async list(collection, { limit = 24, cursor = null } = {}) {
    const field = collection === 'blockedIPs' ? 'blockedAt' : 'createdAt';
    let query = this.db
      .collection(collection)
      .orderBy(field, 'desc')
      .orderBy(FieldPath.documentId(), 'desc');
    if (cursor) {
      try {
        const p = JSON.parse(Buffer.from(cursor, 'base64url').toString());
        if (!Number.isInteger(p.s) || !Number.isInteger(p.n) || !/^[\w-]{1,128}$/.test(p.id))
          throw new Error();
        query = query.startAfter(new Timestamp(p.s, p.n), p.id);
      } catch {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid pagination cursor.');
      }
    }
    const snap = await query.limit(limit + 1).get();
    const docs = snap.docs.slice(0, limit),
      last = docs.at(-1),
      time = last?.data()[field];
    return {
      items: docs.map(toItem),
      nextCursor:
        snap.docs.length > limit && last
          ? Buffer.from(
              JSON.stringify({ s: time.seconds, n: time.nanoseconds, id: last.id }),
            ).toString('base64url')
          : null,
    };
  }
  async getSlider() {
    const snap = await this.db
      .collection('slider')
      .orderBy('order')
      .orderBy(FieldPath.documentId())
      .limit(50)
      .get();
    return { items: snap.docs.map(toItem) };
  }
  async getSettings() {
    const snap = await this.db.collection('settings').doc('site').get();
    return { maintenanceMode: false, ...serialise(snap.data()) };
  }
  async setSettings(data) {
    await this.db.collection('settings').doc('site').set(data, { merge: true });
    return this.getSettings();
  }
  async getLive() {
    return {
      platform: '',
      url: '',
      isLive: false,
      ...serialise((await this.db.collection('live').doc('current').get()).data()),
    };
  }
  async setLive(data) {
    await this.db.collection('live').doc('current').set(data);
    return data;
  }
  async getHeads() {
    const snap = await this.db.collection('mediaHeads').get();
    const order = ['President', 'Secretary', 'V.President', 'V.Secretary', 'Treasurer'];
    return {
      items: snap.docs.map(toItem).sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role)),
    };
  }
  async getItem(collection, id) {
    const snap = await this.db.collection(collection).doc(id).get();
    if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', 'This item was not found.');
    return toItem(snap);
  }
  async profile(decoded) {
    const ref = this.db.collection('users').doc(decoded.uid);
    let snap = await ref.get();
    // Adopt the existing Teacher's Day administrator once. New users must be provisioned.
    if (!snap.exists && decoded.admin === true) {
      await this.db.runTransaction(async (tx) => {
        if (!(await tx.get(ref)).exists)
          tx.create(ref, {
            email: decoded.email || '',
            role: 'admin',
            disabled: false,
            createdAt: Timestamp.now(),
          });
      });
      snap = await ref.get();
    }
    const data = snap.data();
    if (!data || data.disabled || !['admin', 'teacher', 'student'].includes(data.role))
      throw new HttpError(403, 'ACCESS_DENIED', 'This account has no active SCMU staff access.');
    return {
      uid: decoded.uid,
      email: decoded.email || data.email,
      displayName: data.displayName || '',
      role: data.role,
    };
  }
  async prepareImage(collection, body, uid, optional = false, field = 'imageUrl') {
    if (body.ticketId && body[field])
      throw new HttpError(400, 'VALIDATION_ERROR', 'Choose an uploaded image or URL, not both.');
    if (body.ticketId)
      return {
        ...(await this.photos.inspect(body.ticketId, collection, uid)),
        ticketId: body.ticketId,
      };
    if (body[field]) return { imageUrl: body[field], storagePath: '' };
    if (optional) return { imageUrl: '', storagePath: '' };
    throw new HttpError(400, 'VALIDATION_ERROR', 'Choose a photograph or image URL.');
  }
  async saveContent(collection, data, image, id = null, update = false) {
    const target = id || image.ticketId;
    const ref = target
      ? this.db.collection(collection).doc(target)
      : this.db.collection(collection).doc();
    const ticketRef = image.ticketId ? this.db.collection('_uploads').doc(image.ticketId) : null;
    let oldPath;
    await this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref),
        permit = ticketRef ? (await tx.get(ticketRef)).data() : null;
      if (update && !existing.exists)
        throw new HttpError(404, 'NOT_FOUND', 'This item was not found.');
      if (!id && !update && existing.exists) return; // Upload retry after interrupted response.
      if (
        permit?.consumed &&
        permit.documentCollection === collection &&
        permit.documentId === ref.id &&
        existing.data()?.storagePath === image.storagePath
      )
        return;
      if (ticketRef && (!permit || permit.consumed || permit.expiresAt.toMillis() < Date.now()))
        throw new HttpError(400, 'UPLOAD_EXPIRED', 'The upload permit is expired or already used.');
      oldPath = existing.data()?.storagePath;
      const field = collection === 'mediaHeads' ? 'photoUrl' : 'imageUrl';
      // Editing contact details while keeping the same photo must retain its owned file.
      const storagePath =
        !image.ticketId && image.imageUrl && existing.data()?.[field] === image.imageUrl
          ? oldPath || ''
          : image.storagePath;
      tx.set(
        ref,
        {
          ...data,
          [field]: image.imageUrl,
          storagePath,
          createdAt: existing.data()?.createdAt || Timestamp.now(),
        },
        { merge: update },
      );
      if (storagePath === oldPath) oldPath = null;
      if (ticketRef)
        tx.update(ticketRef, {
          consumed: true,
          documentCollection: collection,
          documentId: ref.id,
        });
    });
    if (oldPath && oldPath !== image.storagePath) {
      // Metadata is updated first; an orphan is preferable to a broken published photo.
      try {
        await this.photos.destroy(oldPath);
      } catch {
        console.error('Old upload cleanup failed; run cleanup:uploads.');
      }
    }
    return this.getItem(collection, ref.id);
  }
  async patch(collection, id, data) {
    await this.getItem(collection, id);
    await this.db.collection(collection).doc(id).update(data);
    return this.getItem(collection, id);
  }
  async remove(collection, id) {
    const item = await this.getItem(collection, id);
    if (item.storagePath) await this.photos.destroy(item.storagePath);
    await this.db.collection(collection).doc(id).delete();
  }
  async stats(role) {
    const names =
      role === 'admin'
        ? ['messages', 'gallery', 'slider', 'users', 'popups']
        : role === 'teacher'
          ? ['messages', 'gallery', 'slider', 'popups']
          : ['gallery', 'popups'];
    return Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [
          name,
          (await this.db.collection(name).count().get()).data().count,
        ]),
      ),
    );
  }
  async getIpBlock(ip) {
    return (await this.db.collection('blockedIPs').doc(ipKey(ip)).get()).exists;
  }
  async blockIp(ip, reason) {
    await this.db
      .collection('blockedIPs')
      .doc(ipKey(ip))
      .set({ ip, reason, blockedAt: Timestamp.now() });
  }
  async unblockIp(ip) {
    await this.db.runTransaction(async (tx) => {
      tx.delete(this.db.collection('blockedIPs').doc(ipKey(ip)));
      tx.delete(this.db.collection('_loginAttempts').doc(ipKey(ip)));
    });
  }
  async beginLogin(ip, nonce) {
    const key = ipKey(ip),
      now = Date.now();
    const attempts = this.db.collection('_loginAttempts').doc(key),
      block = this.db.collection('blockedIPs').doc(key);
    await this.db.runTransaction(async (tx) => {
      const [a, b] = await Promise.all([tx.get(attempts), tx.get(block)]);
      if (b.exists)
        throw new HttpError(
          403,
          'IP_BLOCKED',
          'Login access from this IP is blocked. Contact an SCMU administrator.',
        );
      const d = a.data();
      if (d?.leaseUntil?.toMillis() > now)
        throw new HttpError(
          429,
          'LOGIN_BUSY',
          'A login is already being checked. Please wait a moment.',
        );
      const active = d?.windowUntil?.toMillis() > now;
      tx.set(attempts, {
        failures: active ? d.failures : 0,
        nonce,
        windowUntil: active ? d.windowUntil : Timestamp.fromMillis(now + 15 * 60_000),
        leaseUntil: Timestamp.fromMillis(now + 60_000),
      });
    });
  }
  async finishLogin(ip, nonce, outcome) {
    const key = ipKey(ip),
      ref = this.db.collection('_loginAttempts').doc(key),
      block = this.db.collection('blockedIPs').doc(key);
    return this.db.runTransaction(async (tx) => {
      const [a, b] = await Promise.all([tx.get(ref), tx.get(block)]);
      const d = a.data();
      if (d?.nonce !== nonce || b.exists) return false;
      if (outcome === 'success') {
        tx.delete(ref);
        return true;
      }
      const failures = (d.failures || 0) + (outcome === 'invalid' ? 1 : 0);
      tx.update(ref, { failures, leaseUntil: Timestamp.fromMillis(0) });
      if (failures >= 10)
        tx.set(block, {
          ip,
          reason: '10 invalid login attempts within 15 minutes',
          blockedAt: Timestamp.now(),
        });
      return failures < 10;
    });
  }
}
