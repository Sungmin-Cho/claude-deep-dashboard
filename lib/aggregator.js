/**
 * Suite Telemetry Aggregator — M4
 *
 * Consumes `collectSuite()` output (lib/suite-collector.js) and emits the
 * 16 suite-level metrics defined in `lib/metrics-catalog.yaml`:
 *
 *   - 12 M4-core   metrics (immediate, M3 envelope-dependent)
 *   - 4  M4-deferred metrics (null, await M5 / M5.5)
 *
 * Output channels:
 *   1. Returns a metrics-snapshot object (consumed by formatter.js + tests).
 *   2. Optionally appends to `.deep-dashboard/suite-metrics.jsonl` (time series).
 *
 * Schema (one JSONL record per snapshot):
 *   {
 *     "run_id":       "<ULID-ish snapshot id>",
 *     "collected_at": "<RFC 3339>",
 *     "project_root": "<absolute path>",
 *     "metrics": {
 *       "suite.hooks.block_rate":                { value, unit, tier, source_summary },
 *       ...
 *     },
 *     "schema_failures_total":   <int>,
 *     "missing_signal_ratio":    <float>,
 *     "chains_total":            <int>,
 *     "chains_resolved":         <int>
 *   }
 *
 * Round 1 review (Codex adv HIGH) influence: M4-deferred metrics emit
 * `{ value: null, deferred_until: "M5" | "M5.5" }` so the JSONL channel is
 * explicit about pending sources rather than silently omitting fields.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';

// ---------------------------------------------------------------------------
// Metric registry — one entry per metric_id (16 total). Mirror of
// lib/metrics-catalog.yaml. Keep this list in sync with the YAML.
// ---------------------------------------------------------------------------

const M4_DEFERRED_METRICS = Object.freeze({
  'suite.compaction.frequency':              { tier: 'M4-deferred', unit: 'count',   deferred_until: 'M5'   },
  'suite.compaction.preserved_artifact_ratio': { tier: 'M4-deferred', unit: 'ratio', deferred_until: 'M5'   },
  'suite.handoff.roundtrip_success_rate':    { tier: 'M4-deferred', unit: 'ratio',   deferred_until: 'M5'   },
  'suite.tests.coverage_per_plugin':         { tier: 'M4-deferred', unit: 'ratio',   deferred_until: 'M5.5' },
});

// ---------------------------------------------------------------------------
// Per-metric computation helpers
// ---------------------------------------------------------------------------

function asObjectOrEmpty(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/** Returns { value, source_summary } for hooks block_rate. */
function computeBlockRate(ndjsonLogs) {
  let blocked = 0;
  let total = 0;
  const perProducer = {};
  for (const src of ndjsonLogs) {
    let srcBlocked = 0;
    for (const e of src.events) {
      total += 1;
      if (e && (e.event === 'hook-block' || e.event === 'hook-deny')) {
        blocked += 1;
        srcBlocked += 1;
      }
    }
    perProducer[`${src.producer}/${src.kind}`] = {
      events: src.events.length,
      blocked: srcBlocked,
    };
  }
  if (total === 0) return { value: null, source_summary: perProducer };
  return { value: blocked / total, source_summary: perProducer };
}

function computeErrorRate(ndjsonLogs) {
  let errored = 0;
  let total = 0;
  const perProducer = {};
  for (const src of ndjsonLogs) {
    let srcErr = 0;
    for (const e of src.events) {
      total += 1;
      if (!e) continue;
      const ev = e.event;
      const isErr =
        ev === 'hook-error' ||
        ev === 'hook-exception' ||
        (typeof e.exit_code === 'number' && e.exit_code !== 0);
      if (isErr) {
        errored += 1;
        srcErr += 1;
      }
    }
    perProducer[`${src.producer}/${src.kind}`] = {
      events: src.events.length,
      errored: srcErr,
    };
  }
  if (total === 0) return { value: null, source_summary: perProducer };
  return { value: errored / total, source_summary: perProducer };
}

