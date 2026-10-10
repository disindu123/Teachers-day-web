import { randomUUID } from 'node:crypto';
import { HttpError } from './errors.js';

export class LoginService {
  constructor(store, auth, apiKey, fetcher = fetch) {
    Object.assign(this, { store, auth, apiKey, fetcher });
  }
  async signIn(ip, email, password) {
    if (!this.apiKey)
      throw new HttpError(503, 'AUTH_SERVICE_UNAVAILABLE', 'Login is being configured.');
    const nonce = randomUUID();
    await this.store.beginLogin(ip, nonce);
    let outcome = 'unavailable';
    try {
      const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
      const base = host
        ? `http://${host}/identitytoolkit.googleapis.com/v1`
        : 'https://identitytoolkit.googleapis.com/v1';
      const response = await this.fetcher(
        `${base}/accounts:signInWithPassword?key=${encodeURIComponent(this.apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        const code = result.error?.message || '';
        if (
          [
            'INVALID_LOGIN_CREDENTIALS',
            'INVALID_PASSWORD',
            'EMAIL_NOT_FOUND',
            'USER_DISABLED',
          ].includes(code)
        ) {
          outcome = 'invalid';
          throw new HttpError(
            401,
            'INVALID_CREDENTIALS',
            'Unable to sign in. Check your SCMU account email and password.',
          );
        }
        if (code.startsWith('TOO_MANY_ATTEMPTS'))
          throw new HttpError(
            429,
            'AUTH_RATE_LIMITED',
            'Too many sign-in attempts. Try again later.',
          );
        throw new HttpError(
          503,
          'AUTH_SERVICE_UNAVAILABLE',
          'Firebase could not complete sign-in. Please try again.',
        );
      }
      const decoded = await this.auth.verifyIdToken(result.idToken, true);
      const profile = await this.store.profile(decoded);
      // Firebase verified Email/Password above. Establish a session in the browser without
      // returning a password or refresh token, or trusting a client-reported failed attempt.
      const customToken = await this.auth.createCustomToken(profile.uid);
      outcome = 'success';
      return { customToken, role: profile.role };
    } catch (e) {
      if (e.code === 'ACCESS_DENIED') outcome = 'invalid';
      if (e instanceof HttpError) throw e;
      throw new HttpError(
        503,
        'AUTH_SERVICE_UNAVAILABLE',
        'Login is temporarily unavailable. Please try again.',
      );
    } finally {
      const allowed = await this.store.finishLogin(ip, nonce, outcome);
      if (outcome === 'success' && !allowed)
        throw new HttpError(403, 'IP_BLOCKED', 'Login access from this IP is blocked.');
    }
  }
}
