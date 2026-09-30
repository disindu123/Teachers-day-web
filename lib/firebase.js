import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpError } from './errors.js';
import { FirebaseStore } from './store.js';

// Lazy initialization also lets the design render before Firebase is configured.
export function createFirebaseServices(config) {
  let services;
  return () => {
    if (services) return services;
    const e = config.env;
    if (!config.projectId || !config.bucket || config.projectId.includes('your-')) {
      throw new HttpError(
        503,
        'FIREBASE_NOT_CONFIGURED',
        'This service is being prepared. Please try again later.',
      );
    }
    let credential;
    if (e.FB_SERVICE_ACCOUNT_JSON) {
      try {
        credential = cert(JSON.parse(e.FB_SERVICE_ACCOUNT_JSON));
      } catch {
        throw new HttpError(
          503,
          'FIREBASE_NOT_CONFIGURED',
          'The server configuration needs attention.',
        );
      }
    } else if (
      e.FB_CLIENT_EMAIL &&
      e.FB_PRIVATE_KEY &&
      !e.FB_PRIVATE_KEY.includes('YOUR_PRIVATE_KEY')
    ) {
      credential = cert({
        projectId: config.projectId,
        clientEmail: e.FB_CLIENT_EMAIL,
        privateKey: e.FB_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
    } else if (e.GOOGLE_APPLICATION_CREDENTIALS || e.FB_USE_ADC === 'true' || e.K_SERVICE) {
      credential = applicationDefault();
    } else {
      throw new HttpError(
        503,
        'FIREBASE_NOT_CONFIGURED',
        'This service is being prepared. Please try again later.',
      );
    }
    if (!config.rateLimitSalt || config.rateLimitSalt.startsWith('replace-')) {
      throw new HttpError(
        503,
        'FIREBASE_NOT_CONFIGURED',
        'The server configuration needs attention.',
      );
    }
    const app =
      getApps().find((a) => a.name === 'scmu') ||
      initializeApp(
        { credential, projectId: config.projectId, storageBucket: config.bucket },
        'scmu',
      );
    services = {
      auth: getAuth(app),
      store: new FirebaseStore(getFirestore(app), getStorage(app).bucket()),
    };
    return services;
  };
}
