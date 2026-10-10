// Browser-test-only server. It cannot be selected by the production entrypoint.
import { Timestamp } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApp } from '../lib/app.js';
import { loadConfig } from '../lib/config.js';
import { FirebaseStore } from '../lib/store.js';
import { AccountService } from '../lib/accounts.js';
import { MemoryDB } from './helpers.js';
const db = new MemoryDB();
for (const role of ['admin', 'teacher', 'student'])
  await db
    .collection('users')
    .doc(role)
    .set({
      email: `${role}@school.example`,
      displayName: `SCMU ${role}`,
      role,
      disabled: false,
      createdAt: Timestamp.now(),
    });
const slides = JSON.parse(
  await readFile(new URL('../public/assets/starter-slides.json', import.meta.url), 'utf8'),
);
for (const [order, photo] of slides.entries())
  await db
    .collection('slider')
    .doc(`slide${order}`)
    .set({ ...photo, order });
for (const [index, photo] of slides.slice(0, 4).entries())
  await db
    .collection('gallery')
    .doc(`photo${index}`)
    .set({
      ...photo,
      caption: index === 0 ? '<img src=x onerror=alert(1)> Safe caption' : photo.caption,
      albumTitle: index < 2 ? 'Campus stories' : 'College sports',
      facebookAlbumUrl: `https://www.facebook.com/media/set/?set=a.${index < 2 ? '123' : '456'}`,
      postedBy: 'teacher',
      postedByEmail: 'teacher@school.example',
      createdAt: Timestamp.fromMillis(1000 + index),
    });
await db.collection('popups').doc('event').set({
  title: 'SCMU special event',
  message: 'A new story from our school.',
  imageUrl: '',
  createdAt: Timestamp.now(),
});
await db.collection('mediaHeads').doc('president').set({
  role: 'President',
  name: 'Board member example',
  gmail: 'contact@school.example',
  whatsapp: 'https://wa.me/94700000000',
  photoUrl: 'https://images.example/board.jpg',
});
await db.collection('live').doc('current').set({
  platform: 'youtube',
  url: 'https://youtu.be/dQw4w9WgXcQ',
  embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  isLive: true,
});
const photos = {
  destroy: async () => {},
  ticket: async (collection, uid, contentType, size) => {
    const ticketId = randomUUID(),
      storagePath = `uploads/${collection}/${uid}/${ticketId}.png`;
    await db
      .collection('_uploads')
      .doc(ticketId)
      .set({
        uid,
        collection,
        storagePath,
        contentType,
        size,
        consumed: false,
        expiresAt: Timestamp.fromMillis(Date.now() + 30_000),
      });
    return { ticketId, storagePath };
  },
  inspect: async (ticketId) => ({
    imageUrl: 'https://images.example/upload.jpg',
    storagePath: (await db.collection('_uploads').doc(ticketId).get()).data().storagePath,
  }),
};
const store = new FirebaseStore(db, photos);
const auth = {
  verifyIdToken: async (role) => {
    if (!['admin', 'teacher', 'student'].includes(role)) throw new Error('Invalid');
    return { uid: role, email: `${role}@school.example` };
  },
  createUser: async () => ({ uid: `created-${Date.now()}` }),
  deleteUser: async () => {},
  updateUser: async () => {},
  getUser: async () => ({ customClaims: {} }),
  setCustomUserClaims: async () => {},
  revokeRefreshTokens: async () => {},
};
const config = loadConfig({
  TRUST_PROXY: '1',
  FB_PROJECT_ID: 'demo-scmu',
  FB_WEB_API_KEY: 'test',
  FB_WEB_AUTH_DOMAIN: 'demo-scmu.firebaseapp.com',
  FB_WEB_APP_ID: 'test',
  FB_STORAGE_BUCKET: 'demo-scmu.appspot.com',
  RATE_LIMIT_SALT: 'test-only-salt',
  PUBLIC_SITE_URL: 'http://127.0.0.1:9080',
  SOCIAL_FACEBOOK: 'https://www.facebook.com/Sanghabodhi',
  SOCIAL_INSTAGRAM: 'https://www.instagram.com/scmu',
  SOCIAL_TIKTOK: 'https://www.tiktok.com/@scmu',
});
const app = createApp({
  config,
  getServices: () => ({
    store,
    photos,
    auth,
    accounts: new AccountService(db, auth),
    login: { signIn: async () => ({ customToken: 'admin', role: 'admin' }) },
  }),
});
const server = app.listen(9080, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
