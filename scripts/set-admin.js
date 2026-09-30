import { loadConfig } from '../lib/config.js';
import { createFirebaseServices } from '../lib/firebase.js';

const index = process.argv.indexOf('--email');
const email = index >= 0 ? process.argv[index + 1] : null;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage: npm run admin -- --email your-admin@gmail.com [--remove]');
  process.exit(1);
}
try {
  const { auth } = createFirebaseServices(loadConfig())();
  const user = await auth.getUserByEmail(email);
  const claims = { ...user.customClaims };
  if (process.argv.includes('--remove')) delete claims.admin;
  else claims.admin = true;
  await auth.setCustomUserClaims(user.uid, claims);
  // Existing sessions must sign in again, making grants and removals immediate.
  await auth.revokeRefreshTokens(user.uid);
  console.log(
    `Administrator access ${claims.admin ? 'granted to' : 'removed from'} ${email}. Sign out and sign in again.`,
  );
} catch (error) {
  console.error(`Unable to update administrator: ${error.message}`);
  process.exit(1);
}
