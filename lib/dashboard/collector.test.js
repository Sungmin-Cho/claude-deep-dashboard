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
