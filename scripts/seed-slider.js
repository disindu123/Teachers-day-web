import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { createFirebaseServices } from '../lib/firebase.js';
import { ownerKey } from '../lib/photos.js';

// Optional: copy illustrative slides to Cloudinary and their metadata to Firestore.
try {
  const { store, photos } = createFirebaseServices(loadConfig())();
  if ((await store.getSlider()).items.length)
    throw new Error('Slider already contains images. Manage them through the dashboard instead.');
  const slides = JSON.parse(
    await readFile(new URL('../public/assets/starter-slides.json', import.meta.url), 'utf8'),
  );
  for (const [index, slide] of slides.entries()) {
    const publicId = `scmu/slider/${ownerKey('seed')}/${randomUUID()}`;
    await photos.uploadLocal(
      fileURLToPath(new URL(`../public${slide.imageUrl}`, import.meta.url)),
      publicId,
    );
    await store.addImage('slider', { order: index }, publicId);
  }
  console.log('Six illustrative slides were saved to Cloudinary and Firestore.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
