import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scoreHarnessability } from './scorer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'harnessability-'));
}

function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function writeJson(dir, relPath, obj) {
  writeFile(dir, relPath, JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------------------
// Test 1: Well-configured TypeScript project scores >= 7
// ---------------------------------------------------------------------------

test('well-configured TS project scores >= 7', async () => {
  const root = mktemp();

  // type_safety
  writeJson(root, 'tsconfig.json', {
    compilerOptions: { strict: true }
  });

  // module_boundaries
  writeFile(root, '.dependency-cruiser.js', 'module.exports = {}');
  writeFile(root, 'src/index.ts', 'export {}');

  // test_infra
  writeJson(root, 'package.json', {
    devDependencies: { jest: '^29.0.0', c8: '^8.0.0' },
    jest: { collectCoverage: true }
  });
  writeFile(root, 'src/foo.test.ts', 'test("x", () => {})');

  // sensor_readiness + linter_formatter
  writeFile(root, '.eslintrc.json', '{}');
  writeFile(root, '.prettierrc', '{}');
  writeFile(root, 'package-lock.json', '{}');

  // ci_cd
  writeFile(root, '.github/workflows/ci.yml', 'jobs:\n  test:\n    run: jest');

  const result = await scoreHarnessability(root);

  assert.ok(result.total >= 7, `expected total >= 7, got ${result.total}`);
  assert.equal(result.dimensions.length, 6);
  assert.ok(result.grade === 'Excellent' || result.grade === 'Good');
});

// ---------------------------------------------------------------------------
// Test 2: Bare project (only main.py) scores <= 3
// ---------------------------------------------------------------------------

test('bare project with only main.py scores <= 3', async () => {
  const root = mktemp();
  writeFile(root, 'main.py', 'print("hello")');

  const result = await scoreHarnessability(root);

  assert.ok(result.total <= 3, `expected total <= 3, got ${result.total}`);
  assert.equal(result.dimensions.length, 6);
  assert.equal(result.grade, 'Poor');
});

// ---------------------------------------------------------------------------
// Test 3: Returns recommendations for low-scoring dimensions
// ---------------------------------------------------------------------------

test('returns recommendations for low-scoring dimensions', async () => {
  const root = mktemp();
  // Only a lock file — enough to pass lock_file but nothing else
  writeFile(root, 'package-lock.json', '{}');

  const result = await scoreHarnessability(root);

  assert.ok(Array.isArray(result.recommendations));
  assert.ok(result.recommendations.length > 0, 'expected at least one recommendation');

  const rec = result.recommendations[0];
  assert.ok('dimension' in rec, 'recommendation must have dimension');
  assert.ok('check' in rec, 'recommendation must have check');
  assert.ok('action' in rec, 'recommendation must have action');
});

// ---------------------------------------------------------------------------
// Test 4: Total is the weighted average of all 6 dimensions
// ---------------------------------------------------------------------------

test('total is the weighted average of all 6 dimensions, all present', async () => {
  const root = mktemp();
  // Minimal project: nothing set up
  writeFile(root, 'README.md', '# test');

  const result = await scoreHarnessability(root);

  assert.equal(result.dimensions.length, 6);

  const ids = result.dimensions.map((d) => d.id);
  assert.ok(ids.includes('type_safety'));
  assert.ok(ids.includes('module_boundaries'));
  assert.ok(ids.includes('test_infra'));
  assert.ok(ids.includes('sensor_readiness'));
  assert.ok(ids.includes('linter_formatter'));
  assert.ok(ids.includes('ci_cd'));

  // Manually recalculate expected total
  const weights = {
    type_safety: 0.25,
    module_boundaries: 0.20,
    test_infra: 0.20,
    sensor_readiness: 0.15,
    linter_formatter: 0.10,
    ci_cd: 0.10
  };

  let expected = 0;
  for (const dim of result.dimensions) {
    expected += dim.score * weights[dim.id];
  }
  expected = Math.round(expected * 10) / 10;

  assert.equal(result.total, expected, `expected total ${expected}, got ${result.total}`);
});

// ---------------------------------------------------------------------------
// Test 5: topology fields passed through from options
// ---------------------------------------------------------------------------

test('topology and topologyHints are passed through from options', async () => {
  const root = mktemp();
  writeFile(root, 'main.py', 'print("hello")');

  const fakeTopology = { layers: ['api', 'service', 'repo'] };
  const fakeHints = ['uses-ddd', 'event-driven'];

  const result = await scoreHarnessability(root, {
    topology: fakeTopology,
    topologyHints: fakeHints
  });

  assert.deepEqual(result.topology, fakeTopology);
  assert.deepEqual(result.topology_hints, fakeHints);
});

// ---------------------------------------------------------------------------
// Test 6: python_type_hints only passes for py.typed / .pyi, NOT pyproject.toml alone
// ---------------------------------------------------------------------------

test('python_type_hints: pyproject.toml alone does NOT pass; py.typed does', async () => {
  const rootA = mktemp();
  // pyproject.toml only — should NOT satisfy python_type_hints
  writeFile(rootA, 'pyproject.toml', '[tool.mypy]\nstrict = true\n');
  const resultA = await scoreHarnessability(rootA);
  const dimA = resultA.dimensions.find((d) => d.id === 'type_safety');
  const checkA = dimA.checks.find((c) => c.id === 'python_type_hints');
  assert.equal(checkA.passed, false, 'pyproject.toml alone must NOT pass python_type_hints');

  const rootB = mktemp();
  // py.typed marker — should pass
  writeFile(rootB, 'src/mypackage/py.typed', '');
  const resultB = await scoreHarnessability(rootB);
  const dimB = resultB.dimensions.find((d) => d.id === 'type_safety');
  const checkB = dimB.checks.find((c) => c.id === 'python_type_hints');
  assert.equal(checkB.passed, true, 'py.typed marker must pass python_type_hints');
});
