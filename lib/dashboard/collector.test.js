import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collectData } from './collector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'collector-'));
}

function writeJson(dir, relPath, obj) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}

// ---------------------------------------------------------------------------
// Test 1: Collects deep-work receipts from .deep-work/receipts/
// ---------------------------------------------------------------------------

test('collects deep-work receipts from .deep-work/receipts/', () => {
  const root = mktemp();

  const receipt1 = { slice_id: 'slice-1', quality_score: 80 };
  const receipt2 = { slice_id: 'slice-2', quality_score: 90 };
  writeJson(root, '.deep-work/receipts/slice-1.json', receipt1);
  writeJson(root, '.deep-work/receipts/slice-2.json', receipt2);

  const result = collectData(root);

  assert.equal(result.deepWork.status, 'available');
  assert.ok(Array.isArray(result.deepWork.receipts));
  assert.equal(result.deepWork.receipts.length, 2);

  const ids = result.deepWork.receipts.map((r) => r.slice_id);
  assert.ok(ids.includes('slice-1'));
  assert.ok(ids.includes('slice-2'));
});

// ---------------------------------------------------------------------------
// Test 2: Marks missing plugins as no_data
// ---------------------------------------------------------------------------

test('marks missing plugins as no_data', () => {
  const root = mktemp();
  // Write nothing — no plugin directories exist

  const result = collectData(root);

  assert.equal(result.deepWork.status, 'no_data');
  assert.deepEqual(result.deepWork.receipts, []);

  assert.equal(result.deepReview.status, 'no_data');
  assert.deepEqual(result.deepReview.receipts, []);
  assert.equal(result.deepReview.fitness, null);

  assert.equal(result.deepDocs.status, 'no_data');
  assert.equal(result.deepDocs.data, null);
});

// ---------------------------------------------------------------------------
// Test 3: Collects deep-docs last-scan.json (legacy pre-envelope shape)
// ---------------------------------------------------------------------------

test('collects deep-docs last-scan.json (legacy pre-envelope artifact passes through unchanged)', () => {
  const root = mktemp();

  const scanData = {
    scanned_at: '2026-04-09T00:00:00Z',
    files_scanned: 42,
    stale_docs: ['README.md'],
  };
  writeJson(root, '.deep-docs/last-scan.json', scanData);

  const result = collectData(root);

  assert.equal(result.deepDocs.status, 'available');
  assert.deepEqual(result.deepDocs.data, scanData);
});

// ---------------------------------------------------------------------------
// Envelope-aware reads (M3)
// ---------------------------------------------------------------------------

function envelopeWrap(producer, artifactKind, payload, overrides = {}) {
  return {
    $schema: 'https://raw.githubusercontent.com/Sungmin-Cho/claude-deep-suite/main/schemas/artifact-envelope.schema.json',
    schema_version: '1.0',
    envelope: {
      producer,
      producer_version: overrides.producerVersion ?? '1.2.0',
      artifact_kind: artifactKind,
      run_id: overrides.runId ?? '01KR0J9PEM6E3K8H7XW2QFNB4M',
      generated_at: overrides.generatedAt ?? '2026-05-07T10:00:00Z',
      schema: { name: artifactKind, version: '1.0' },
      git: { head: '0000000', branch: 'HEAD', dirty: 'unknown' },
      provenance: { source_artifacts: [], tool_versions: { node: 'v20.11.0' } },
    },
    payload,
  };
}

test('unwraps envelope for deep-docs last-scan.json (envelope identity matches)', () => {
  const root = mktemp();
  const payload = { documents: [], summary: { total: 0 }, provenance: { is_git: false, worktree_hash: 'no-git' } };
  const wrapped = envelopeWrap('deep-docs', 'last-scan', payload);
  writeJson(root, '.deep-docs/last-scan.json', wrapped);

  const result = collectData(root);

  assert.equal(result.deepDocs.status, 'available');
  // collector returns the unwrapped payload, not the envelope
  assert.deepEqual(result.deepDocs.data, payload);
  assert.equal(result.deepDocs.data.envelope, undefined, 'envelope wrapper must be stripped');
});

