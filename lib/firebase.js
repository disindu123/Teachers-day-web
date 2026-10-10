import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpError } from './errors.js';
import { FirebaseStore } from './store.js';
import { StoragePhotos } from './photos.js';
import { AccountService } from './accounts.js';
import { LoginService } from './login.js';

// Preview works without credentials; protected operations fail closed.
export function createFirebaseServices(config) {
  let services;
  return () => {
    if (services) return services;
    const e = config.env;
    if (
      !config.projectId ||
      /^(your-|replace-)/.test(config.projectId) ||
      !config.rateLimitSalt ||
      config.rateLimitSalt.startsWith('replace-')
    )
      throw new HttpError(
        503,
        'FIREBASE_NOT_CONFIGURED',
        'The website services are being configured.',
      );
    let credential;
    try {
      if (e.FB_SERVICE_ACCOUNT_JSON) credential = cert(JSON.parse(e.FB_SERVICE_ACCOUNT_JSON));
      else if (
        e.FB_CLIENT_EMAIL &&
        e.FB_PRIVATE_KEY &&
        !e.FB_PRIVATE_KEY.includes('YOUR_PRIVATE_KEY')
      )
        credential = cert({
          projectId: config.projectId,
          clientEmail: e.FB_CLIENT_EMAIL,
          privateKey: e.FB_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
      else if (
        e.GOOGLE_APPLICATION_CREDENTIALS ||
        e.FB_USE_ADC === 'true' ||
        e.K_SERVICE ||
        e.FIREBASE_AUTH_EMULATOR_HOST
      )
        credential = applicationDefault();
      else throw new Error('Missing credentials');
    } catch {
      throw new HttpError(
        503,
        'FIREBASE_NOT_CONFIGURED',
        'The server configuration needs attention.',
      );
    }
    const app =
      getApps().find((a) => a.name === 'scmu') ||
      initializeApp(
        {
          credential,
          projectId: config.projectId,
          ...(config.bucket ? { storageBucket: config.bucket } : {}),
        },
        'scmu',
      );
    const db = getFirestore(app),
      auth = getAuth(app);
    const photos = new StoragePhotos(
      db,
      config.bucket ? getStorage(app).bucket(config.bucket) : null,
    );
    const store = new FirebaseStore(db, photos);
    services = {
      db,
      auth,
      photos,
      store,
      accounts: new AccountService(db, auth),
      login: new LoginService(store, auth, config.firebase.apiKey),
    };
    return services;
  };
}
