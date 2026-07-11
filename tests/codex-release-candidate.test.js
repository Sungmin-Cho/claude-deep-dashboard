import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildCandidateFixture,
  buildCodexInvocation
} from '../scripts/validate-codex-release-candidate.js';

async function writeMinimalCandidate(root) {
  await mkdir(join(root, '.codex-plugin'), { recursive: true });
  await writeFile(
    join(root, '.codex-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'deep-dashboard',
      version: '1.5.0',
      skills: './skills/'
    })
  );
  for (const name of ['deep-harnessability', 'deep-harness-dashboard']) {
    await mkdir(join(root, 'skills', name), { recursive: true });
    await writeFile(
      join(root, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: fixture\n---\n`
    );
  }
}

test('candidate fixture pins the release identity and both discoverable skills', async (t) => {
  const candidateRoot = await mkdtemp(join(tmpdir(), 'deep dashboard candidate '));
  t.after(() => rm(candidateRoot, { recursive: true, force: true }));
  await writeMinimalCandidate(candidateRoot);

  const sourceSha = 'a'.repeat(40);
  const fixture = await buildCandidateFixture({
    candidateRoot,
    sourceUrl: 'file:///virtual/candidate/.git',
    sourceSha
  });

  assert.equal(fixture.marketplace.name, 'deep-dashboard-1-5-0-candidate');
  assert.equal(fixture.marketplace.plugins.length, 1);
  assert.deepEqual(fixture.marketplace.plugins[0].source, {
    source: 'url',
    url: 'file:///virtual/candidate/.git',
    sha: sourceSha
  });
  assert.deepEqual(fixture.marketplace.plugins[0].policy, {
    installation: 'AVAILABLE',
    authentication: 'ON_USE'
  });
  assert.equal(fixture.pluginManifest.version, '1.5.0');
  assert.equal(fixture.pluginManifest.skills, './skills/');
  assert.deepEqual(
    fixture.skillEntries.map(({ name }) => name).sort(),
    ['deep-harness-dashboard', 'deep-harnessability']
  );
  assert.equal(fixture.skillEntries.every(({ path }) => path.endsWith('SKILL.md')), true);
});

test('Codex child invocation is native on POSIX and quotes the Windows cmd shim', () => {
  const args = ['plugin', 'marketplace', 'add', 'C:\\candidate root\\marketplace'];
  assert.deepEqual(buildCodexInvocation(args, { platform: 'linux' }), {
    command: 'codex',
    args
  });
  assert.deepEqual(
    buildCodexInvocation(args, {
      platform: 'win32',
      environment: { COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }
    }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'call codex "plugin" "marketplace" "add" "C:\\candidate root\\marketplace"'
      ]
    }
  );
});
