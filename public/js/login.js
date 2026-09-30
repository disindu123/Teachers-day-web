import { api, getConfig, setStatus } from './common.js';
import {
  initFirebase,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from './firebase.bundle.js';

const form = document.querySelector('#login-form');
const status = document.querySelector('#login-status');
const button = document.querySelector('#login-button');
const password = document.querySelector('#password');
const toggle = document.querySelector('#password-toggle');
toggle.addEventListener('click', () => {
  const reveal = password.type === 'password';
  password.type = reveal ? 'text' : 'password';
  toggle.textContent = reveal ? 'Hide' : 'Show';
  toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  toggle.setAttribute('aria-pressed', String(reveal));
});
const previous = sessionStorage.getItem('loginNotice');
if (previous) {
  setStatus(status, previous, 'error');
  sessionStorage.removeItem('loginNotice');
}
let firebase;
let signingIn = false;
async function verifyAndRedirect(user) {
  await api('/api/admin/me', { token: () => user.getIdToken(true) });
  location.replace('/admin/index.html');
}
try {
  const config = await getConfig();
  firebase = await initFirebase(config.firebase);
  onAuthStateChanged(firebase.auth, async (user) => {
    if (!user || signingIn) return;
    button.disabled = true;
    try {
      await verifyAndRedirect(user);
    } catch (error) {
      await signOut(firebase.auth);
      setStatus(status, error.message, 'error');
      button.disabled = false;
    }
  });
} catch (error) {
  setStatus(status, error.message, 'error');
  button.disabled = true;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!firebase || button.disabled || !form.reportValidity()) return;
  signingIn = true;
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  setStatus(status, 'Signing in securely…');
  try {
    const result = await signInWithEmailAndPassword(
      firebase.auth,
      form.email.value.trim(),
      password.value,
    );
    await verifyAndRedirect(result.user);
  } catch (error) {
    if (firebase.auth.currentUser) await signOut(firebase.auth);
    const message =
      error.code === 'auth/too-many-requests'
        ? 'Too many sign-in attempts. Please try again later.'
        : error.code === 'auth/network-request-failed'
          ? 'Check your connection and try again.'
          : error.code?.startsWith('auth/')
            ? 'Unable to sign in. Check your email and password.'
            : error.message;
    setStatus(status, message, 'error');
  } finally {
    signingIn = false;
    button.disabled = false;
    form.removeAttribute('aria-busy');
  }
});
