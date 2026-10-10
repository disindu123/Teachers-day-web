import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getStorage, ref, uploadBytesResumable } from 'firebase/storage';
let instance;
export async function initFirebase(config) {
  if (!config) throw new Error('SCMU staff login is being configured.');
  if (instance) return instance;
  const app = getApps()[0] || initializeApp(config),
    auth = getAuth(app);
  await setPersistence(auth, browserSessionPersistence);
  instance = { auth, storage: config.storageBucket ? getStorage(app) : null };
  return instance;
}
export { signInWithCustomToken, signOut, onAuthStateChanged, ref, uploadBytesResumable };
