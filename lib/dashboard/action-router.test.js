import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getSuggestedActions } from './action-router.js';

function makeData(evolveReceipt) {
  return {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: evolveReceipt ? 'available' : 'no_data', receipt: evolveReceipt },
    harnessability: { status: 'no_data', data: null },
  };
}

test('evolve-low-keep fires when keep_rate is 0.10', () => {
  const data = makeData({
    experiments: { total: 50, kept: 5, discarded: 42, crashed: 3, keep_rate: 0.10 },
    strategy_evolution: { q_trajectory: [0.30] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: 'archive_001' },
  });
  const actions = getSuggestedActions(data);
  const match = actions.find((a) => a.finding === 'evolve-low-keep');
  assert.ok(match, 'should find evolve-low-keep');
  assert.equal(match.severity, 'warning');
});

test('evolve-low-keep does NOT fire when keep_rate is 0.20', () => {
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: 'archive_001' },
  });
  const actions = getSuggestedActions(data);
  assert.equal(actions.find((a) => a.finding === 'evolve-low-keep'), undefined);
});

test('evolve-high-crash fires when crash rate exceeds 20%', () => {
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 25, crashed: 15, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: null },
  });
  const actions = getSuggestedActions(data);
  const match = actions.find((a) => a.finding === 'evolve-high-crash');
  assert.ok(match);
  assert.equal(match.severity, 'error');
});

test('evolve-low-q fires on significant decline (delta > 0.05)', () => {
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.50, 0.55, 0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: null },
  });
  const actions = getSuggestedActions(data);
  assert.ok(actions.find((a) => a.finding === 'evolve-low-q'));
});

test('evolve-low-q does NOT fire on noise (delta < 0.05)', () => {
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.50, 0.48, 0.49] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: null },
  });
  assert.equal(getSuggestedActions(data).find((a) => a.finding === 'evolve-low-q'), undefined);
});

test('evolve-low-q does NOT fire with fewer than 3 Q values', () => {
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.50, 0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: null },
  });
  assert.equal(getSuggestedActions(data).find((a) => a.finding === 'evolve-low-q'), undefined);
});

test('evolve-stale fires when receipt is 40 days old', () => {
  const old = new Date(Date.now() - 40 * 86400000).toISOString();
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: old,
    meta_archive_updated: true,
    transfer: { received_from: null },
  });
  const match = getSuggestedActions(data).find((a) => a.finding === 'evolve-stale');
  assert.ok(match);
  assert.equal(match.severity, 'info');
});

test('evolve-stale does NOT fire when receipt is 20 days old', () => {
  const recent = new Date(Date.now() - 20 * 86400000).toISOString();
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: recent,
    meta_archive_updated: true,
    transfer: { received_from: null },
  });
  assert.equal(getSuggestedActions(data).find((a) => a.finding === 'evolve-stale'), undefined);
});

test('evolve-no-transfer fires when both transfer and archive are absent', () => {
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: false,
    transfer: { received_from: null },
  });
  const match = getSuggestedActions(data).find((a) => a.finding === 'evolve-no-transfer');
  assert.ok(match);
  assert.equal(match.severity, 'info');
});

test('evolve-no-transfer does NOT fire when meta_archive_updated is true', () => {
  const data = makeData({
    experiments: { total: 50, kept: 10, discarded: 37, crashed: 3, keep_rate: 0.20 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: null },
  });
  assert.equal(getSuggestedActions(data).find((a) => a.finding === 'evolve-no-transfer'), undefined);
});

test('no evolve findings when receipt is null', () => {
  const data = makeData(null);
  assert.equal(getSuggestedActions(data).filter((a) => a.category === 'evolve').length, 0);
});