test('unwraps envelope for harnessability-report.json (self-loop)', () => {
  const root = mktemp();
  const payload = { total: 7.5, grade: 'Good', dimensions: [], recommendations: [] };
  const wrapped = envelopeWrap('deep-dashboard', 'harnessability-report', payload);
  writeJson(root, '.deep-dashboard/harnessability-report.json', wrapped);

  const result = collectData(root);

  assert.equal(result.harnessability.status, 'available');
  assert.equal(result.harnessability.data.total, 7.5);
  assert.equal(result.harnessability.data.envelope, undefined);
});

test('rejects envelope with mismatched producer (defense-in-depth identity guard)', () => {
  const root = mktemp();
  // Wrong producer at deep-docs read path — must NOT be trusted.
  const wrongProducer = envelopeWrap('deep-evolve', 'last-scan', { documents: [] });
  writeJson(root, '.deep-docs/last-scan.json', wrongProducer);

  // Suppress the warning console output to keep test runs clean.
  const origWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = collectData(root);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(result.deepDocs.status, 'no_data');
  assert.equal(result.deepDocs.data, null);
});

test('rejects envelope with mismatched artifact_kind (identity guard)', () => {
  const root = mktemp();
  const mismatch = envelopeWrap('deep-dashboard', 'wrong-kind', { foo: 'bar' });
  writeJson(root, '.deep-dashboard/harnessability-report.json', mismatch);

  const origWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = collectData(root);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(result.harnessability.status, 'no_data');
  assert.equal(result.harnessability.data, null);
});

test('rejects envelope with schema.name drift (artifact_kind matches but schema.name differs)', () => {
  const root = mktemp();
  // Construct a hand-crafted envelope where artifact_kind matches but schema.name diverges.
  const drifted = envelopeWrap('deep-dashboard', 'harnessability-report', { total: 5 });
  drifted.envelope.schema.name = 'something-else';
  writeJson(root, '.deep-dashboard/harnessability-report.json', drifted);

  const origWarn = console.warn;
  console.warn = () => {};
  let result;
  try {
    result = collectData(root);
  } finally {
    console.warn = origWarn;
  }

  assert.equal(result.harnessability.status, 'no_data', 'schema.name ≠ artifact_kind must be rejected');
});

test('forward-compat: envelope-wrapped deep-evolve receipt unwraps cleanly', () => {
  const root = mktemp();
  const payload = { plugin: 'deep-evolve', quality_score: 78, outcome: 'merged' };
  const wrapped = envelopeWrap('deep-evolve', 'evolve-receipt', payload);
  writeJson(root, '.deep-evolve/evolve-receipt.json', wrapped);

  const result = collectData(root);

  assert.equal(result.deepEvolve.status, 'available');
  assert.equal(result.deepEvolve.receipt.quality_score, 78);
});

test('forward-compat: envelope-wrapped deep-work session-receipt unwraps cleanly', () => {
  const root = mktemp();
  const payload = { session_id: 's1', quality_score: 88, status: 'complete' };
  const wrapped = envelopeWrap('deep-work', 'session-receipt', payload);
  writeJson(root, '.deep-work/session-receipt.json', wrapped);

  const result = collectData(root);

  assert.equal(result.deepWork.status, 'available');
  assert.equal(result.deepWork.sessionReceipt.quality_score, 88);
});

test('forward-compat: envelope-wrapped slice receipt unwraps cleanly', () => {
  const root = mktemp();
  const payload = { slice_id: 'SLICE-001', quality_score: 92 };
  const wrapped = envelopeWrap('deep-work', 'slice-receipt', payload);
  writeJson(root, '.deep-work/receipts/SLICE-001.json', wrapped);

  const result = collectData(root);

  assert.equal(result.deepWork.status, 'available');
  assert.equal(result.deepWork.receipts.length, 1);
  assert.equal(result.deepWork.receipts[0].slice_id, 'SLICE-001');
  assert.equal(result.deepWork.receipts[0].quality_score, 92);
});

