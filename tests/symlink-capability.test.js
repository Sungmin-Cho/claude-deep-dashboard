import assert from 'node:assert/strict';
import test from 'node:test';

import { probeSymlinkCapability } from '../lib/test-support/symlink-capability.js';

function injectedFs({ symlinkError = null, removeError = null } = {}) {
  const calls = [];
  return {
    calls,
    mkdtempSync(prefix) {
      calls.push(['mkdtempSync', prefix]);
      return '/virtual/symlink-probe';
    },
    writeFileSync(path, contents) {
      calls.push(['writeFileSync', path, contents]);
    },
    symlinkSync(target, link) {
      calls.push(['symlinkSync', target, link]);
      if (symlinkError) throw symlinkError;
    },
    rmSync(path, options) {
      calls.push(['rmSync', path, options]);
      if (removeError) throw removeError;
    }
  };
}

test('available symlink capability keeps security assertions enabled', () => {
  const fsOps = injectedFs();
  assert.deepEqual(
    probeSymlinkCapability({ fsOps, tempRoot: '/virtual' }),
    { skip: false }
  );
  assert.equal(fsOps.calls.some(([name]) => name === 'symlinkSync'), true);
  assert.equal(fsOps.calls.at(-1)[0], 'rmSync');
});

test('unavailable symlink privilege maps EPERM to the exact zero-failure skip', () => {
  const error = Object.assign(new Error('privilege unavailable'), { code: 'EPERM' });
  const fsOps = injectedFs({ symlinkError: error });
  assert.deepEqual(
    probeSymlinkCapability({ fsOps, tempRoot: '/virtual' }),
    { skip: 'no symlink privilege on this platform' }
  );
  assert.equal(fsOps.calls.at(-1)[0], 'rmSync');
});

test('unexpected probe failures stay fail-closed instead of skipping security tests', () => {
  const error = Object.assign(new Error('device failure'), { code: 'EIO' });
  const fsOps = injectedFs({ symlinkError: error });
  assert.throws(
    () => probeSymlinkCapability({ fsOps, tempRoot: '/virtual' }),
    (caught) => caught === error
  );
  assert.equal(fsOps.calls.at(-1)[0], 'rmSync');
});

test('probe cleanup failures stay fail-closed instead of leaking fixtures', () => {
  const error = Object.assign(new Error('cleanup failure'), { code: 'EIO' });
  const fsOps = injectedFs({ removeError: error });
  assert.throws(
    () => probeSymlinkCapability({ fsOps, tempRoot: '/virtual' }),
    (caught) => caught === error
  );
});
