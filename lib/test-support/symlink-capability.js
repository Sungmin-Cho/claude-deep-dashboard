import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NO_SYMLINK_PRIVILEGE = 'no symlink privilege on this platform';
const SYMLINK_UNAVAILABLE_CODES = new Set([
  'EACCES',
  'ENOSYS',
  'ENOTSUP',
  'EOPNOTSUPP',
  'EPERM'
]);

export function probeSymlinkCapability({ fsOps = fs, tempRoot = os.tmpdir() } = {}) {
  let probeDir;
  try {
    probeDir = fsOps.mkdtempSync(path.join(tempRoot, 'symprobe-'));
    const target = path.join(probeDir, 'target.txt');
    const link = path.join(probeDir, 'link.txt');
    fsOps.writeFileSync(target, 'ok');
    try {
      fsOps.symlinkSync(target, link, 'file');
    } catch (error) {
      if (SYMLINK_UNAVAILABLE_CODES.has(error?.code)) {
        return { skip: NO_SYMLINK_PRIVILEGE };
      }
      throw error;
    }
    return { skip: false };
  } finally {
    if (probeDir) {
      fsOps.rmSync(probeDir, { recursive: true, force: true });
    }
  }
}