function computeFreshnessSeconds(envelopeSources, nowIso) {
  const now = Date.parse(nowIso);
  let oldestMs = null;
  let oldestSource = null;
  let validCount = 0;
  for (const src of envelopeSources) {
    for (const env of src.envelopes) {
      const ts = Date.parse(env.envelope?.generated_at);
      if (Number.isNaN(ts)) continue;
      validCount += 1;
      if (oldestMs === null || ts < oldestMs) {
        oldestMs = ts;
        oldestSource = env.source;
      }
    }
  }
  if (oldestMs === null) {
    return { value: null, source_summary: { valid_envelopes: 0 } };
  }
  const ageSec = Math.max(0, Math.floor((now - oldestMs) / 1000));
  return {
    value: ageSec,
    source_summary: { valid_envelopes: validCount, oldest_source: oldestSource },
  };
}

function computeIntegrateAcceptRate(envelopeSources) {
  const session = envelopeSources.find(
    (s) => s.producer === 'deep-work' && s.kind === 'session-receipt'
  );
  if (!session || session.envelopes.length === 0) {
    return { value: null, source_summary: { sessions: 0 } };
  }
  let accepted = 0;
  let proposed = 0;
  let withIntegrate = 0;
  for (const env of session.envelopes) {
    const integrate = asObjectOrEmpty(env.payload.integrate);
    if (typeof integrate.accepted === 'number' && typeof integrate.proposed === 'number') {
      withIntegrate += 1;
      accepted += integrate.accepted;
      proposed += integrate.proposed;
    }
  }
  if (proposed === 0) {
    return {
      value: null,
      source_summary: { sessions: session.envelopes.length, with_integrate_block: withIntegrate },
    };
  }
  return {
    value: accepted / proposed,
    source_summary: {
      sessions: session.envelopes.length,
      with_integrate_block: withIntegrate,
      accepted,
      proposed,
    },
  };
}

/**
 * Verdict mix from deep-review reports. Reads `.deep-review/reports/*-review.md`
 * and parses the **Verdict** marker. Severity precedence on tie:
 * REQUEST_CHANGES > CONCERN > APPROVE.
 */
const VERDICT_TOKENS = ['REQUEST_CHANGES', 'CONCERN', 'APPROVE'];

function parseVerdictFromMarkdown(text) {
  // Prefer the `**Verdict**:` line (final synthesis). Fall back to the whole
  // document if absent. Case-sensitive — verdict tokens are uppercase by
  // /deep-review convention.
  const verdictLineMatch = text.match(/\*\*Verdict\*\*\s*:?\s*([^\n]+)/);
  const haystack = verdictLineMatch ? verdictLineMatch[1] : text;
  for (const t of VERDICT_TOKENS) {
    if (haystack.includes(t)) return t;
  }
  return null;
}

function readReviewReportsDir(projectRoot) {
  const reportsDir = path.join(projectRoot, '.deep-review/reports');
  try {
    return fs
      .readdirSync(reportsDir)
      .filter((f) => f.endsWith('-review.md'))
      .map((f) => path.join(reportsDir, f));
  } catch {
    return [];
  }
}

function computeVerdictMix(projectRoot) {
  const counts = { APPROVE: 0, CONCERN: 0, REQUEST_CHANGES: 0 };
  const files = readReviewReportsDir(projectRoot);
  let parsed = 0;
  let unparseable = 0;
  for (const file of files) {
    let txt;
    try {
      txt = fs.readFileSync(file, 'utf8');
    } catch {
      unparseable += 1;
      continue;
    }
    const v = parseVerdictFromMarkdown(txt);
    if (v === null) {
      unparseable += 1;
      continue;
    }
    counts[v] += 1;
    parsed += 1;
  }
  if (files.length === 0 || parsed === 0) {
    return { value: null, source_summary: { reports_found: files.length, parsed, unparseable } };
  }
  return {
    value: counts,
    source_summary: { reports_found: files.length, parsed, unparseable },
  };
}

function computeRecurringFindingCount(envelopeSources) {
  const findings = envelopeSources.find(
    (s) => s.producer === 'deep-review' && s.kind === 'recurring-findings'
  );
  if (!findings || findings.envelopes.length === 0) {
    return { value: null, source_summary: { recurring_envelopes: 0 } };
  }
  let recurringCount = 0;
  let totalCount = 0;
  for (const env of findings.envelopes) {
    const arr = Array.isArray(env.payload?.findings) ? env.payload.findings : [];
    totalCount += arr.length;
    for (const f of arr) {
      const occ = Number(f?.occurrences);
      if (Number.isFinite(occ) && occ >= 2) recurringCount += 1;
    }
  }
  return {
    value: recurringCount,
    source_summary: { findings_total: totalCount, recurring_envelopes: findings.envelopes.length },
  };
}

