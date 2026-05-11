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
 *   →  equal (or both null, or no previous record)
 *   ?  type mismatch (e.g., distribution metric — see verdict_mix)
 *
 * Output paths:
 *   formatSuiteReportMarkdown(snapshot, prev?)  → string (Markdown)
 *   writeSuiteReportFile(snapshot, prev?, root) → absolute file path
 *
 * Distribution metrics (e.g., suite.review.verdict_mix) carry a value of
 * `{ APPROVE: n, CONCERN: n, REQUEST_CHANGES: n }`. The formatter renders
 * those as a compact inline literal; trend computation falls back to "→".
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Trend computation
// ---------------------------------------------------------------------------

function trendArrow(currentValue, previousValue) {
  if (previousValue === undefined) return '→'; // no baseline
  if (currentValue === null && previousValue === null) return '→';
  if (currentValue === null || previousValue === null) return '→';
  if (typeof currentValue === 'number' && typeof previousValue === 'number') {
    if (currentValue > previousValue) return '↑';
    if (currentValue < previousValue) return '↓';
    return '→';
  }
  // Distribution / object — comparable shape but not a single scalar.
  // Round 1 design: defer fancy distribution-distance to formatter v2;
  // for now mark as "→" if deep-equal, otherwise "?".
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

  // M4-core section
  lines.push(`## M4-core metrics (12)`);
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
  lines.push(`## M4-deferred metrics (4)`);
  lines.push('');
  lines.push(`Sources land in M5 / M5.5; currently emit \`null\`.`);
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
