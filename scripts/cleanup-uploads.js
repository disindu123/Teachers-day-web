import { loadConfig } from '../lib/config.js';
import { createFirebaseServices } from '../lib/firebase.js';
// Dry-run by default. Run periodically to remove abandoned uploads and replaced files.
const apply = process.argv.includes('--apply'),
  cutoff = Date.now() - 24 * 60 * 60_000;
try {
  const { db, photos } = createFirebaseServices(loadConfig())();
  photos.requireBucket();
  const references = new Set();
  for (const collection of ['gallery', 'slider', 'popups', 'mediaHeads'])
    for (const doc of (await db.collection(collection).get()).docs)
      if (doc.data().storagePath) references.add(doc.data().storagePath);
  let count = 0;
  for await (const file of photos.bucket.getFilesStream({ prefix: 'uploads/' })) {
    if (references.has(file.name)) continue;
    const [metadata] = await file.getMetadata();
    if (Date.parse(metadata.timeCreated) > cutoff) continue;
    // Recheck all four collections immediately before deletion.
    let used = false;
    for (const collection of ['gallery', 'slider', 'popups', 'mediaHeads'])
      if (
        !(await db.collection(collection).where('storagePath', '==', file.name).limit(1).get())
          .empty
      )
        used = true;
    if (used) continue;
    console.log(`${apply ? 'Removing' : 'Would remove'} ${file.name}`);
    if (apply) await photos.destroy(file.name);
    count++;
  }
  console.log(
    `${count} orphan(s). ${apply ? 'Cleanup complete.' : 'Dry run; add -- --apply to remove.'}`,
  );
} catch (e) {
  console.error(
    `Cleanup failed (${e.code || 'configuration'}). No published metadata was changed.`,
  );
  process.exitCode = 1;
}
