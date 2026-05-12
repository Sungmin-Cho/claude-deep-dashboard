/**
 * Tests for scripts/check-catalog-drift.js — guards against silent drift
 * between lib/test-catalog-manifest.json and the authoritative suite-repo
 * catalog at claude-deep-suite/docs/test-catalog.md.
 *
 * The parser + diff are exported as named functions for testability; the
 * CLI entrypoint (`main()`) handles source resolution and process.exit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSuiteCatalogTable, diffCatalog } from '../scripts/check-catalog-drift.js';

const FIXTURE_MD = `# Test Catalog

Some prose above the table.

## Catalog (3 tests)

| # | 테스트 | 책임 plugin | 위치 | 실행 | 상태 |
|---|---|---|---|---|---|
| 1 | manifest-doc sync | suite | §1 below | npm test | ✅ M2 |
| 2 | artifact schema fixture | suite | §2 below | npm run validate-artifact-fixtures | ✅ M3 Phase 1 |
| 3 | hook golden | deep-work, deep-evolve, deep-wiki | §3 below | npm test | ✅ 2026-05-12 |

---

## §1. manifest-doc sync
...
`;

const FIXTURE_MANIFEST = {
  catalog_version: '1.0',
  tests: [
    { id: '1', name: 'manifest-doc sync', participating_plugins: ['suite'], status: 'done', suite_anchor: '#1' },
    { id: '2', name: 'artifact schema fixture', participating_plugins: ['suite'], status: 'done', suite_anchor: '#2' },
    { id: '3', name: 'hook golden', participating_plugins: ['deep-work', 'deep-evolve', 'deep-wiki'], status: 'done', suite_anchor: '#3' },
  ],
};

test('parseSuiteCatalogTable returns rows in document order with parsed plugin list', () => {
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    id: '1',
    name: 'manifest-doc sync',
    participating_plugins: ['suite'],
    done: true,
  });
  assert.deepEqual(rows[2].participating_plugins, ['deep-work', 'deep-evolve', 'deep-wiki']);
});

test('parseSuiteCatalogTable throws when the Catalog heading is missing', () => {
  assert.throws(() => parseSuiteCatalogTable('# No table here\n\nsome prose'),
    /catalog table heading not found/);
});

test('parseSuiteCatalogTable detects pending status from non-checkmark cell', () => {
  const pendingMd = FIXTURE_MD.replace('✅ 2026-05-12', '⏳ pending');
  const rows = parseSuiteCatalogTable(pendingMd);
  assert.equal(rows[2].done, false);
});

test('parseSuiteCatalogTable accepts either `,` or ` + ` as multi-plugin separator', () => {
  // Suite-repo catalog historically uses both: §3 with `, ` and §7/§8 with ` + `.
  // Treat as logically equivalent (semantic-only drift check).
  const plusMd = FIXTURE_MD.replace(
    'deep-work, deep-evolve, deep-wiki',
    'deep-work + deep-evolve + deep-wiki'
  );
  const rows = parseSuiteCatalogTable(plusMd);
  assert.deepEqual(rows[2].participating_plugins, ['deep-work', 'deep-evolve', 'deep-wiki']);
});

test('diffCatalog returns empty array when manifest and table agree', () => {
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const diffs = diffCatalog(FIXTURE_MANIFEST, rows);
  assert.deepEqual(diffs, []);
});

test('diffCatalog detects status drift (done vs pending)', () => {
  const drifted = {
    ...FIXTURE_MANIFEST,
    tests: FIXTURE_MANIFEST.tests.map((t) => t.id === '3' ? { ...t, status: 'pending' } : t),
  };
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const diffs = diffCatalog(drifted, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=3.*status/);
});

test('diffCatalog detects participating_plugins drift (set inequality)', () => {
  const drifted = {
    ...FIXTURE_MANIFEST,
    tests: FIXTURE_MANIFEST.tests.map((t) =>
      t.id === '3' ? { ...t, participating_plugins: ['deep-work'] } : t
    ),
  };
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const diffs = diffCatalog(drifted, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=3.*participating_plugins/);
});

test('diffCatalog detects name drift (typo in manifest)', () => {
  const drifted = {
    ...FIXTURE_MANIFEST,
    tests: FIXTURE_MANIFEST.tests.map((t) =>
      t.id === '1' ? { ...t, name: 'manifest-doc-sync' } : t  // hyphenated typo
    ),
  };
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const diffs = diffCatalog(drifted, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=1.*name/);
});

test('diffCatalog detects missing-from-manifest row (suite table has more rows)', () => {
  const dropped = { ...FIXTURE_MANIFEST, tests: FIXTURE_MANIFEST.tests.slice(0, 2) };
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const diffs = diffCatalog(dropped, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=3.*missing-from-manifest/);
});

test('diffCatalog detects extra-in-manifest row (manifest has rows table does not)', () => {
  const extra = {
    ...FIXTURE_MANIFEST,
    tests: [
      ...FIXTURE_MANIFEST.tests,
      { id: '4', name: 'ghost', participating_plugins: ['suite'], status: 'done', suite_anchor: '#4' },
    ],
  };
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const diffs = diffCatalog(extra, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=4.*extra-in-manifest/);
});
