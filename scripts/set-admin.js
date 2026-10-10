import { Timestamp } from 'firebase-admin/firestore';
import { loadConfig } from '../lib/config.js';
import { createFirebaseServices } from '../lib/firebase.js';
import { email as validateEmail, role as validateRole } from '../lib/validation.js';
const argument = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
try {
  const email = validateEmail(argument('--email'));
  const role = validateRole(argument('--role') || 'admin');
  const { auth, db } = createFirebaseServices(loadConfig())();
  // Create Email/Password users in Firebase Console first. No password on a CLI.
  const user = await auth.getUserByEmail(email),
    ref = db.collection('users').doc(user.uid);
  const previous = (await ref.get()).data();
  await ref.set(
    {
      email: user.email,
      displayName: user.displayName || '',
      role,
      disabled: false,
      createdAt: previous?.createdAt || Timestamp.now(),
    },
    { merge: true },
  );
  await auth.updateUser(user.uid, { disabled: false });
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role, admin: role === 'admin' });
  await auth.revokeRefreshTokens(user.uid);
  console.log(`SCMU ${role} access granted to ${email}. Sign in again.`);
} catch (e) {
  console.error(
    `Bootstrap failed (${e.code || 'configuration'}). Check the email, .env and Firebase account.`,
  );
  process.exitCode = 1;
}
