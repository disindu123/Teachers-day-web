import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadConfig } from '../lib/config.js';
import { createFirebaseServices } from '../lib/firebase.js';

// Optional: copy the six bundled illustrative slides into your Firebase bucket.
// Run only once on an empty slider collection; real celebration photos replace these.
try {
  const { store } = createFirebaseServices(loadConfig())();
  if ((await store.getSlider()).items.length)
    throw new Error('Slider already contains images. Manage them through the dashboard instead.');
  const photos = JSON.parse(
    await readFile(new URL('../public/assets/starter-slides.json', import.meta.url), 'utf8'),
  );
  for (const [index, photo] of photos.entries()) {
    const bytes = await readFile(new URL(`../public${photo.imageUrl}`, import.meta.url));
    const name = createHash('sha256').update(photo.imageUrl).digest('hex').slice(0, 32);
    const path = `slider/seed/${name}.jpg`;
    await store.bucket.file(path).save(bytes, {
      resumable: false,
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    await store.addImage('slider', { order: index }, path);
  }
  console.log('Six illustrative slides were saved to Firebase Storage and Firestore.');
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
