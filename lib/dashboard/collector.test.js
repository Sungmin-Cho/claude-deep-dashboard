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
// Test 3: Collects deep-docs last-scan.json
// ---------------------------------------------------------------------------

test('collects deep-docs last-scan.json', () => {
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
