import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { HttpError } from './errors.js';
import { toItem } from './store.js';

export class AccountService {
  constructor(db, auth) {
    Object.assign(this, { db, auth });
  }
  async create(data) {
    let user;
    try {
      user = await this.auth.createUser({
        email: data.email,
        password: data.password,
        displayName: data.displayName || undefined,
      });
      await this.db.collection('users').doc(user.uid).create({
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        disabled: false,
        createdAt: Timestamp.now(),
      });
      await this.auth.setCustomUserClaims(user.uid, {
        role: data.role,
        admin: data.role === 'admin',
      });
      return { id: user.uid, email: data.email, displayName: data.displayName, role: data.role };
    } catch (e) {
      if (user) {
        await this.db.collection('users').doc(user.uid).delete();
        await this.auth.deleteUser(user.uid);
      }
      if (e.code === 'auth/email-already-exists')
        throw new HttpError(
          409,
          'EMAIL_EXISTS',
          'This email already has a Firebase account. Use the bootstrap script for an existing account.',
        );
      throw e;
    }
  }
  async change(uid, data, actor, remove = false) {
    if (uid === actor && (remove || (data.role && data.role !== 'admin') || data.disabled === true))
      throw new HttpError(
        409,
        'SELF_LOCKOUT',
        'Ask another administrator to change or remove your own access.',
      );
    const ref = this.db.collection('users').doc(uid),
      lock = this.db.collection('_system').doc('accounts');
    const operationId = randomUUID();
    let previous;
    // Firestore is authoritative for every API and Storage request. A global transaction
    // lock serializes account changes and protects the last active administrator.
    await this.db.runTransaction(async (tx) => {
      const pending = (await tx.get(lock)).data();
      if (pending?.pending && pending.leaseUntil?.toMillis() > Date.now())
        throw new HttpError(
          409,
          'ACCOUNT_BUSY',
          'Another account change is in progress. Please retry shortly.',
        );
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, 'NOT_FOUND', 'This account was not found.');
      previous = snap.data();
      const admins = await tx.get(this.db.collection('users').where('role', '==', 'admin'));
      const active = admins.docs.filter((d) => !d.data().disabled);
      if (
        previous.role === 'admin' &&
        !previous.disabled &&
        (remove || (data.role && data.role !== 'admin') || data.disabled) &&
        active.length <= 1
      )
        throw new HttpError(409, 'LAST_ADMIN', 'Keep at least one active administrator.');
      const { password, ...profile } = data;
      tx.set(lock, {
        operationId,
        pending: true,
        leaseUntil: Timestamp.fromMillis(Date.now() + 120_000),
      });
      tx.update(ref, { ...profile, ...(remove ? { disabled: true } : {}), operationId });
    });
    try {
      if (remove) {
        await this.auth.deleteUser(uid);
        await ref.delete();
        return;
      }
      const authData = Object.fromEntries(
        ['email', 'displayName', 'password', 'disabled']
          .filter((k) => data[k] !== undefined)
          .map((k) => [k, data[k]]),
      );
      if (Object.keys(authData).length) await this.auth.updateUser(uid, authData);
      const role = data.role || previous.role;
      const user = await this.auth.getUser(uid);
      await this.auth.setCustomUserClaims(uid, {
        ...user.customClaims,
        role,
        admin: role === 'admin',
      });
      await this.auth.revokeRefreshTokens(uid);
      return toItem(await ref.get());
    } catch (e) {
      // Keep access disabled after a partially failed Auth mutation; a retry is safe.
      await ref.update({ disabled: true });
      throw new HttpError(
        503,
        'ACCOUNT_SYNC_FAILED',
        'The account is disabled while Firebase updates are incomplete. Retry the change or restore it with the bootstrap script.',
      );
    } finally {
      await this.db.runTransaction(async (tx) => {
        if ((await tx.get(lock)).data()?.operationId === operationId)
          tx.update(lock, { pending: false });
      });
    }
  }
}
