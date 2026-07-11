import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
const dashboardCliPath = fileURLToPath(new URL('../scripts/dashboard-cli.js', import.meta.url));

function makeFixture() {
  return {
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'deep dashboard project ')),
    externalCwd: fs.mkdtempSync(path.join(os.tmpdir(), 'deep dashboard external cwd ')),
  };
}

function run(args, externalCwd) {
  return spawnSync(process.execPath, [dashboardCliPath, ...args], {
    cwd: externalCwd,
    encoding: 'utf8',
  });
}

function writeJson(projectRoot, relativePath, value) {
  const target = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function reportPath(projectRoot) {
  return path.join(projectRoot, '.deep-dashboard', 'harnessability-report.json');
}

function freshEnvelope({ payload = {}, generatedAt = Date.now() - 60_000, envelope = {}, schemaVersion = '1.0' } = {}) {
  return {
    schema_version: schemaVersion,
    envelope: {
      producer: 'deep-dashboard',
      artifact_kind: 'harnessability-report',
      run_id: 'fresh-fixture',
      generated_at: new Date(generatedAt).toISOString(),
      schema: { name: 'harnessability-report', version: '1.0' },
      ...envelope,
    },
    payload,
  };
}

function assertM3HarnessabilityIdentity(report) {
  assert.equal(report.schema_version, '1.0');
  assert.equal(report.envelope.producer, 'deep-dashboard');
  assert.equal(report.envelope.artifact_kind, 'harnessability-report');
  assert.equal(report.envelope.schema.name, 'harnessability-report');
  assert.equal(report.envelope.schema.version, '1.0');
  assert.ok(Number.isFinite(Date.parse(report.envelope.generated_at)));
}

test('missing report is scored and saved before legacy collectData', () => {
  const { projectRoot, externalCwd } = makeFixture();
  const result = run(['--json', '--project-root', projectRoot], externalCwd);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const report = readJson(reportPath(projectRoot));
  assertM3HarnessabilityIdentity(report);
  assert.equal(output.data.harnessability.status, 'available');
});

for (const [name, fixture] of [
  ['malformed', () => '{not json'],
  ['identity-mismatched producer', () => freshEnvelope({ envelope: { producer: 'another-plugin', run_id: 'stale-fixture' } })],
  ['identity-mismatched artifact kind', () => freshEnvelope({ envelope: { artifact_kind: 'other-report', run_id: 'stale-fixture' } })],
  ['identity-mismatched schema name', () => freshEnvelope({ envelope: { schema: { name: 'other-report', version: '1.0' }, run_id: 'stale-fixture' } })],
  ['identity-mismatched schema version', () => freshEnvelope({ envelope: { schema: { name: 'harnessability-report', version: '2.0' }, run_id: 'stale-fixture' } })],
  ['identity-mismatched top-level schema version', () => freshEnvelope({ schemaVersion: '2.0', envelope: { run_id: 'stale-fixture' } })],
  ['malformed generated_at', () => freshEnvelope({ envelope: { generated_at: 'not-a-date', run_id: 'stale-fixture' } })],
  ['future generated_at', () => freshEnvelope({ generatedAt: Date.now() + 60_000, envelope: { run_id: 'stale-fixture' } })],
  ['24-hour-old generated_at', () => freshEnvelope({ generatedAt: Date.now() - DAY_MS - 1_000, envelope: { run_id: 'stale-fixture' } })],
]) {
  test(`${name} report is replaced before legacy collectData`, () => {
    const { projectRoot, externalCwd } = makeFixture();
    const stale = fixture();
    const target = reportPath(projectRoot);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof stale === 'string' ? stale : JSON.stringify(stale, null, 2));

    const result = run(['--json', '--project-root', projectRoot], externalCwd);

    assert.equal(result.status, 0, result.stderr);
    const report = readJson(target);
    assertM3HarnessabilityIdentity(report);
    assert.notEqual(report.envelope.run_id, 'stale-fixture');
    assert.equal(JSON.parse(result.stdout).data.harnessability.status, 'available');
  });
}

test('fresh, identity-valid report is reused byte-for-byte', () => {
  const { projectRoot, externalCwd } = makeFixture();
  const before = freshEnvelope({
    payload: { total: 9.75, grade: 'Excellent', dimensions: [], recommendations: [] },
  });
  writeJson(projectRoot, '.deep-dashboard/harnessability-report.json', before);
  const beforeBytes = fs.readFileSync(reportPath(projectRoot));

  const result = run(['--json', '--project-root', projectRoot], externalCwd);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readFileSync(reportPath(projectRoot)), beforeBytes);
  assert.equal(JSON.parse(result.stdout).data.harnessability.data.total, 9.75);
});

test('default mode maps collected data into a real human dashboard view', () => {
  const { projectRoot, externalCwd } = makeFixture();
  writeJson(projectRoot, '.deep-dashboard/harnessability-report.json', freshEnvelope({
    payload: { projectRoot, total: 7.4, grade: 'Good', dimensions: [], recommendations: [] },
  }));

  const result = run(['--project-root', projectRoot], externalCwd);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /7\.4\/10 \(Good\)/);
  assert.doesNotMatch(result.stdout, /undefined\/10/);
  assert.doesNotMatch(result.stdout, /\[object Object\]/);
  assert.match(result.stdout, /Overall Harness Effectiveness: \d/);
});

for (const args of [
  [],
  ['--project-root'],
  ['--project-root', 'one', '--project-root', 'one'],
  ['--project-root', 'one', '--project-root', 'two'],
  ['--unknown', '--project-root', 'one'],
  ['positional-root'],
]) {
  test(`dashboard arguments ${JSON.stringify(args)} fail with exit 2`, () => {
    const { externalCwd } = makeFixture();
    assert.equal(run(args, externalCwd).status, 2);
  });
}

test('suite mode writes only under the explicit project root', () => {
  const { projectRoot, externalCwd } = makeFixture();
  const result = run(['--suite', '--json', '--project-root', projectRoot], externalCwd);

  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(projectRoot, '.deep-dashboard', 'suite-metrics.jsonl')));
  assert.ok(fs.existsSync(path.join(projectRoot, '.deep-dashboard', 'suite-report.md')));
  assert.equal(fs.existsSync(path.join(externalCwd, '.deep-dashboard')), false);
});
