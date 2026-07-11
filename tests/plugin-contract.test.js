import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

test('Codex manifest is packageable and uses skill directories only', async () => {
  const manifest = await readJson('.codex-plugin/plugin.json');
  assert.equal(manifest.skills, './skills/');
  assert.equal(typeof manifest.author, 'object');
  for (const forbidden of ['commands', 'agents', 'hooks']) {
    assert.equal(Object.hasOwn(manifest, forbidden), false);
  }
  for (const entry of await readdir('skills', { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const text = await readFile(`skills/${entry.name}/SKILL.md`, 'utf8');
    assert.match(text, /^---[\s\S]*\nname:\s*\S+/);
    assert.match(text, /^---[\s\S]*\ndescription:\s*\S+/);
  }
});

test('package scripts contain no POSIX-only test enumeration', async () => {
  const pkg = await readJson('package.json');
  assert.equal(pkg.engines.node, '>=22');
  assert.doesNotMatch(pkg.scripts.test, /\$\(|\bfind\b|\bbash\b|\bsh\b/);
});

test('release metadata and the positive envelope fixture are synchronized at 1.5.0', async () => {
  const [pkg, claudeManifest, codexManifest, envelopeFixture] = await Promise.all([
    readJson('package.json'),
    readJson('.claude-plugin/plugin.json'),
    readJson('.codex-plugin/plugin.json'),
    readJson('tests/fixtures/sample-harnessability-report.json')
  ]);

  for (const manifest of [pkg, claudeManifest, codexManifest]) {
    assert.equal(manifest.version, '1.5.0');
  }
  assert.equal(envelopeFixture.envelope.producer_version, '1.5.0');
});

test('check-version-sync fails loud when the Codex manifest drifts', async () => {
  // Codex-version mutation fixture: package.json and .claude-plugin/plugin.json
  // agree; .codex-plugin/plugin.json alone carries a different version.
  // Directory name includes spaces on purpose (same principle as Task 2).
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'deep dashboard fixture '));
  const manifest = (version) => JSON.stringify({ name: 'deep-dashboard', version });
  await mkdir(join(fixtureRoot, '.claude-plugin'), { recursive: true });
  await mkdir(join(fixtureRoot, '.codex-plugin'), { recursive: true });
  await writeFile(join(fixtureRoot, 'package.json'), manifest('1.5.0'));
  await writeFile(join(fixtureRoot, '.claude-plugin', 'plugin.json'), manifest('1.5.0'));
  await writeFile(join(fixtureRoot, '.codex-plugin', 'plugin.json'), manifest('9.9.9'));

  // Contract implemented in Step 3: an optional first CLI argument
  // (process.argv[2] inside the script) overrides REPO_ROOT; when absent the
  // script keeps its existing import.meta.url-based default, so the current
  // `npm run check:version-sync` invocation is unchanged.
  const result = spawnSync(
    process.execPath,
    ['scripts/check-version-sync.js', fixtureRoot],
    { encoding: 'utf8' }
  );
  assert.equal(result.status, 1, result.stderr);
  // Tolerate both path separators so the assertion holds on native Windows.
  assert.match(result.stderr, /\.codex-plugin[\\/]plugin\.json/);
});

test('check-version-sync reports the manifest path when a manifest is JSON null', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'deep dashboard fixture '));
  const manifest = (version) => JSON.stringify({ name: 'deep-dashboard', version });
  const nullManifestPath = join(fixtureRoot, '.codex-plugin', 'plugin.json');
  await mkdir(join(fixtureRoot, '.claude-plugin'), { recursive: true });
  await mkdir(join(fixtureRoot, '.codex-plugin'), { recursive: true });
  await writeFile(join(fixtureRoot, 'package.json'), manifest('1.5.0'));
  await writeFile(join(fixtureRoot, '.claude-plugin', 'plugin.json'), manifest('1.5.0'));
  await writeFile(nullManifestPath, 'null');

  const result = spawnSync(
    process.execPath,
    ['scripts/check-version-sync.js', fixtureRoot],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 1, result.stderr);
  assert.equal(
    result.stderr,
    `check-version-sync: ${nullManifestPath}: manifest must be a non-null object\n`
  );
});
