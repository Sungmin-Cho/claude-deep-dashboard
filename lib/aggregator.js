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
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';
import { AGGREGATOR_KINDS, EXPECTED_SOURCES } from './suite-constants.js';

// ---------------------------------------------------------------------------
// Metric registry — one entry per metric_id (16 total). Mirror of
// lib/metrics-catalog.yaml. Keep this list in sync with the YAML.
// ---------------------------------------------------------------------------

// M5 activation (2026-05-11): the 3 M5-gated metrics promoted to M4-core.
// M5.5 activation (2026-05-12): suite.tests.coverage_per_plugin promoted to
// M4-core, sourced from lib/test-catalog-manifest.json (mirrors
// claude-deep-suite docs/test-catalog.md §1-§8). The deferred map is now
// empty; the forward-compat slot is preserved so future milestones can
// register new deferred metrics without restructuring buildSnapshot().
const M4_DEFERRED_METRICS = Object.freeze({});

// ---------------------------------------------------------------------------
// Test catalog manifest loader (M5.5-activated source)
// ---------------------------------------------------------------------------
// Manifest is dashboard-internal (ships with the plugin) and is the single
// source of truth for suite.tests.coverage_per_plugin. Edited manually in
// lockstep with claude-deep-suite docs/test-catalog.md (similar to the
// ADOPTION_LEDGER policy in suite-constants.js).
const __dirname_agg = path.dirname(fileURLToPath(import.meta.url));
const TEST_CATALOG_MANIFEST_PATH = path.join(__dirname_agg, 'test-catalog-manifest.json');

