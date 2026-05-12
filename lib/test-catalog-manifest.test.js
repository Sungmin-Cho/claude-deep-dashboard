/**
 * Test catalog manifest schema + invariants.
 *
 * Validates `lib/test-catalog-manifest.json` mirrors claude-deep-suite
 * docs/test-catalog.md §1-§8 cross-reference 1:1. The manifest is the
 * single source of truth for `suite.tests.coverage_per_plugin` aggregation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_SUITE_PLUGINS } from './suite-constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MANIFEST_PATH = path.join(__dirname, 'test-catalog-manifest.json');

// W2 (v1.3.3): KNOWN_PLUGINS is a Set view over KNOWN_SUITE_PLUGINS for
// membership lookup. The hoisted constant is the single source of truth.
const KNOWN_PLUGINS = new Set(KNOWN_SUITE_PLUGINS);
const ALLOWED_STATUSES = new Set(['done', 'pending', 'failing']);

test('manifest file exists and parses as JSON', () => {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed, 'object');
  assert.ok(parsed !== null);
});

test('manifest has exactly 8 catalog entries (M5.5 contract)', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.ok(Array.isArray(m.tests));
  assert.equal(m.tests.length, 8, '8 tests per M5.5 catalog');
});

test('each test entry has id, name, participating_plugins, status, suite_anchor', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  for (const t of m.tests) {
    assert.ok(typeof t.id === 'string' && /^[0-9]+$/.test(t.id), `id integer string: ${t.id}`);
    assert.ok(typeof t.name === 'string' && t.name.length > 0);
    assert.ok(Array.isArray(t.participating_plugins));
    assert.ok(t.participating_plugins.length > 0);
    assert.ok(ALLOWED_STATUSES.has(t.status), `status: ${t.status}`);
    assert.ok(typeof t.suite_anchor === 'string' && t.suite_anchor.startsWith('#'));
  }
});

test('participating_plugins entries are known plugin slugs', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  for (const t of m.tests) {
    for (const p of t.participating_plugins) {
      assert.ok(KNOWN_PLUGINS.has(p), `plugin slug: ${p}`);
    }
  }
});

test('test ids are unique and span 1..8', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const ids = m.tests.map((t) => t.id).sort();
  assert.deepEqual(ids, ['1', '2', '3', '4', '5', '6', '7', '8']);
});

test('catalog_version is "1.0" and last_updated is ISO date', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(m.catalog_version, '1.0');
  assert.ok(/^\d{4}-\d{2}-\d{2}/.test(m.last_updated), `ISO date: ${m.last_updated}`);
});
