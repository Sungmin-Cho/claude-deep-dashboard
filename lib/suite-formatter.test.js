import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  formatSuiteReportMarkdown,
  writeSuiteReportFile,
  _internal,
} from './suite-formatter.js';
import { buildSnapshot } from './aggregator.js';
import { collectSuite } from './suite-collector.js';

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'suite-formatter-'));
}

async function emptySnapshot(opts = {}) {
  const root = mktemp();
  const collected = await collectSuite(root);
  return buildSnapshot(collected, { nowIso: '2026-05-11T13:00:00Z', run_id: 'r-empty', ...opts });
}

// ---------------------------------------------------------------------------
// trendArrow
// ---------------------------------------------------------------------------

test('trendArrow: no previous → · (no-baseline marker)', () => {
  assert.equal(_internal.trendArrow(5, undefined), '·');
});

test('trendArrow: current > previous → ↑', () => {
  assert.equal(_internal.trendArrow(7, 5), '↑');
});

test('trendArrow: current < previous → ↓', () => {
  assert.equal(_internal.trendArrow(3, 5), '↓');
});

test('trendArrow: equal → →', () => {
  assert.equal(_internal.trendArrow(5, 5), '→');
});

test('trendArrow: asymmetric null → ? (signal appeared/vanished — Round 1: Opus W2)', () => {
  // Previously these returned →, conflating "stable" with "regressed to unknown".
  // New: ? marks the asymmetric-null case so operators see signal appearance/disappearance.
  assert.equal(_internal.trendArrow(null, 5), '?');
  assert.equal(_internal.trendArrow(5, null), '?');
});

test('trendArrow: both null → → (genuinely stable)', () => {
  assert.equal(_internal.trendArrow(null, null), '→');
});

test('trendArrow: distribution deep-equal → →; otherwise ?', () => {
  const a = { APPROVE: 2, CONCERN: 1, REQUEST_CHANGES: 0 };
  const b = { APPROVE: 2, CONCERN: 1, REQUEST_CHANGES: 0 };
  const c = { APPROVE: 1, CONCERN: 2, REQUEST_CHANGES: 0 };
  assert.equal(_internal.trendArrow(a, b), '→');
  assert.equal(_internal.trendArrow(a, c), '?');
});

// ---------------------------------------------------------------------------
// renderValue
// ---------------------------------------------------------------------------

test('renderValue: ratio formats as percentage', () => {
  assert.equal(_internal.renderValue(0.25, 'ratio'), '25.00%');
  assert.equal(_internal.renderValue(1.0, 'ratio'), '100.00%');
});

test('renderValue: seconds — human-readable duration', () => {
  assert.equal(_internal.renderValue(45, 'seconds'), '45s');
  assert.equal(_internal.renderValue(125, 'seconds'), '2m5s');
  assert.equal(_internal.renderValue(7200, 'seconds'), '2.00h');
  assert.equal(_internal.renderValue(90000, 'seconds'), '1.04d');
});

test('renderValue: count integer / numeric to 4 decimals', () => {
  assert.equal(_internal.renderValue(7, 'count'), '7');
  assert.equal(_internal.renderValue(0.5, 'numeric'), '0.5000');
});

test('renderValue: null → "null"', () => {
  assert.equal(_internal.renderValue(null, 'ratio'), 'null');
});

test('renderValue: distribution → inline literal', () => {
  assert.equal(
    _internal.renderValue({ APPROVE: 2, CONCERN: 1 }, 'distribution'),
    '{ APPROVE=2, CONCERN=1 }'
  );
});

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

test('formatSuiteReportMarkdown renders all 16 metrics + collector self-metrics', async () => {
  const snap = await emptySnapshot();
  const md = formatSuiteReportMarkdown(snap, null);
  assert.ok(md.includes('# Suite Telemetry Report'));
  assert.ok(md.includes('## Collector self-metrics'));
  assert.ok(md.includes('## M4-core metrics (12)'));
  assert.ok(md.includes('## M4-deferred metrics (4)'));
  // Every metric id should appear
  for (const id of Object.keys(snap.metrics)) {
    assert.ok(md.includes(id), `missing ${id} in markdown output`);
  }
});

test('formatSuiteReportMarkdown notes "no baseline" when previous is null', async () => {
  const snap = await emptySnapshot();
  const md = formatSuiteReportMarkdown(snap, null);
  assert.ok(md.includes('_none — first snapshot_'));
});

test('formatSuiteReportMarkdown includes trend arrows comparing to previous', async () => {
  const prev = await emptySnapshot({ run_id: 'p-1' });
  // Manually mutate one metric for testable comparison
  prev.metrics['suite.dashboard.missing_signal_ratio'].value = 0.5;
  const curr = await emptySnapshot({ run_id: 'c-1' });
  curr.metrics['suite.dashboard.missing_signal_ratio'].value = 0.9; // ↑

  const md = formatSuiteReportMarkdown(curr, prev);
  // The arrow column for this metric should be ↑
  const row = md.split('\n').find((l) => l.includes('suite.dashboard.missing_signal_ratio'));
  assert.ok(row);
  assert.ok(row.includes('↑'), `expected ↑ trend, got: ${row}`);
});

test('formatSuiteReportMarkdown M4-deferred section lists deferred_until', async () => {
  const snap = await emptySnapshot();
  const md = formatSuiteReportMarkdown(snap, null);
  // M5 markers for 3 metrics, M5.5 for tests coverage
  assert.ok(md.includes('| M5 |'));
  assert.ok(md.includes('| M5.5 |'));
});

test('formatSuiteReportMarkdown escapes pipes inside source_summary JSON', async () => {
  const snap = await emptySnapshot();
  // Mutate one metric's source_summary to contain a pipe character
  snap.metrics['suite.hooks.block_rate'].source_summary = { note: 'a|b' };
  // also need a non-null value to ensure section visible? Actually source_summary lines
  // are always emitted for M4-core with non-empty summaries.
  const md = formatSuiteReportMarkdown(snap, null);
  // The pipe should be escaped (\|) so markdown table separators stay intact.
  assert.ok(md.includes('a\\|b'), `pipe should be escaped, output: ${md.match(/source.*a..b/i)}`);
});

// ---------------------------------------------------------------------------
// File write
// ---------------------------------------------------------------------------

test('writeSuiteReportFile creates .deep-dashboard/suite-report.md', async () => {
  const root = mktemp();
  const snap = await emptySnapshot();
  const out = writeSuiteReportFile(snap, null, root);
  assert.ok(out.endsWith('.deep-dashboard/suite-report.md'));
  assert.ok(fs.existsSync(out));
  const content = fs.readFileSync(out, 'utf8');
  assert.ok(content.startsWith('# Suite Telemetry Report'));
});

test('writeSuiteReportFile overwrites existing file (idempotent)', async () => {
  const root = mktemp();
  // Use unique run_ids that do NOT appear in the boilerplate template text
  // (the formatter's no-baseline line says "first snapshot", so avoid "first").
  const snap1 = await emptySnapshot({ run_id: 'snap-001-aaa' });
  writeSuiteReportFile(snap1, null, root);
  const snap2 = await emptySnapshot({ run_id: 'snap-002-bbb' });
  writeSuiteReportFile(snap2, null, root);
  const content = fs.readFileSync(path.join(root, '.deep-dashboard/suite-report.md'), 'utf8');
  assert.ok(content.includes('snap-002-bbb'));
  assert.ok(!content.includes('snap-001-aaa'));
});
