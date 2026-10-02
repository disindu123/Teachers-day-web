import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('server loads when the host disables CommonJS require(esm)', () => {
  // Vercel's loader can reject require() of ESM even on newer Node versions.
  const result = spawnSync(
    process.execPath,
    [
      '--no-experimental-require-module',
      '--input-type=module',
      '-e',
      "await import('./server.js')",
    ],
    { cwd: new URL('../', import.meta.url), encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
