import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';

let instance;
export async function initFirebase(config) {
  if (!config) throw new Error('Admin login is being configured. Please contact SCMU.');
  if (instance) return instance;
  const app = getApps()[0] || initializeApp(config);
  const auth = getAuth(app);
  await setPersistence(auth, browserSessionPersistence);
  instance = { auth };
  return instance;
}
export { signInWithEmailAndPassword, signOut, onAuthStateChanged };