test('no crash finding when experiments.total is 0', () => {
  const data = makeData({
    experiments: { total: 0, kept: 0, discarded: 0, crashed: 0, keep_rate: 0 },
    strategy_evolution: { q_trajectory: [] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: false,
    transfer: { received_from: null },
  });
  assert.equal(getSuggestedActions(data).find((a) => a.finding === 'evolve-high-crash'), undefined);
});

test('fixture file schema validates through getSuggestedActions', () => {
  const fixture = JSON.parse(fs.readFileSync(
    new URL('../../test/fixtures/evolve-receipt.fixture.json', import.meta.url), 'utf8'
  ));
  const data = makeData(fixture);
  const actions = getSuggestedActions(data);
  assert.ok(Array.isArray(actions));
});

test('evolve findings map to correct ACTION_MAP actions', () => {
  const data = makeData({
    experiments: { total: 50, kept: 5, discarded: 30, crashed: 15, keep_rate: 0.10 },
    strategy_evolution: { q_trajectory: [0.50, 0.55, 0.40] },
    timestamp: new Date(Date.now() - 40 * 86400000).toISOString(),
    meta_archive_updated: false,
    transfer: { received_from: null },
  });
  const actions = getSuggestedActions(data);
  assert.ok(actions.find((a) => a.finding === 'evolve-low-keep')?.suggested_action.includes('meta analysis'));
  assert.ok(actions.find((a) => a.finding === 'evolve-high-crash')?.suggested_action.includes('eval harness'));
  assert.ok(actions.find((a) => a.finding === 'evolve-low-q')?.suggested_action.includes('strategy.yaml'));
  assert.ok(actions.find((a) => a.finding === 'evolve-stale')?.suggested_action.includes('/deep-evolve'));
  assert.ok(actions.find((a) => a.finding === 'evolve-no-transfer')?.suggested_action.includes('meta-archive'));
});

// ---------------------------------------------------------------------------
// Boundary test: keep_rate exactly at 0.15 should NOT fire evolve-low-keep
// ---------------------------------------------------------------------------

test('evolve-low-keep does NOT fire at exactly keep_rate = 0.15 (strict boundary)', () => {
  const data = makeData({
    experiments: { total: 100, kept: 15, discarded: 82, crashed: 3, keep_rate: 0.15 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: 'archive_001' },
  });
  const actions = getSuggestedActions(data);
  assert.equal(
    actions.find((a) => a.finding === 'evolve-low-keep'),
    undefined,
    'threshold is exclusive (< 0.15), so exactly 0.15 must NOT fire'
  );
});

// ---------------------------------------------------------------------------
// Boundary test: crash_rate exactly at 0.20 should NOT fire evolve-high-crash
// ---------------------------------------------------------------------------

test('evolve-high-crash does NOT fire at exactly crash_rate = 0.20 (strict boundary)', () => {
  const data = makeData({
    experiments: { total: 50, kept: 15, discarded: 25, crashed: 10, keep_rate: 0.30 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: 'archive_001' },
  });
  const actions = getSuggestedActions(data);
  assert.equal(
    actions.find((a) => a.finding === 'evolve-high-crash'),
    undefined,
    'threshold is exclusive (> 0.20), so exactly 0.20 must NOT fire'
  );
});

// ---------------------------------------------------------------------------
// Deep-docs M3 envelope payload — issues[] aggregation
// ---------------------------------------------------------------------------

function makeDocsData(scanData) {
  return {
    deepWork: { status: "no_data", receipts: [] },
    deepReview: { status: "no_data", receipts: [], fitness: null },
    deepDocs: { status: scanData ? "available" : "no_data", data: scanData },
    deepEvolve: { status: "no_data", receipt: null },
    harnessability: { status: "no_data", data: null },
  };
}

test("docs-stale fires from deep-docs M3 envelope payload (documents[].issues[])", () => {
  // Mirrors deep-docs 1.2.0 envelope payload shape (cf. deep-docs/tests/fixtures/sample-last-scan.json).
  // collector.js unwraps the envelope, so this is what action-router actually sees.
  const data = makeDocsData({
    provenance: { is_git: true, worktree_hash: "0".repeat(40) },
    documents: [
      {
        path: "CLAUDE.md",
        issues: [
          { type: "dead-reference", severity: "high", line: 42, current_value: "old", suggested_value: "new" },
          { type: "stale-example", severity: "medium", line: 88 },
        ],
        metrics: { size_lines: 100 },
      },
      {
        path: "README.md",
        issues: [{ type: "dead-reference", severity: "low" }],
        metrics: { size_lines: 50 },
      },
    ],
    summary: { total_issues: 3 },
  });
  const actions = getSuggestedActions(data);
  const docsAction = actions.find((a) => a.finding === "docs-stale");
  assert.ok(docsAction, "docs-stale must fire when documents[] has issues");
  assert.equal(docsAction.severity, "error", "highest severity (high) maps to error");
  assert.match(docsAction.detail, /3 doc issue/);
  assert.match(docsAction.detail, /CLAUDE\.md/);
});

test("docs-stale does NOT fire when documents[] has no issues", () => {
  const data = makeDocsData({
    provenance: { is_git: false, worktree_hash: "no-git" },
    documents: [
      { path: "CLAUDE.md", issues: [], metrics: {} },
    ],
    summary: { total_issues: 0 },
  });
  const actions = getSuggestedActions(data);
  assert.equal(actions.find((a) => a.finding === "docs-stale"), undefined);
});

test("docs-stale severity is warning when only medium/warning issues present", () => {
  const data = makeDocsData({
    documents: [
      { path: "doc1.md", issues: [{ severity: "medium" }, { severity: "low" }] },
    ],
  });
  const actions = getSuggestedActions(data);
  const docsAction = actions.find((a) => a.finding === "docs-stale");
  assert.ok(docsAction);
  assert.equal(docsAction.severity, "warning");
});

test("docs-stale (legacy) still fires from stale_docs array (pre-envelope)", () => {
  // Backward-compat: legacy v1.0 deep-docs emit had stale_docs[].
  const data = makeDocsData({
    stale_docs: ["foo.md", "bar.md", "baz.md"],
  });
  const actions = getSuggestedActions(data);
  const docsAction = actions.find((a) => a.finding === "docs-stale");
  assert.ok(docsAction);
  assert.equal(docsAction.severity, "warning");
  assert.match(docsAction.detail, /3 stale doc/);
});

test("docs-stale does NOT fire when deep-docs data is null", () => {
  const data = makeDocsData(null);
  const actions = getSuggestedActions(data);
  assert.equal(actions.find((a) => a.finding === "docs-stale"), undefined);
});

test("docs-stale handles malformed documents entries defensively", () => {
  const data = makeDocsData({
    documents: [
      null,
      "not-an-object",
      [],
      { path: "real.md", issues: [{ severity: "high" }] },
    ],
  });
  const actions = getSuggestedActions(data);
  const docsAction = actions.find((a) => a.finding === "docs-stale");
  assert.ok(docsAction, "should still find issues from the valid entry");
  assert.match(docsAction.detail, /1 doc issue/);
  assert.match(docsAction.detail, /real\.md/);
});

