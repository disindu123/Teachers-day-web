import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryDB } from './helpers.js';
import { AccountService } from '../lib/accounts.js';
async function setup() {
  const db = new MemoryDB();
  await db
    .collection('users')
    .doc('admin')
    .set({ email: 'admin@school.example', role: 'admin', disabled: false });
  await db
    .collection('users')
    .doc('teacher')
    .set({ email: 'teacher@school.example', role: 'teacher', disabled: false });
  const calls = [];
  const auth = {
    deleteUser: async (id) => calls.push(['delete', id]),
    updateUser: async (id, data) => calls.push(['update', id, data]),
    getUser: async () => ({ customClaims: {} }),
    setCustomUserClaims: async (id, claims) => calls.push(['claims', id, claims]),
    revokeRefreshTokens: async (id) => calls.push(['revoke', id]),
  };
  return { db, auth, calls, accounts: new AccountService(db, auth) };
}
test('last admin and self-lockout are protected even when an API caller bypasses the UI', async () => {
  const { accounts } = await setup();
  await assert.rejects(accounts.change('admin', { role: 'student' }, 'admin'), {
    code: 'SELF_LOCKOUT',
  });
  await assert.rejects(accounts.change('admin', {}, 'other', true), { code: 'LAST_ADMIN' });
});
test('account roles update the authoritative profile and claims and revoke sessions without storing passwords', async () => {
  const { db, calls, accounts } = await setup();
  await accounts.change('teacher', { role: 'student', password: 'unique-long-password' }, 'admin');
  const data = (await db.collection('users').doc('teacher').get()).data();
  assert.equal(data.role, 'student');
  assert.equal(data.password, undefined);
  assert.ok(calls.some(([key]) => key === 'revoke'));
  assert.deepEqual(calls.find(([key]) => key === 'claims')[2], { role: 'student', admin: false });
});
test('two overlapping deletions cannot remove the last active admin', async () => {
  const { db, accounts } = await setup();
  await db.collection('users').doc('other-admin').set({ role: 'admin', disabled: false });
  const results = await Promise.allSettled([
    accounts.change('admin', {}, 'actor', true),
    accounts.change('other-admin', {}, 'actor', true),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(
    (await db.collection('users').where('role', '==', 'admin').get()).docs.filter(
      (d) => !d.data().disabled,
    ).length,
    1,
  );
});
test('partial Auth failures leave the account disabled for safe recovery', async () => {
  const { db, accounts, auth } = await setup();
  auth.updateUser = async () => {
    throw new Error('unavailable');
  };
  await assert.rejects(accounts.change('teacher', { email: 'updated@school.example' }, 'admin'), {
    code: 'ACCOUNT_SYNC_FAILED',
  });
  assert.equal((await db.collection('users').doc('teacher').get()).data().disabled, true);
});