function computeWikiIngestTotal(ndjsonLogs) {
  const wikiLog = ndjsonLogs.find((s) => s.producer === 'deep-wiki' && s.kind === 'log');
  if (!wikiLog) return { value: null, source_summary: { matched: 0 } };
  if (wikiLog.missing) return { value: null, source_summary: { missing: true } };
  let total = 0;
  for (const e of wikiLog.events) {
    if (e && (e.event === 'auto-ingest-candidate' || e.event === 'session-start-detect')) {
      total += 1;
    }
  }
  return { value: total, source_summary: { events_scanned: wikiLog.events.length, matched: total } };
}

function computeDocsAutoFixAcceptRate(envelopeSources) {
  const docs = envelopeSources.find(
    (s) => s.producer === 'deep-docs' && s.kind === 'last-scan'
  );
  if (!docs || docs.envelopes.length === 0) {
    return { value: null, source_summary: { scans: 0 } };
  }
  // last-scan is a single-cardinality source — use the most recent envelope.
  const env = docs.envelopes[0];
  const summary = asObjectOrEmpty(env.payload?.summary);
  const total = Number(summary.total_issues);
  const autoFixable = Number(summary.auto_fixable);
  if (!Number.isFinite(total) || total === 0 || !Number.isFinite(autoFixable)) {
    return { value: null, source_summary: { total_issues: total ?? null } };
  }
  return {
    value: autoFixable / total,
    source_summary: { total_issues: total, auto_fixable: autoFixable },
  };
}

function computeEvolveQDelta(envelopeSources) {
  const evolve = envelopeSources.find(
    (s) => s.producer === 'deep-evolve' && s.kind === 'evolve-receipt'
  );
  if (!evolve || evolve.envelopes.length === 0) {
    return { value: null, source_summary: { receipts: 0 } };
  }
  const env = evolve.envelopes[0];
  const score = asObjectOrEmpty(env.payload?.score);
  const baseline = Number(score.baseline);
  const current = Number(score.current);
  const epochs = Number(env.payload?.evaluation_epochs);
  if (!Number.isFinite(baseline) || !Number.isFinite(current) || !Number.isFinite(epochs) || epochs <= 0) {
    return {
      value: null,
      source_summary: {
        baseline: Number.isFinite(baseline) ? baseline : null,
        current: Number.isFinite(current) ? current : null,
        epochs: Number.isFinite(epochs) ? epochs : null,
      },
    };
  }
  return {
    value: (current - baseline) / epochs,
    source_summary: { baseline, current, epochs },
  };
}

// ---------------------------------------------------------------------------
// Top-level metric snapshot builder
// ---------------------------------------------------------------------------

/**
 * Build a metric snapshot from a collectSuite() result.
 *
 * @param {object} collected — return value of collectSuite()
 * @param {object} [options]
 * @param {string} [options.nowIso] — testability override for "now"
 * @param {string} [options.run_id] — override the generated snapshot run_id
 * @returns {object} the metrics snapshot
 */
