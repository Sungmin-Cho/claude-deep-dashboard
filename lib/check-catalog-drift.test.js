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
  const { diffs, outOfScope } = diffCatalog(FIXTURE_MANIFEST, rows);
  assert.deepEqual(diffs, []);
  assert.deepEqual(outOfScope, []);
});

test('diffCatalog detects status drift (done vs pending)', () => {
  const drifted = {
    ...FIXTURE_MANIFEST,
    tests: FIXTURE_MANIFEST.tests.map((t) => t.id === '3' ? { ...t, status: 'pending' } : t),
  };
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const { diffs } = diffCatalog(drifted, rows);
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
  const { diffs } = diffCatalog(drifted, rows);
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
  const { diffs } = diffCatalog(drifted, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=1.*name/);
});

test('diffCatalog detects missing-from-manifest row when id is within manifest horizon', () => {
  // Drop id=2 from manifest while keeping id=3 → id=2 is "missing within horizon"
  // (horizon = max manifest id = 3), so it must still be flagged as drift. This
  // guards against silent dashboard-side regressions where a maintainer
  // accidentally removes a tracked entry from the manifest.
  const dropped = {
    ...FIXTURE_MANIFEST,
    tests: FIXTURE_MANIFEST.tests.filter((t) => t.id !== '2'),
  };
  const rows = parseSuiteCatalogTable(FIXTURE_MD);
  const { diffs } = diffCatalog(dropped, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=2.*missing-from-manifest/);
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
  const { diffs } = diffCatalog(extra, rows);
  assert.equal(diffs.length, 1);
  assert.match(diffs[0], /id=4.*extra-in-manifest/);
});

test('parseSuiteCatalogTable accepts loose heading text (e.g., "N M5.5 tests + 1 extension")', () => {
  // Suite-side commit 688370e changed the heading from `## Catalog (N tests)` to
  // `## Catalog (8 M5.5 tests + 1 M5.7.B extension)`. The parser must treat the
  // heading as an anchor only — tracked scope is governed by manifest contents,
  // not heading text — so the suite catalog can be annotated freely.
  const looseHeadingMd = FIXTURE_MD.replace(
    '## Catalog (3 tests)',
    '## Catalog (3 M5.5 tests + 1 M5.7.B extension)'
  );
  const rows = parseSuiteCatalogTable(looseHeadingMd);
  assert.equal(rows.length, 3);
});

test('diffCatalog reports out-of-scope rows beyond manifest horizon without flagging drift', () => {
  // Simulates suite-repo adding a §4 row that the dashboard manifest has not
  // yet adopted (the real-world case is suite §9 cross-plugin e2e regression
  // guard added 2026-05-12 in suite commit 688370e). The drift checker must
  // treat this as info, not failure — otherwise the suite catalog cannot grow
  // without lockstep dashboard manifest updates.
  const extendedMd = FIXTURE_MD.replace(
    '| 3 | hook golden | deep-work, deep-evolve, deep-wiki | §3 below | npm test | ✅ 2026-05-12 |',
    '| 3 | hook golden | deep-work, deep-evolve, deep-wiki | §3 below | npm test | ✅ 2026-05-12 |\n| 4 | suite-side e2e | suite | §4 below | npm test | ✅ 2026-05-12 |'
  );
  const rows = parseSuiteCatalogTable(extendedMd);
  assert.equal(rows.length, 4);
  const { diffs, outOfScope } = diffCatalog(FIXTURE_MANIFEST, rows);
  assert.deepEqual(diffs, [], 'no drift — id=4 is out-of-scope, not missing');
  assert.equal(outOfScope.length, 1);
  assert.equal(outOfScope[0].id, '4');
  assert.equal(outOfScope[0].name, 'suite-side e2e');
});
