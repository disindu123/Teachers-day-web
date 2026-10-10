import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { loadConfig } from '../lib/config.js';
import { createFirebaseServices } from '../lib/firebase.js';
try {
  const { db, store, photos } = createFirebaseServices(loadConfig())();
  photos.requireBucket();
  if ((await store.getSlider()).items.length)
    throw new Error('The slider already has photos. Manage it in the dashboard.');
  const slides = JSON.parse(
    await readFile(new URL('../public/assets/starter-slides.json', import.meta.url), 'utf8'),
  );
  for (const [order, slide] of slides.entries()) {
    const bytes = await readFile(new URL(`../public${slide.imageUrl}`, import.meta.url));
    const storagePath = `uploads/slider/seed/${randomUUID()}.jpg`,
      token = randomUUID();
    await photos.bucket.file(storagePath).save(bytes, {
      resumable: false,
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public,max-age=86400',
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    await db.collection('slider').add({
      imageUrl: `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(photos.bucket.name)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`,
      storagePath,
      order,
      caption: `${slide.caption} · illustrative education photo`,
      postedBy: 'seed',
      postedByEmail: '',
      createdAt: Timestamp.now(),
    });
  }
  console.log(
    'Six illustrative slides saved to Firebase Storage and Firestore. Replace them with authorised SCMU photographs.',
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
