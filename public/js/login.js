import { api, getConfig, setStatus } from './common.js';
import {
  initFirebase,
  signInWithCustomToken,
  signOut,
  onAuthStateChanged,
} from './firebase.bundle.js';
const form = document.querySelector('#login-form'),
  status = document.querySelector('#login-status');
const button = document.querySelector('#login-button'),
  password = document.querySelector('#password');
const toggle = document.querySelector('#password-toggle');
button.disabled = true;
toggle.addEventListener('click', () => {
  const reveal = password.type === 'password';
  password.type = reveal ? 'text' : 'password';
  toggle.textContent = reveal ? 'Hide' : 'Show';
  toggle.setAttribute('aria-pressed', String(reveal));
  toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
});
let firebase,
  signingIn = false;
async function verify(user) {
  await api('/api/admin/me', { token: () => user.getIdToken(true) });
  location.replace('/admin/index.html');
}
async function start() {
  try {
    const config = await getConfig();
    for (const logo of document.querySelectorAll('.brand img')) logo.src = config.logoUrl;
    const ipStatus = await api('/api/auth/status');
    if (ipStatus.blocked)
      throw new Error('Login access from this IP is blocked. Contact an SCMU administrator.');
    firebase = await initFirebase(config.firebase);
    button.disabled = false;
    onAuthStateChanged(firebase.auth, async (user) => {
      if (!user || signingIn) return;
      button.disabled = true;
      try {
        await verify(user);
      } catch (e) {
        await signOut(firebase.auth);
        setStatus(status, e.message, 'error');
        button.disabled = false;
      }
    });
  } catch (e) {
    setStatus(status, e.message, 'error');
  }
}
start();
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!firebase || button.disabled || !form.reportValidity()) return;
  signingIn = true;
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  setStatus(status, 'Checking your SCMU staff account…');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      body: { email: form.email.value.trim(), password: password.value },
    });
    password.value = '';
    const session = await signInWithCustomToken(firebase.auth, result.customToken);
    await verify(session.user);
  } catch (e) {
    if (firebase.auth.currentUser) await signOut(firebase.auth);
    setStatus(status, e.message || 'Unable to sign in. Please try again.', 'error');
    if (e.code === 'IP_BLOCKED') form.dataset.blocked = 'true';
  } finally {
    signingIn = false;
    button.disabled = form.dataset.blocked === 'true';
    form.removeAttribute('aria-busy');
  }
});
