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
  // After M5.5 activation (2026-05-12): all 16 metrics are M4-core, the
  // M4-deferred section is empty and intentionally omitted.
  assert.ok(md.includes('## M4-core metrics (16)'));
  assert.ok(!md.includes('## M4-deferred metrics'));
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

test('formatSuiteReportMarkdown omits M4-deferred section after M5.5 activation', async () => {
  const snap = await emptySnapshot();
  const md = formatSuiteReportMarkdown(snap, null);
  // Post-M5.5 (2026-05-12): all metrics are M4-core. The formatter omits the
  // M4-deferred section entirely when no deferred metrics exist (avoids an
  // empty header that confuses operators).
  assert.ok(!md.includes('## M4-deferred metrics'));
  // No deferred milestone markers either.
  assert.ok(!md.includes('| M5.5 |'));
  assert.ok(!md.includes('| M5 |'));
});

test('formatSuiteReportMarkdown still shows M4-deferred section when future milestones register new deferred metrics', async () => {
  const snap = await emptySnapshot();
  // Synthetic injection: simulate a future milestone (e.g., M6) adding a new
  // deferred metric. The formatter should re-emit the section.
  snap.metrics['suite.future.something'] = {
    value: null,
    unit: 'count',
    tier: 'M4-deferred',
    deferred_until: 'M6',
    source_summary: { deferred: true },
  };
  const md = formatSuiteReportMarkdown(snap, null);
  assert.ok(md.includes('## M4-deferred metrics (1)'));
  assert.ok(md.includes('| M6 |'));
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

// ---------------------------------------------------------------------------
// Distribution rendering (per-plugin ratio cells, M5.5 activation)
// ---------------------------------------------------------------------------

// I1 (v1.3.3): parse a `{ key1=val1, key2=val2, ... }` distribution string
// (renderValue's distribution shape) into an object so deepEqual locks the
// full pair-set against alphabetization regression or silent dropped pairs.
// The renderValue smoke checks (assert.match) remain alongside this stronger
// assertion.
function parseDistribution(out) {
  const trimmed = out.trim().replace(/^\{\s*/, '').replace(/\s*\}$/, '');
  if (trimmed === '') return {};
  return Object.fromEntries(
    trimmed.split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((p) => {
        const idx = p.indexOf('=');
        if (idx === -1) throw new Error(`malformed distribution segment: ${p}`);
        return [p.slice(0, idx), p.slice(idx + 1)];
      })
  );
}

test('renderValue: distribution with per-plugin ratio cells renders as compact percent', () => {
  const val = {
    'deep-work': { covered: 4, expected: 4, ratio: 1.0, tests: ['3','4','7','8'] },
    'deep-review': { covered: 1, expected: 2, ratio: 0.5, tests: ['4','5'] },
  };
  const out = _internal.renderValue(val, 'distribution');
  // Smoke checks (kept from M5.5 ship):
  assert.match(out, /deep-work=100%/);
  assert.match(out, /deep-review=50%/);
  assert.ok(!out.includes('[object Object]'));
  // I1 (v1.3.3): structural assertion locks the full pair-set so an
  // alphabetization regression or a dropped plugin pair fails loudly.
  assert.deepEqual(parseDistribution(out), {
    'deep-work': '100%',
    'deep-review': '50%',
  });
});

test('renderValue: distribution with scalar cells (verdict_mix) unchanged', () => {
  const val = { APPROVE: 3, CONCERN: 1, REQUEST_CHANGES: 0 };
  const out = _internal.renderValue(val, 'distribution');
  assert.match(out, /APPROVE=3/);
  assert.match(out, /CONCERN=1/);
  assert.match(out, /REQUEST_CHANGES=0/);
});

test('formatSuiteReportMarkdown surfaces coverage_per_plugin row with per-plugin ratios', async () => {
  const snap = await emptySnapshot();
  const md = formatSuiteReportMarkdown(snap, null);
  // The M5.5-activated metric should appear in the M4-core table; in a
  // greenfield project it still emits a non-null value because the manifest
  // ships with the dashboard plugin (8/8 done snapshot).
  assert.ok(md.includes('suite.tests.coverage_per_plugin'));
  // Each known participating plugin should appear at 100% (8/8 done state).
  assert.match(md, /deep-work=100%/);
  assert.match(md, /deep-dashboard=100%/);
  // No `[object Object]` slip.
  assert.ok(!md.includes('[object Object]'));
});