test('mixed legacy + envelope receipts coexist (no envelope) ', () => {
  // Legacy receipts (no schema_version === '1.0' + envelope + payload triple)
  // must pass through unchanged so consumers reading deep-work pre-Phase-2 emit
  // continue to work.
  const root = mktemp();
  writeJson(root, '.deep-work/receipts/legacy.json', { slice_id: 'legacy', quality_score: 70 });

  const result = collectData(root);

  assert.equal(result.deepWork.status, 'available');
  assert.equal(result.deepWork.receipts.length, 1);
  assert.equal(result.deepWork.receipts[0].slice_id, 'legacy');
});

test('legacy deep-docs schema_version: 2 (numeric) is NOT mistaken for envelope', () => {
  // The legacy deep-docs 1.1.0 emit had `schema_version: 2` (numeric).
  // Strict string equality (=== '1.0') prevents accidental envelope detection.
  const root = mktemp();
  writeJson(root, '.deep-docs/last-scan.json', {
    schema_version: 2,
    scanned_at: '2026-04-09T00:00:00Z',
    documents: [],
  });

  const result = collectData(root);

  assert.equal(result.deepDocs.status, 'available');
  // The legacy artifact is returned unchanged (legacy pass-through, not envelope-stripped)
  assert.equal(result.deepDocs.data.schema_version, 2);
  assert.equal(result.deepDocs.data.scanned_at, '2026-04-09T00:00:00Z');
});

// ---------------------------------------------------------------------------
// Test 4: Collects deep-evolve receipt
// ---------------------------------------------------------------------------

test('collects deep-evolve receipt when available', () => {
  const root = mktemp();

  const receipt = {
    plugin: 'deep-evolve',
    version: '2.1.0',
    quality_score: 78,
    experiments: { total: 80, kept: 20, discarded: 55, crashed: 5, keep_rate: 0.25 },
    outcome: 'merged',
  };
  writeJson(root, '.deep-evolve/evolve-receipt.json', receipt);

  const result = collectData(root);

  assert.equal(result.deepEvolve.status, 'available');
  assert.equal(result.deepEvolve.receipt.quality_score, 78);
  assert.equal(result.deepEvolve.receipt.outcome, 'merged');
});

// ---------------------------------------------------------------------------
// Test 5: Marks deep-evolve as active_session when only session.yaml exists
// ---------------------------------------------------------------------------

test('marks deep-evolve as active_session when session.yaml exists but no receipt', () => {
  const root = mktemp();

  const sessionDir = path.join(root, '.deep-evolve');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'session.yaml'), 'status: active\n');

  const result = collectData(root);

  assert.equal(result.deepEvolve.status, 'active_session');
  assert.equal(result.deepEvolve.receipt, null);
});

// ---------------------------------------------------------------------------
// Test 6: Marks deep-evolve as no_data when nothing exists
// ---------------------------------------------------------------------------

test('marks deep-evolve as no_data when nothing exists', () => {
  const root = mktemp();

  const result = collectData(root);

  assert.equal(result.deepEvolve.status, 'no_data');
  assert.equal(result.deepEvolve.receipt, null);
});

// ---------------------------------------------------------------------------
// Symlink privilege probe (Windows often disallows symlink creation)
// ---------------------------------------------------------------------------

function probeSymlinkPrivilege() {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symprobe-'));
  const target = path.join(probeDir, 'target.txt');
  const link = path.join(probeDir, 'link.txt');
  try {
    fs.writeFileSync(target, 'ok');
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
  }
}
const HAS_SYMLINK_PRIV = probeSymlinkPrivilege();
const SYMLINK_SKIP_REASON = HAS_SYMLINK_PRIV ? false : 'no symlink privilege on this platform';

// ---------------------------------------------------------------------------
// Test: readJsonDir loads JSON via a symlink to a regular file in same dir
// ---------------------------------------------------------------------------

