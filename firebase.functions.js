import { onRequest } from 'firebase-functions/v2/https';
import app from './server.js';

// Vercel's Node preset loads package.json's main and expects a default handler.
// Firebase continues to discover the named `web` function below.
export default app;

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
