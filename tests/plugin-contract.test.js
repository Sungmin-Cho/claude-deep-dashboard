import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const readText = async (path) => readFile(path, 'utf8');

function namedWorkflowStep(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const next = workflow.indexOf('\n      - name:', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

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

test('release metadata and the positive envelope fixture are synchronized at 1.5.1', async () => {
  const [pkg, claudeManifest, codexManifest, envelopeFixture] = await Promise.all([
    readJson('package.json'),
    readJson('.claude-plugin/plugin.json'),
    readJson('.codex-plugin/plugin.json'),
    readJson('tests/fixtures/sample-harnessability-report.json')
  ]);

  for (const manifest of [pkg, claudeManifest, codexManifest]) {
    assert.equal(manifest.version, '1.5.1');
  }
  assert.equal(envelopeFixture.envelope.producer_version, '1.5.1');
});

test('CI runs the pinned Codex release-candidate smoke in every Node 22 OS lane', async () => {
  const workflow = await readText('.github/workflows/tests.yml');

  assert.match(
    workflow,
    /strategy:\s*\n\s+fail-fast:\s*false\s*\n\s+matrix:\s*\n\s+os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/
  );
  assert.match(workflow, /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
  assert.match(workflow, /node-version:\s*'22'/);

  const install = namedWorkflowStep(workflow, 'Install pinned Codex CLI');
  assert.match(install, /^\s*run:\s*npm install --global @openai\/codex@0\.144\.1\s*$/m);

  const version = namedWorkflowStep(workflow, 'Verify pinned Codex CLI');
  assert.match(version, /shell:\s*pwsh/);
  assert.match(version, /\$actual = \(& codex --version\)\.Trim\(\)/);
  assert.match(version, /\$actual -ne 'codex-cli 0\.144\.1'/);
  assert.match(version, /\$LASTEXITCODE -ne 0/);

  const candidate = namedWorkflowStep(
    workflow,
    'Install and discover isolated Codex release candidate'
  );
  assert.match(candidate, /shell:\s*pwsh/);
  assert.match(candidate, /scripts\/validate-codex-release-candidate\.js/);
  assert.match(candidate, /node \$script --candidate-root \(Get-Location\)\.Path/);
  assert.match(candidate, /\$LASTEXITCODE -ne 0/);

  for (const [name, block] of [
    ['install', install],
    ['version', version],
    ['candidate', candidate]
  ]) {
    assert.doesNotMatch(block, /\bcontinue-on-error\s*:/, `${name} must fail closed`);
    assert.doesNotMatch(block, /^\s*if\s*:/m, `${name} must run on every matrix OS`);
    assert.doesNotMatch(block, /\bcatch\b|\bexit\s+0\b|\|\|/, `${name} must not mask failure`);
  }
  assert.ok(workflow.indexOf('actions/setup-node@v4') < workflow.indexOf(install));
  assert.ok(workflow.indexOf(install) < workflow.indexOf(version));
  assert.ok(workflow.indexOf(version) < workflow.indexOf(candidate));
});

test('catalog drift stays Ubuntu-only but uses Node 22', async () => {
  const workflow = await readText('.github/workflows/catalog-drift-check.yml');
  assert.match(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /node-version:\s*'22'/);
  assert.doesNotMatch(workflow, /windows-latest|macos-latest|matrix\.os/);
});

test('README files use the current two-command Codex marketplace flow', async () => {
  for (const path of ['README.md', 'README.ko.md']) {
    const text = await readText(path);
    assert.match(text, /codex plugin marketplace add Sungmin-Cho\/deep-suite/);
    assert.match(text, /codex plugin add deep-dashboard@claude-deep-suite/);
    assert.doesNotMatch(text, /codex plugin install deep-dashboard/);
  }
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
