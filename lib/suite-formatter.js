/**
 * Suite Telemetry Formatter — M4
 *
 * Renders a markdown suite-level report from the aggregator's snapshot
 * (lib/aggregator.js#buildSnapshot). Compares current snapshot against the
 * previous one (from `.deep-dashboard/suite-metrics.jsonl`) and emits trend
 * arrows per metric:
 *
 *   ↑  current value greater than previous
 *   ↓  current value less than previous
 *   →  current === previous (numeric) or deep-equal (distribution)
 *   ·  no baseline yet (first snapshot — distinguishable from stable)
 *   ?  asymmetric null (signal appeared / vanished) OR distribution shape
 *      divergence
 *
 * Output paths:
 *   formatSuiteReportMarkdown(snapshot, prev?)  → string (Markdown)
 *   writeSuiteReportFile(snapshot, prev?, root) → absolute file path
 *
 * Distribution metrics (e.g., suite.review.verdict_mix) carry a value of
 * `{ APPROVE: n, CONCERN: n, REQUEST_CHANGES: n }`. The formatter renders
 * those as a compact inline literal; trend computation deep-equality-
 * compares the object and emits "?" on shape divergence.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

/**
 * Trend arrows:
 *   ↑   current > previous
 *   ↓   current < previous
 *   →   current === previous (numeric) or deep-equal (distribution)
 *   ·   no baseline yet (first snapshot)
 *   ?   one side is null while the other is a number (signal appeared /
 *       disappeared) OR distribution shape changed
 *
 * Round 1 review (Opus W2): previously, `trendArrow(null, 5)` returned `→`,
 * conflating "stable" with "regressed to unknown". The new `?` makes signal
 * appearance/disappearance visible without forcing the operator to read the
 * raw value column.
 */
function trendArrow(currentValue, previousValue) {
  if (previousValue === undefined) return '·'; // no baseline
  if (currentValue === null && previousValue === null) return '→';
  // Asymmetric null → signal appeared or vanished. Use ? to surface.
  if (currentValue === null || previousValue === null) return '?';
  if (typeof currentValue === 'number' && typeof previousValue === 'number') {
    if (currentValue > previousValue) return '↑';
    if (currentValue < previousValue) return '↓';
    return '→';
  }
  // Distribution / object — comparable shape but not a single scalar.
  try {
    if (JSON.stringify(currentValue) === JSON.stringify(previousValue)) return '→';
  } catch {
    // fall through
  }
  return '?';
}

// ---------------------------------------------------------------------------
// Value rendering
// ---------------------------------------------------------------------------

function renderValue(value, unit) {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    switch (unit) {
      case 'ratio':
        return (value * 100).toFixed(2) + '%';
      case 'seconds':
        // Human-readable duration for freshness metrics
        if (value < 60) return `${value}s`;
        if (value < 3600) return `${Math.floor(value / 60)}m${value % 60}s`;
        if (value < 86400) return `${(value / 3600).toFixed(2)}h`;
        return `${(value / 86400).toFixed(2)}d`;
      case 'count':
        return Number.isInteger(value) ? String(value) : value.toFixed(2);
      case 'numeric':
        return value.toFixed(4);
      default:
        return String(value);
    }
  }
  if (typeof value === 'object') {
    // Distribution — compact inline
    const entries = Object.entries(value).map(([k, v]) => `${k}=${v}`);
    return `{ ${entries.join(', ')} }`;
  }
  return String(value);
}

function escapePipe(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

/**
 * Render a markdown report. Both `snapshot` and `previous` are aggregator
 * snapshots; `previous` may be `null` (no baseline).
 */
export function formatSuiteReportMarkdown(snapshot, previous = null) {
  const lines = [];
  lines.push(`# Suite Telemetry Report`);
  lines.push('');
  lines.push(`- **Run ID**: \`${snapshot.run_id}\``);
  lines.push(`- **Collected at**: ${snapshot.collected_at}`);
  lines.push(`- **Project**: \`${snapshot.project_root}\``);
  if (previous) {
    lines.push(`- **Trend baseline**: \`${previous.run_id}\` (${previous.collected_at})`);
  } else {
    lines.push(`- **Trend baseline**: _none — first snapshot_`);
  }
  lines.push('');
  lines.push(`## Collector self-metrics`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| schema_failures_total | ${snapshot.schema_failures_total} |`);
  lines.push(`| missing_signal_ratio | ${renderValue(snapshot.missing_signal_ratio, 'ratio')} |`);
  lines.push(`| chains (resolved / total) | ${snapshot.chains_resolved} / ${snapshot.chains_total} |`);
  lines.push('');

  // M4-core section — section count derived from the snapshot (post-M5
  // activation: 15 core, 1 deferred; counts may grow as future milestones
  // activate more metrics, so we render from snapshot not a literal).
  const coreCount = Object.values(snapshot.metrics).filter((m) => m.tier === 'M4-core').length;
  const deferredCount = Object.values(snapshot.metrics).filter((m) => m.tier === 'M4-deferred').length;
  lines.push(`## M4-core metrics (${coreCount})`);
  lines.push('');
  lines.push(`| Metric | Value | Trend | Unit |`);
  lines.push(`|---|---|---|---|`);
  for (const [id, m] of Object.entries(snapshot.metrics)) {
    if (m.tier !== 'M4-core') continue;
    const prevValue = previous?.metrics?.[id]?.value;
    const arrow = trendArrow(m.value, prevValue);
    lines.push(`| \`${id}\` | ${escapePipe(renderValue(m.value, m.unit))} | ${arrow} | ${m.unit} |`);
  }
  lines.push('');

  // M4-deferred section
  lines.push(`## M4-deferred metrics (${deferredCount})`);
  lines.push('');
  lines.push(`Sources land in M5.5; currently emit \`null\`.`);
  lines.push('');
  lines.push(`| Metric | Deferred until | Unit |`);
  lines.push(`|---|---|---|`);
  for (const [id, m] of Object.entries(snapshot.metrics)) {
    if (m.tier !== 'M4-deferred') continue;
    lines.push(`| \`${id}\` | ${m.deferred_until} | ${m.unit} |`);
  }
  lines.push('');

  // Per-source breakdown
  lines.push(`## Source summaries`);
  lines.push('');
  for (const [id, m] of Object.entries(snapshot.metrics)) {
    if (m.tier !== 'M4-core') continue;
    if (!m.source_summary) continue;
    const summaryJson = JSON.stringify(m.source_summary);
    if (summaryJson === '{}') continue;
    lines.push(`- \`${id}\` — ${escapePipe(summaryJson)}`);
  }
  lines.push('');
  lines.push(`---`);
  lines.push('');
  lines.push(`_Generated by deep-dashboard suite-formatter. See \`lib/metrics-catalog.yaml\` for metric definitions._`);
  return lines.join('\n');
}

/**
 * Write the markdown report to `.deep-dashboard/suite-report.md` (atomic).
 *
 * @returns {string} absolute path of the written file
 */
export function writeSuiteReportFile(snapshot, previous, projectRoot) {
  const root = path.resolve(projectRoot);
  const outDir = path.join(root, '.deep-dashboard');
  const outFile = path.join(outDir, 'suite-report.md');
  const body = formatSuiteReportMarkdown(snapshot, previous);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, body);
  return outFile;
}

// ---------------------------------------------------------------------------
// Public re-exports
// ---------------------------------------------------------------------------

export const _internal = {
  trendArrow,
  renderValue,
  escapePipe,
};
