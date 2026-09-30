import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable } from 'firebase/storage';

let instance;
export async function initFirebase(config) {
  if (!config) throw new Error('Admin login is being configured. Please contact SCMU.');
  if (instance) return instance;
  const app = getApps()[0] || initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserSessionPersistence);
  instance = { auth, storage: getStorage(app) };
  return instance;
}
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };

export function uploadPhoto(storage, user, collection, file, onProgress) {
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
  };
  const extension = extensions[file.type];
  if (!extension || !file.size || file.size > 10 * 1024 * 1024)
    throw new Error('Choose a JPG, PNG, WebP, or GIF smaller than 10 MB.');
  const storagePath = `${collection}/${user.uid}/${crypto.randomUUID()}.${extension}`;
  const task = uploadBytesResumable(ref(storage, storagePath), file, {
    contentType: file.type,
    cacheControl: 'public, max-age=31536000, immutable',
  });
  return new Promise((resolve, reject) =>
    task.on(
      'state_changed',
      (snapshot) => onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)),
      reject,
      () => resolve(storagePath),
    ),
  );
}
