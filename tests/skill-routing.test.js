import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function loadedSkillPath(skillName) {
  return path.join(repositoryRoot, 'skills', skillName, 'SKILL.md');
}

function pluginRootFromLoadedSkill(absoluteSkillPath) {
  return path.dirname(path.dirname(path.dirname(absoluteSkillPath)));
}

function makeFixture() {
  return {
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'deep dashboard routed project ')),
    externalCwd: fs.mkdtempSync(path.join(os.tmpdir(), 'deep dashboard routed cwd ')),
  };
}

function run(scriptPath, args, cwd) {
  return spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: 'utf8' });
}

function assertM3HarnessabilityIdentity(report) {
  assert.equal(report.schema_version, '1.0');
  assert.equal(report.envelope.producer, 'deep-dashboard');
  assert.equal(report.envelope.artifact_kind, 'harnessability-report');
  assert.equal(report.envelope.schema.name, 'harnessability-report');
  assert.equal(report.envelope.schema.version, '1.0');
}

test('deep-harness-dashboard resolves its absolute CLI route from loaded SKILL.md', () => {
  const skillPath = loadedSkillPath('deep-harness-dashboard');
  const scriptPath = path.join(pluginRootFromLoadedSkill(skillPath), 'scripts', 'dashboard-cli.js');
  const { projectRoot, externalCwd } = makeFixture();

  const result = run(scriptPath, ['--json', '--project-root', projectRoot], externalCwd);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).data.harnessability.status, 'available');
  assert.ok(fs.existsSync(path.join(projectRoot, '.deep-dashboard', 'harnessability-report.json')));
  assert.equal(fs.existsSync(path.join(externalCwd, '.deep-dashboard')), false);
});

test('deep-harnessability resolves its absolute scorer route from loaded SKILL.md', () => {
  const skillPath = loadedSkillPath('deep-harnessability');
  const scriptPath = path.join(pluginRootFromLoadedSkill(skillPath), 'lib', 'harnessability', 'scorer.js');
  const { projectRoot, externalCwd } = makeFixture();

  const result = run(scriptPath, ['--project-root', projectRoot], externalCwd);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assertM3HarnessabilityIdentity(report);
  assert.ok(fs.existsSync(path.join(projectRoot, '.deep-dashboard', 'harnessability-report.json')));
  assert.equal(fs.existsSync(path.join(externalCwd, '.deep-dashboard')), false);
});

for (const args of [
  [],
  [''],
  ['--project-root'],
  ['--project-root', 'one', '--project-root', 'two'],
  ['positional-root', '--project-root', 'flag-root'],
  ['one', 'two'],
]) {
  test(`scorer arguments ${JSON.stringify(args)} fail with exit 2`, () => {
    const skillPath = loadedSkillPath('deep-harnessability');
    const scriptPath = path.join(pluginRootFromLoadedSkill(skillPath), 'lib', 'harnessability', 'scorer.js');
    const { externalCwd } = makeFixture();
    assert.equal(run(scriptPath, args, externalCwd).status, 2);
  });
}

test('scorer keeps one explicit positional project root as a compatibility form', () => {
  const skillPath = loadedSkillPath('deep-harnessability');
  const scriptPath = path.join(pluginRootFromLoadedSkill(skillPath), 'lib', 'harnessability', 'scorer.js');
  const { projectRoot, externalCwd } = makeFixture();

  const result = run(scriptPath, [projectRoot], externalCwd);

  assert.equal(result.status, 0, result.stderr);
  assertM3HarnessabilityIdentity(JSON.parse(result.stdout));
  assert.ok(fs.existsSync(path.join(projectRoot, '.deep-dashboard', 'harnessability-report.json')));
});