test(
  'readJsonDir loads JSON content when the entry is a symbolic link to a regular file within the same directory',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    const root = mktemp();
    const receiptsDir = path.join(root, '.deep-work/receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });

    // Real file
    const realPath = path.join(receiptsDir, 'real.json');
    fs.writeFileSync(realPath, JSON.stringify({ slice_id: 'real', quality_score: 80 }));

    // Symlink within the same directory
    const linkPath = path.join(receiptsDir, 'link.json');
    fs.symlinkSync(realPath, linkPath);

    const result = collectData(root);
    const ids = result.deepWork.receipts.map((r) => r.slice_id).sort();
    assert.deepEqual(ids, ['real', 'real'], 'both the real file and its symlink should load');
  }
);

// ---------------------------------------------------------------------------
// Test: readJsonDir rejects a symlink whose target is OUTSIDE the scan dir
// ---------------------------------------------------------------------------

test(
  'readJsonDir rejects a symlink whose target resolves OUTSIDE the scanned directory',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    const root = mktemp();
    const receiptsDir = path.join(root, '.deep-work/receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });

    // Target outside the project entirely
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-outside-'));
    const outsideTarget = path.join(outsideDir, 'evil.json');
    fs.writeFileSync(outsideTarget, JSON.stringify({ slice_id: 'evil', quality_score: 999 }));

    // Symlink in receipts dir pointing to the outside file
    const linkPath = path.join(receiptsDir, 'link.json');
    fs.symlinkSync(outsideTarget, linkPath);

    const result = collectData(root);
    const ids = result.deepWork.receipts.map((r) => r.slice_id);
    assert.ok(!ids.includes('evil'), 'out-of-tree symlinked JSON must NOT be ingested');
  }
);

// ---------------------------------------------------------------------------
// P-3 regression: sibling directory with shared prefix must also be rejected
// ---------------------------------------------------------------------------

test(
  'readJsonDir rejects a symlink whose target sits in a SIBLING directory with a shared prefix',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    // Layout: project/.deep-work/receipts (scanned) and project/.deep-work/receipts-old (sibling).
    // A naive `startsWith(path.resolve(scanDir))` would accept the sibling because
    // "…/receipts-old/…" starts with "…/receipts". path.relative(scanDir, target)
    // correctly returns a "../…" form that the guard rejects.
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-sibling-'));
    const scanDir = path.join(projectRoot, '.deep-work/receipts');
    const siblingDir = path.join(projectRoot, '.deep-work/receipts-old');
    fs.mkdirSync(scanDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });

    const siblingTarget = path.join(siblingDir, 'stale.json');
    fs.writeFileSync(siblingTarget, JSON.stringify({ slice_id: 'sibling-stale', quality_score: 1 }));

    fs.symlinkSync(siblingTarget, path.join(scanDir, 'link.json'));

    const result = collectData(projectRoot);
    const ids = result.deepWork.receipts.map((r) => r.slice_id);
    assert.ok(
      !ids.includes('sibling-stale'),
      'symlink to sibling receipts-old/ must be rejected despite shared "receipts" prefix'
    );
  }
);

// ---------------------------------------------------------------------------
// Test: readJsonDir skips a broken symlink (and does not throw)
// ---------------------------------------------------------------------------

test(
  'readJsonDir skips a broken symlink',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    const root = mktemp();
    const receiptsDir = path.join(root, '.deep-work/receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });

    // One real file + one symlink pointing to nowhere
    const realPath = path.join(receiptsDir, 'real.json');
    fs.writeFileSync(realPath, JSON.stringify({ slice_id: 'real', quality_score: 80 }));
    fs.symlinkSync(path.join(receiptsDir, 'does-not-exist.json'), path.join(receiptsDir, 'broken.json'));

    const result = collectData(root);
    const ids = result.deepWork.receipts.map((r) => r.slice_id);
    assert.deepEqual(ids, ['real'], 'broken symlink is skipped; real file still loads');
  }
);