function loadTestCatalogManifest() {
  try {
    const raw = fs.readFileSync(TEST_CATALOG_MANIFEST_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-metric computation helpers
// ---------------------------------------------------------------------------

function asObjectOrEmpty(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * Returns { value, source_summary } for hooks block_rate.
 *
 * Round 1 review (3-way: Codex review P2 + Codex adversarial HIGH): the
 * denominator must include ONLY hook-log sources (kind === 'hook-log').
 * The deep-wiki vault `log.jsonl` (kind === 'log') tracks wiki ingest events,
 * not hook invocations — previously, a busy wiki log inflated the denominator
 * and made real hook blocks look rare.
 */
function computeBlockRate(ndjsonLogs) {
  let blocked = 0;
  let total = 0;
  const perProducer = {};
  for (const src of ndjsonLogs) {
    if (src.kind !== 'hook-log') continue;
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

/** Same kind === 'hook-log' filter as computeBlockRate (Round 1 fix). */
function computeErrorRate(ndjsonLogs) {
  let errored = 0;
  let total = 0;
  const perProducer = {};
  for (const src of ndjsonLogs) {
    if (src.kind !== 'hook-log') continue;
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
 * and parses the **Verdict** marker. Precedence:
 *
 *   1. PREFERRED — anchor to the leading verdict token: match
 *      `^<TOKEN>\b` against the verdict-line tail (after stripping leading
 *      whitespace, markdown emphasis, and backticks). Handles the common
 *      case where the verdict token sits at the start of the line (Round 1
 *      review: Opus W1 — prevents substring poisoning like
 *      "APPROVE — no CONCERN raised" returning CONCERN).
 *   2. FALLBACK — if no leading token (e.g., line starts with an emoji
 *      `✅` or status prefix `Status:`, or is a markdown table cell),
 *      pick the **earliest-positioned** verdict token in the line by
 *      comparing `match.index`. Round 2 review (NEW-1) replaced the
 *      original severity-ordered scan with this position-first rule
 *      because severity-ordered iteration silently re-introduced the
 *      same substring-poisoning bug for emoji-prefixed verdicts.
 *   3. LAST RESORT — if no `**Verdict**:` line at all, do the same
 *      earliest-position scan across the whole document.
 *
 * VERDICT_TOKENS ordering remains REQUEST_CHANGES → CONCERN → APPROVE
 * only as a tie-breaker if two tokens were ever to match at the same
 * position (impossible for our disjoint word-boundaried tokens, but
 * documented for forward-compat).
 */
const VERDICT_TOKENS = ['REQUEST_CHANGES', 'CONCERN', 'APPROVE'];

function parseVerdictFromMarkdown(text) {
  const verdictLineMatch = text.match(/\*\*Verdict\*\*\s*:?\s*([^\n]+)/);
  if (verdictLineMatch) {
    const tail = verdictLineMatch[1];
    // Tier 1: strip ASCII markdown emphasis (`**APPROVE**` / `*APPROVE*` /
    // `` `APPROVE` ``) and anchor on word-boundaried token. Handles the
    // common case where the verdict token sits at the start of the line.
    const cleaned = tail.replace(/^[\s*`_]+/, '');
    for (const t of VERDICT_TOKENS) {
      const re = new RegExp(`^${t}\\b`);
      if (re.test(cleaned)) return t;
    }
    // Tier 2: first-token-by-position wins inside the verdict line. This
    // handles two cases simultaneously:
    //   (a) emoji / status prefixes that tier-1's ASCII strip can't remove:
    //       `**Verdict**: ✅ APPROVE — no CONCERN raised`
    //   (b) table-cell verdicts: `| ✅ | APPROVE |`
    // Round 2 review (NEW-1): a severity-ordered token loop without position
    // comparison silently re-introduced substring poisoning when the verdict
    // line contained distractor words after the real verdict (e.g.,
    // "✅ APPROVE — no CONCERN raised" returned CONCERN because iterator
    // order, not text order, decided the winner).
    let bestIndex = -1;
    let bestToken = null;
    for (const t of VERDICT_TOKENS) {
      const re = new RegExp(`\\b${t}\\b`);
      const match = re.exec(tail);
      if (match === null) continue;
      const idx = match.index;
      // Strictly earlier position wins. On a tie (impossible because tokens
      // are distinct and word-boundaried), severity precedence (the
      // VERDICT_TOKENS array order) wins.
      if (bestIndex === -1 || idx < bestIndex) {
        bestIndex = idx;
        bestToken = t;
      }
    }
    return bestToken;
  }
  // No **Verdict**: line — first-token-by-position scan across the whole doc.
  let bestIndex = -1;
  let bestToken = null;
  for (const t of VERDICT_TOKENS) {
    const re = new RegExp(`\\b${t}\\b`);
    const match = re.exec(text);
    if (match === null) continue;
    if (bestIndex === -1 || match.index < bestIndex) {
      bestIndex = match.index;
      bestToken = t;
    }
  }
  return bestToken;
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
  // last-scan.json is single-cardinality (one file at `.deep-docs/last-scan.json`),
  // so `docs.envelopes` always has at most one entry. The `[0]` access is a
  // contract with the collector — Round 1 review (Opus I6) flagged that this
  // implicit ordering deserves a comment. If the collector ever evolves to
  // emit multiple last-scan envelopes (e.g., per-shard), this needs sort-by-
  // generated_at-desc instead. Same pattern applies to evolve-receipt below.
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
  // Single-cardinality source — see contract note in computeDocsAutoFixAcceptRate.
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
// M5-activated metrics
// ---------------------------------------------------------------------------
//
// Source: claude-deep-suite/schemas/{handoff,compaction-state}.schema.json
//         (ratified in suite repo PR #12, merged 2026-05-11).
// Formulas:
//   - suite.compaction.frequency: total count of compaction-state envelopes;
//     source_summary surfaces unique session_ids for drill-down (per the
//     context-management.md §5 "per-session frequency" intent).
//   - suite.compaction.preserved_artifact_ratio: mean of per-envelope ratios
//     `len(preserved) / (len(preserved) + len(discarded))`, computed ONLY for
//     envelopes that carry BOTH paths. Per context-management.md §5: when
//     discarded_artifact_paths is omitted, the dashboard treats the ratio as
//     undefined for that artifact (NOT zero). Empty-preserved + empty-discarded
//     (a "full-reset" with both paths declared empty) is also undefined
//     (avoids a misleading "0/0 = 0" reading).
//   - suite.handoff.roundtrip_success_rate: per long-run-handoff.md §7,
//     a handoff "round-trips" when ANY non-aggregator envelope's
//     parent_run_id chains to this handoff's run_id (covers both reverse
//     handoff and downstream receipt cases).

function computeCompactionFrequency(envelopeSources) {
  // Round 1 review fix (C1): collect from ALL (producer, compaction-state)
  // sources — both deep-work and deep-evolve. Guide §6 lists both producers.
  const sources = envelopeSources.filter((s) => s.kind === 'compaction-state');
  const allEnvelopes = sources.flatMap((s) => s.envelopes);
  if (allEnvelopes.length === 0) {
    return { value: null, source_summary: { total_events: 0 } };
  }
  const sessions = new Set();
  for (const env of allEnvelopes) {
    const sid = env.payload?.session_id;
    if (typeof sid === 'string' && sid.length > 0) sessions.add(sid);
  }
  // Round 2 review fix (W3, 2-way): only list producers that actually
  // contributed envelopes — empty sources should not appear in the
  // drill-down (Codex P3 + Opus Info-2).
  const compactionProducersWithData = sources
    .filter((s) => s.envelopes.length > 0)
    .map((s) => s.producer)
    .sort();
  return {
    value: allEnvelopes.length,
    source_summary: {
      total_events: allEnvelopes.length,
      unique_sessions: sessions.size,
      compaction_producers: compactionProducersWithData,
    },
  };
}

function computeCompactionPreservedArtifactRatio(envelopeSources) {
  // Round 1 review fix (C1): cross-producer source aggregation (same rationale
  // as computeCompactionFrequency above).
  const sources = envelopeSources.filter((s) => s.kind === 'compaction-state');
  const allEnvelopes = sources.flatMap((s) => s.envelopes);
  if (allEnvelopes.length === 0) {
    return { value: null, source_summary: { envelopes_with_ratio: 0, envelopes_without_ratio: 0 } };
  }
  const ratios = [];
  let withoutRatio = 0;
  for (const env of allEnvelopes) {
    const preserved = Array.isArray(env.payload?.preserved_artifact_paths)
      ? env.payload.preserved_artifact_paths.length
      : null;
    const discarded = Array.isArray(env.payload?.discarded_artifact_paths)
      ? env.payload.discarded_artifact_paths.length
      : null;
    // Per guide §5: undefined when discarded_artifact_paths omitted; also
    // undefined when preserved+discarded = 0 (full-reset has no ratio shape).
    if (preserved === null || discarded === null || preserved + discarded === 0) {
      withoutRatio += 1;
      continue;
    }
    ratios.push(preserved / (preserved + discarded));
  }
  if (ratios.length === 0) {
    return {
      value: null,
      source_summary: { envelopes_with_ratio: 0, envelopes_without_ratio: withoutRatio },
    };
  }
  const mean = ratios.reduce((acc, x) => acc + x, 0) / ratios.length;
  return {
    value: mean,
    source_summary: {
      envelopes_with_ratio: ratios.length,
      envelopes_without_ratio: withoutRatio,
    },
  };
}

function computeHandoffRoundtripSuccessRate(envelopeSources) {
  // Round 1 review fix (C1, 3-way agreement): collect handoffs from ALL
  // (producer, handoff) sources — both deep-work (forward) and deep-evolve
  // (reverse). Per long-run-handoff.md §7, both directions can be present.
  const handoffSources = envelopeSources.filter((s) => s.kind === 'handoff');
  const allHandoffs = handoffSources.flatMap((s) => s.envelopes);
  if (allHandoffs.length === 0) {
    return { value: null, source_summary: { handoffs_total: 0 } };
  }
  // Round 3 review fix (C3, Codex adversarial HIGH): a reverse handoff
  // (handoff whose parent_run_id chains to ANOTHER handoff's run_id) IS the
  // receiver's success signal for the upstream handoff, per guide §7. It is
  // NOT a fresh initiating handoff requiring its own child. Counting it in
  // the denominator caps the canonical happy path (forward + reverse) at
  // 50% — materially misleading.
  //
  // Fix: denominator = "initiating" handoffs only (parent_run_id either
  // absent or chaining to something that is NOT another handoff, e.g., a
  // session-receipt). Continuation handoffs are still consumed by the
  // numerator check (the receiver-produced child branch).
  const allHandoffRunIds = new Set();
  for (const env of allHandoffs) {
    const rid = env.envelope?.run_id;
    if (typeof rid === 'string' && rid.length > 0) allHandoffRunIds.add(rid);
  }
  const initiatingHandoffs = allHandoffs.filter((env) => {
    const parent = env.envelope?.parent_run_id;
    // initiating ⇔ no parent OR parent does not chain to another handoff
    return !(typeof parent === 'string' && allHandoffRunIds.has(parent));
  });
  if (initiatingHandoffs.length === 0) {
    return {
      value: null,
      source_summary: {
        handoffs_total: 0,
        handoffs_continuation: allHandoffs.length,
      },
    };
  }
  // Round 1 review fix (W1): exclude aggregator-kind envelopes from the
  // child iteration (catalog contract: "downstream non-aggregator envelope").
  //
  // Round 2 review fix (W2): tighten the receiver semantics. The guide §7
  // says "the **receiver** either emits a reverse handoff back, OR emits a
  // final receipt whose parent_run_id chains back". A non-aggregator child
  // from the SENDER (e.g., a follow-up session-receipt emitted by the same
  // deep-work session that produced the handoff) would falsely count under
  // the round-1 logic. The fix: require the child envelope's `producer` to
  // match the handoff's `payload.to.producer` (the declared receiver).
  //
  // Index children by parent_run_id → Set<child producer> so we can check
  // membership against the expected receiver at handoff iteration time.
  const childProducersByParent = new Map();
  for (const src of envelopeSources) {
    for (const env of src.envelopes) {
      const kind = env.envelope?.artifact_kind;
      if (AGGREGATOR_KINDS.has(kind)) continue;
      const parent = env.envelope?.parent_run_id;
      const self = env.envelope?.run_id;
      const childProducer = env.envelope?.producer;
      // Skip self-chains: an envelope can't roundtrip itself.
      if (
        typeof parent === 'string' && parent.length > 0 && parent !== self &&
        typeof childProducer === 'string' && childProducer.length > 0
      ) {
        let bucket = childProducersByParent.get(parent);
        if (bucket === undefined) {
          bucket = new Set();
          childProducersByParent.set(parent, bucket);
        }
        bucket.add(childProducer);
      }
    }
  }
  let roundtripped = 0;
  for (const env of initiatingHandoffs) {
    const rid = env.envelope?.run_id;
    const expectedReceiver = env.payload?.to?.producer;
    if (typeof rid !== 'string' || rid.length === 0) continue;
    if (typeof expectedReceiver !== 'string' || expectedReceiver.length === 0) continue;
    const childProducers = childProducersByParent.get(rid);
    if (childProducers && childProducers.has(expectedReceiver)) {
      roundtripped += 1;
    }
  }
  // Round 2 review fix (W3, 2-way: Codex P3 + Opus Info-2): only list
  // producers that actually contributed envelopes — empty sources should not
  // appear in the drill-down.
  const handoffProducersWithData = handoffSources
    .filter((s) => s.envelopes.length > 0)
    .map((s) => s.producer)
    .sort();
  return {
    value: roundtripped / initiatingHandoffs.length,
    source_summary: {
      handoffs_total: initiatingHandoffs.length,
      handoffs_continuation: allHandoffs.length - initiatingHandoffs.length,
      handoffs_roundtripped: roundtripped,
      handoff_producers: handoffProducersWithData,
    },
  };
}

// ---------------------------------------------------------------------------
// M5.5-activated metric (1)
// ---------------------------------------------------------------------------
//
// suite.tests.coverage_per_plugin — per-plugin coverage against the 8-item
// M5.5 standard test catalog (claude-deep-suite docs/test-catalog.md §1-§8).
//
// Source: lib/test-catalog-manifest.json (dashboard-internal, mirrors the
// suite-repo catalog 1:1). Manifest is updated manually when the suite docs
// change — drift is not validated by CI (a manual review-time check; the
// manifest's `last_updated` field should bump alongside the suite docs).
//
// Output shape (per next-session-prompt + catalog spec):
//   {
//     "deep-work":      { covered: 4, expected: 4, ratio: 1.0, tests: ["3","4","7","8"] },
//     "deep-evolve":    { covered: 4, expected: 4, ratio: 1.0, tests: ["3","4","5","8"] },
//     ...
//   }
//
// Plugins that participate in zero catalog tests (e.g., deep-docs in the
// current 8-item catalog) are OMITTED from the value map — including them
// with `ratio: null` would clutter the distribution without adding signal.
// `source_summary.plugins_unparticipating` lists them for transparency.
//
// `options.manifestOverride` is a test-only hook (fixture injection). In
// production the manifest is read from disk via loadTestCatalogManifest().

const KNOWN_SUITE_PLUGINS = Object.freeze([
  'suite',
  'deep-work',
  'deep-evolve',
  'deep-wiki',
  'deep-review',
  'deep-dashboard',
  'deep-docs',
]);

function computeTestsCoveragePerPlugin(options = {}) {
  const manifest =
    options.manifestOverride !== undefined
      ? options.manifestOverride
      : loadTestCatalogManifest();
  if (!manifest || !Array.isArray(manifest.tests)) {
    return {
      value: null,
      source_summary: { manifest_present: false },
    };
  }
  const tests = manifest.tests;
  if (tests.length === 0) {
    return {
      value: null,
      source_summary: {
        manifest_present: true,
        catalog_version: manifest.catalog_version ?? null,
        tests_total: 0,
      },
    };
  }
  const perPlugin = {};
  for (const t of tests) {
    if (!Array.isArray(t.participating_plugins)) continue;
    const passed = t.status === 'done';
    for (const p of t.participating_plugins) {
      if (typeof p !== 'string' || p.length === 0) continue;
      if (!perPlugin[p]) {
        perPlugin[p] = { covered: 0, expected: 0, tests: [] };
      }
      perPlugin[p].expected += 1;
      perPlugin[p].tests.push(String(t.id));
      if (passed) perPlugin[p].covered += 1;
    }
  }
  for (const cell of Object.values(perPlugin)) {
    cell.tests.sort((a, b) => Number(a) - Number(b));
    cell.ratio = cell.expected === 0 ? null : cell.covered / cell.expected;
  }
  const participating = Object.keys(perPlugin).sort();
  const unparticipating = KNOWN_SUITE_PLUGINS.filter(
    (p) => !(p in perPlugin)
  ).sort();
  return {
    value: perPlugin,
    source_summary: {
      manifest_present: true,
      catalog_version: manifest.catalog_version ?? null,
      last_updated: manifest.last_updated ?? null,
      tests_total: tests.length,
      plugins_participating: participating.length,
      plugins_unparticipating: unparticipating,
    },
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
         source_summary: { expected_total: EXPECTED_SOURCES.length, denominator_includes: 'envelope+ndjson' } });
  wrap('suite.cross_plugin.run_id_chain_completeness', 'M4-core', 'ratio',
       { value: collected.chains.completeness,
         source_summary: { total: collected.chains.total, resolved: collected.chains.resolved } });

  // M5-activated (3 — promoted from M4-deferred 2026-05-11)
  wrap('suite.compaction.frequency',                 'M4-core', 'count', computeCompactionFrequency(envelopes));
  wrap('suite.compaction.preserved_artifact_ratio',  'M4-core', 'ratio', computeCompactionPreservedArtifactRatio(envelopes));
  wrap('suite.handoff.roundtrip_success_rate',       'M4-core', 'ratio', computeHandoffRoundtripSuccessRate(envelopes));

  // M5.5-activated (1 — promoted from M4-deferred 2026-05-12)
  // Source: lib/test-catalog-manifest.json (mirrors claude-deep-suite
  // docs/test-catalog.md §1-§8). Per-plugin distribution; see
  // computeTestsCoveragePerPlugin for value shape.
  wrap('suite.tests.coverage_per_plugin',            'M4-core', 'distribution', computeTestsCoveragePerPlugin());

  // M4-deferred (0 — all previously-deferred metrics activated by M5/M5.5).
  // Forward-compat slot preserved: future milestones can register new
  // deferred metrics in M4_DEFERRED_METRICS without restructuring this block.
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
 * formatter reads the last N records to render trend (↑/↓/→/·/?, see
 * suite-formatter.js for the full arrow vocabulary).
 *
 * Concurrency note (Round 1 review: Opus W3): `fs.appendFileSync` with
 * `O_APPEND` is POSIX-atomic only for writes ≤ `PIPE_BUF` (≈ 4 KiB on
 * macOS/Linux). A full M4 snapshot can easily exceed that — under concurrent
 * multi-process writers (rare for an interactive CLI tool, possible for a
 * daemon), two writes may interleave inside one line. `readRecentSnapshots`
 * silently skips malformed lines, so the failure mode is data loss, not
 * crash. Safe for single-process interactive use; multi-writer setups should
 * wrap callers in an external advisory lock (`proper-lockfile` or similar).
 *
 * Rotation: this file grows unbounded. A retention/rotation knob is a M5
 * candidate (see backlog).
 *
 * @returns {string} absolute path of the JSONL file
 */
export function appendSnapshot(snapshot, projectRoot) {
  const root = path.resolve(projectRoot);
  const outDir = path.join(root, '.deep-dashboard');
  const outFile = path.join(outDir, 'suite-metrics.jsonl');
  fs.mkdirSync(outDir, { recursive: true });
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
  computeCompactionFrequency,
  computeCompactionPreservedArtifactRatio,
  computeHandoffRoundtripSuccessRate,
  computeTestsCoveragePerPlugin,
  loadTestCatalogManifest,
  parseVerdictFromMarkdown,
  M4_DEFERRED_METRICS,
};
