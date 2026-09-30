import { onRequest } from 'firebase-functions/v2/https';
import app from './server.js';

export const web = onRequest(
  {
    region: 'asia-south1',
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 10,
    secrets: ['RATE_LIMIT_SALT', 'CLOUDINARY_API_SECRET'],
  },
  app,
);