export function buildSnapshot(collected, options = {}) {
  const nowIso = options.nowIso ?? new Date().toISOString();
  const run_id = options.run_id ?? randomUUID();
  const { envelopes, ndjson_logs } = collected.sources;

  const m = {};
  const wrap = (id, tier, unit, { value, source_summary }) => {
    m[id] = { value, unit, tier, source_summary };
  };

  // M4-core (12)
  wrap('suite.hooks.block_rate',                 'M4-core', 'ratio',    computeBlockRate(ndjson_logs));
  wrap('suite.hooks.error_rate',                 'M4-core', 'ratio',    computeErrorRate(ndjson_logs));
  wrap('suite.artifact.freshness_seconds',       'M4-core', 'seconds',  computeFreshnessSeconds(envelopes, nowIso));
  wrap('suite.artifact.schema_failures_total',   'M4-core', 'count',
       { value: collected.schema_failures_total, source_summary: { collector_run: collected.collected_at } });
  wrap('suite.integrate.recommendation_accept_rate', 'M4-core', 'ratio', computeIntegrateAcceptRate(envelopes));
  wrap('suite.review.verdict_mix',               'M4-core', 'distribution', computeVerdictMix(collected.project_root));
  wrap('suite.review.recurring_finding_count',   'M4-core', 'count',    computeRecurringFindingCount(envelopes));
  wrap('suite.wiki.auto_ingest_candidates_total','M4-core', 'count',    computeWikiIngestTotal(ndjson_logs));
  wrap('suite.docs.auto_fix_accept_rate',        'M4-core', 'ratio',    computeDocsAutoFixAcceptRate(envelopes));
  wrap('suite.evolve.q_delta_per_epoch',         'M4-core', 'numeric',  computeEvolveQDelta(envelopes));
  wrap('suite.dashboard.missing_signal_ratio',   'M4-core', 'ratio',
       { value: collected.missing_signal_ratio,
         source_summary: { expected_total: 11, denominator_includes: 'envelope+ndjson' } });
  wrap('suite.cross_plugin.run_id_chain_completeness', 'M4-core', 'ratio',
       { value: collected.chains.completeness,
         source_summary: { total: collected.chains.total, resolved: collected.chains.resolved } });

  // M4-deferred (4) — emit null with explicit deferred_until marker
  for (const [id, meta] of Object.entries(M4_DEFERRED_METRICS)) {
    m[id] = {
      value: null,
      unit: meta.unit,
      tier: meta.tier,
      deferred_until: meta.deferred_until,
      source_summary: { deferred: true },
    };
  }

  return {
    run_id,
    collected_at: nowIso,
    project_root: collected.project_root,
    metrics: m,
    schema_failures_total: collected.schema_failures_total,
    missing_signal_ratio: collected.missing_signal_ratio,
    chains_total: collected.chains.total,
    chains_resolved: collected.chains.resolved,
  };
}

// ---------------------------------------------------------------------------
// JSONL append (time series)
// ---------------------------------------------------------------------------

/**
 * Append a snapshot record to `.deep-dashboard/suite-metrics.jsonl`.
 *
 * Append-only by design — historical records are never rewritten. The
 * formatter reads the last N records to render trend (↑/↓/→).
 *
 * @returns {string} absolute path of the JSONL file
 */
export function appendSnapshot(snapshot, projectRoot) {
  const root = path.resolve(projectRoot);
  const outDir = path.join(root, '.deep-dashboard');
  const outFile = path.join(outDir, 'suite-metrics.jsonl');
  fs.mkdirSync(outDir, { recursive: true });
  // Atomic-ish: one fs.appendFileSync writes the full line. Newline-terminated
  // so partial reads don't corrupt the next record.
  fs.appendFileSync(outFile, JSON.stringify(snapshot) + '\n');
  return outFile;
}

/**
 * Read the last `n` snapshot records from `.deep-dashboard/suite-metrics.jsonl`,
 * newest-last (i.e., chronological order). Malformed lines are skipped silently
 * — trend rendering should not crash on partial corruption.
 *
 * @returns {Promise<object[]>}
 */
export async function readRecentSnapshots(projectRoot, n = 2) {
  const file = path.join(path.resolve(projectRoot), '.deep-dashboard', 'suite-metrics.jsonl');
  if (!fs.existsSync(file)) return [];
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const all = [];
  for await (const line of rl) {
    const t = line.trim();
    if (t === '') continue;
    try {
      all.push(JSON.parse(t));
    } catch {
      // skip malformed line
    }
  }
  return all.slice(-n);
}

// ---------------------------------------------------------------------------
// Public exports for testing
// ---------------------------------------------------------------------------

export const _internal = {
  computeBlockRate,
  computeErrorRate,
  computeFreshnessSeconds,
  computeIntegrateAcceptRate,
  computeVerdictMix,
  computeRecurringFindingCount,
  computeWikiIngestTotal,
  computeDocsAutoFixAcceptRate,
  computeEvolveQDelta,
  parseVerdictFromMarkdown,
  M4_DEFERRED_METRICS,
};
