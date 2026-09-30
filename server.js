import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './lib/config.js';
import { createFirebaseServices } from './lib/firebase.js';
import { createApp } from './lib/app.js';

const config = loadConfig();
const app = createApp({ config, getServices: createFirebaseServices(config) });
export default app;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`SCMU Teacher's Day website: http://localhost:${port}`);
    if (!config.configured)
      console.log('Design preview is available. Configure .env to enable Firebase services.');
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => server.close(() => process.exit(0)));
}
