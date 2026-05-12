/**
 * Suite-wide constants for deep-dashboard M4 telemetry.
 *
 * Single source of truth for:
 * 1. M3 envelope adoption ledger reference dates (T+0 and T+0+6mo).
 * 2. Per-plugin adoption-since dates (mirrors claude-deep-suite/docs/envelope-migration.md §6.1).
 * 3. Legacy fallback policy thresholds.
 *
 * The 6-month legacy fallback timer is hard-coded HERE only — collector.js,
 * aggregator.js, and formatter.js all import from this module. Updates
 * happen here in lockstep with the suite-repo ledger.
 */

// ---------------------------------------------------------------------------
// Adoption ledger constants
// ---------------------------------------------------------------------------
// T+0 = 2026-05-07 (deep-docs PR #N merge — first envelope adoption).
// Six-month legacy fallback timer cutoff: 2026-11-07T00:00:00Z (exclusive — i.e.
// any wall-clock instant strictly past midnight UTC on 2026-11-07 returns true
// from legacyFallbackExpired()). At that point the dashboard switches from
// silent-fallback to warning-emit for any plugin artifact whose envelope
// adoption is still pending.
//
// Per M3 Phase 3 handoff §5: "현재 상태 — 6/6 plugin envelope adoption 완료.
// 이론적으로는 warning trigger 가 발생하지 않을 예정. 다만 사용자가 직접
// plugin downgrade 시 활성." — so the warning is a defensive guard for the
// downgrade path, not an expected emit during normal operation.

export const ENVELOPE_ROLLOUT = Object.freeze({
  /** First envelope adoption (T+0). RFC 3339 date (UTC-anchored). */
  t0_date: '2026-05-07',
  /** Six-month legacy fallback timer cutoff (T+0+6mo). Exclusive comparison:
   *  legacyFallbackExpired() returns true iff `now > 2026-11-07T00:00:00Z`. */
  t0_plus_6mo_date: '2026-11-07',
});

// ---------------------------------------------------------------------------
// Per-plugin adoption ledger (mirrors claude-deep-suite docs/envelope-migration.md §6.1)
// ---------------------------------------------------------------------------
// Used by collector.js when emitting `dashboard.adoption_status` per plugin and
// by aggregator.js to decide `legacy_fallback_warning` for `missing_signal_ratio`.

export const ADOPTION_LEDGER = Object.freeze({
  'deep-docs':       { version: '1.2.0', since: '2026-05-07', sha: '3cc522933916a9e54e920ef2b694a879e24a01b1' },
  'deep-dashboard':  { version: '1.2.0', since: '2026-05-07', sha: 'cfd07bd5c1feb37f85bc86d91b0987f1e8eb1910' },
  'deep-work':       { version: '6.5.0', since: '2026-05-07', sha: '6f23e79a72af30c730e97f309167d060856fa697' },
  'deep-evolve':     { version: '3.2.0', since: '2026-05-08', sha: '9b867b1e23c2c5b35cfca239fe691f3eb864b499' },
  'deep-review':     { version: '1.4.0', since: '2026-05-08', sha: 'a76473fdbd540127f7c9492c76934a198dc9602b' },
  'deep-wiki':       { version: '1.5.0', since: '2026-05-11', sha: '4f5cbf8c6a2c6cff352389c4f914cab678bcf4ad' },
});

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when `nowIso` is strictly past the 6-month legacy fallback timer
 * (`2026-11-07T00:00:00Z`, exclusive). Accepts an injectable `nowIso` for
 * testability (default = current wall clock).
 *
 * Boundary semantics:
 *   - `2026-11-06T23:59:59Z` → false
 *   - `2026-11-07T00:00:00Z` → false  (cutoff is exclusive)
 *   - `2026-11-07T00:00:01Z` → true
 */
export function legacyFallbackExpired(nowIso = new Date().toISOString()) {
  const now = Date.parse(nowIso);
  const cutoff = Date.parse(`${ENVELOPE_ROLLOUT.t0_plus_6mo_date}T00:00:00Z`);
  if (Number.isNaN(now) || Number.isNaN(cutoff)) return false;
  return now > cutoff;
}

// ---------------------------------------------------------------------------
// EXPECTED_SOURCES — denominator catalog for missing_signal_ratio
// ---------------------------------------------------------------------------
// Each entry declares one source the M4-core metric layer depends on. Two
// types are observable in PR 1:
//   - `envelope`: producer-emitted M3 envelope-wrapped artifact (8 sources).
//   - `ndjson`:   producer-emitted append-only event log (3 sources: 2 hook
//                 logs — deep-work + deep-evolve — and the deep-wiki vault
//                 `log.jsonl`).
//
// `deep-review/review-report` markdown-frontmatter source enters EXPECTED_SOURCES
// in PR 2 when the formatter learns to parse `.deep-review/reports/*-review.md`.
// Keeping it out of the denominator now means the ratio is honest about
// "what the collector actually checks" — not aspirational.

export const EXPECTED_SOURCES = Object.freeze([
  // Envelope-wrapped artifacts (12 — 8 baseline + 4 M5 activations)
  { producer: 'deep-work',      kind: 'session-receipt',       type: 'envelope' },
  { producer: 'deep-work',      kind: 'slice-receipt',         type: 'envelope' },
  { producer: 'deep-review',    kind: 'recurring-findings',    type: 'envelope' },
  { producer: 'deep-docs',      kind: 'last-scan',             type: 'envelope' },
  { producer: 'deep-evolve',    kind: 'evolve-receipt',        type: 'envelope' },
  { producer: 'deep-evolve',    kind: 'evolve-insights',       type: 'envelope' },
  { producer: 'deep-dashboard', kind: 'harnessability-report', type: 'envelope' },
  { producer: 'deep-wiki',      kind: 'index',                 type: 'envelope' },
  // M5 schemas ratified in claude-deep-suite (PRs #12/#13 merged 2026-05-11) —
  // schemas/handoff.schema.json + schemas/compaction-state.schema.json. The
  // dashboard activates these to power suite.handoff.roundtrip_success_rate
  // and suite.compaction.{frequency, preserved_artifact_ratio}.
  //
  // Round 1 review fix (C1, 3-way agreement): the canonical scenarios from
  // claude-deep-suite/guides/long-run-handoff.md include the reverse handoff
  // emitted by deep-evolve (`handoff_kind: "evolve-to-deep-work"`). Similarly
  // guides/context-management.md §6 lists deep-evolve as a compaction-state
  // emitter at epoch boundaries. Without these tuples the dashboard would
  // either misclassify a deep-evolve envelope as `identity-mismatch` (if it
  // ever landed under .deep-work/) or never discover it at all (the canonical
  // emit path is per-producer).
  { producer: 'deep-work',      kind: 'handoff',               type: 'envelope' },
  { producer: 'deep-work',      kind: 'compaction-state',      type: 'envelope' },
  { producer: 'deep-evolve',    kind: 'handoff',               type: 'envelope' },
  { producer: 'deep-evolve',    kind: 'compaction-state',      type: 'envelope' },
  // NDJSON event logs (3) — hook activity + deep-wiki vault event stream
  { producer: 'deep-work',      kind: 'hook-log',              type: 'ndjson'   },
  { producer: 'deep-evolve',    kind: 'hook-log',              type: 'ndjson'   },
  { producer: 'deep-wiki',      kind: 'log',                   type: 'ndjson'   },
  // (deep-review review-report markdown is deferred to PR 2's verdict_mix
  //  formatter — collector does not parse markdown frontmatter in PR 1)
]);

// ---------------------------------------------------------------------------
// PAYLOAD_REQUIRED_FIELDS — minimal field check per producer/kind
// ---------------------------------------------------------------------------
// Mirrors the `required` keyword from each authoritative payload schema in
// claude-deep-suite/schemas/payload-registry/<producer>/<kind>/v1.0.schema.json.
// This is a zero-dependency lightweight check (no ajv) — matching the precedent
// in scripts/validate-envelope-emit.js. Strict full-schema validation would
// require a JSON Schema validator runtime; this minimal check catches the
// common "empty-{} payload silently passes" failure mode flagged by adversarial
// review without pulling in a new dependency. Full schema validation is a
// candidate for M5 once ajv adoption is suite-wide.
//
// Producer-side emit-validators (scripts/validate-envelope-emit.js +
// equivalent in each plugin repo) remain the source of truth for full schema
// conformance. The dashboard's responsibility is to reject obviously-broken
// envelopes before they corrupt downstream aggregation.

export const PAYLOAD_REQUIRED_FIELDS = Object.freeze({
  'deep-work/session-receipt':       ['session_id', 'started_at', 'outcome', 'slices'],
  'deep-work/slice-receipt':         ['slice_id', 'status', 'tdd'],
  'deep-review/recurring-findings':  ['updated_at', 'findings'],
  'deep-docs/last-scan':             ['provenance', 'documents', 'summary'],
  'deep-evolve/evolve-receipt':      ['plugin', 'version', 'receipt_schema_version', 'timestamp', 'session_id', 'goal', 'experiments', 'score'],
  'deep-evolve/evolve-insights':     ['updated_at'],
  'deep-dashboard/harnessability-report': ['projectRoot', 'total', 'grade', 'dimensions', 'recommendations'],
  'deep-wiki/index':                 ['pages'],
  // M5: cross-plugin handoff payload (claude-deep-suite/schemas/handoff.schema.json,
  // schema_version 1.0). Mirrors the schema's `required[]` keyword 1:1.
  // The deep-evolve entry covers the reverse-handoff scenario
  // (`handoff_kind: "evolve-to-deep-work"`) — same payload shape, different
  // envelope.producer. The required fields are identical because the schema
  // is producer-agnostic.
  'deep-work/handoff':               ['schema_version', 'handoff_kind', 'from', 'to', 'summary', 'next_action_brief'],
  'deep-evolve/handoff':             ['schema_version', 'handoff_kind', 'from', 'to', 'summary', 'next_action_brief'],
  // M5: compaction-state payload (claude-deep-suite/schemas/compaction-state.schema.json,
  // schema_version 1.0). Mirrors the schema's `required[]` keyword 1:1.
  // deep-evolve also emits at epoch boundaries (context-management.md §6).
  'deep-work/compaction-state':      ['schema_version', 'compacted_at', 'trigger', 'preserved_artifact_paths'],
  'deep-evolve/compaction-state':    ['schema_version', 'compacted_at', 'trigger', 'preserved_artifact_paths'],
});

// ---------------------------------------------------------------------------
// AGGREGATOR_KINDS — non-chain-eligible artifact kinds
// ---------------------------------------------------------------------------
// Single source of truth for the suite-wide convention that aggregator-pattern
// envelopes (`harnessability-report`, `evolve-insights`, `index`) do NOT
// participate in cross-plugin parent_run_id chains:
//   - As parents: they aggregate multiple inputs; their run_id is not a
//     meaningful chain anchor for a single downstream child to point at.
//   - As children: they don't carry parent_run_id by design (they index, they
//     don't continue a thread).
//
// Used by:
//   - suite-collector.js#reconstructChains — excludes aggregator envelopes
//     from both child-iteration and parent-index (chain-completeness metric).
//   - aggregator.js#computeHandoffRoundtripSuccessRate — Round 1 review (W1):
//     excludes aggregator envelopes from the child-iteration that builds
//     childrenByParent (mirrors the catalog contract "downstream
//     non-aggregator envelope's parent_run_id chains back").
//
// Previously this Set lived inline in suite-collector.js and was exported via
// `_internal.AGGREGATOR_KINDS`; the move to constants makes it a first-class
// shared invariant and eliminates the cross-module import surprise.
//
// Round 3 review (Opus Info-2): `Object.freeze(new Set(...))` is a no-op for
// Set mutation methods (.add()/.delete()/.clear()). The `const` reference
// alone protects against reassignment; immutability of the entries is
// enforced by convention (no internal code mutates this Set). Wrapping with
// Proxy or building a frozen-Set facade would be theatre without measurable
// safety gain.
export const AGGREGATOR_KINDS = new Set([
  'harnessability-report',
  'evolve-insights',
  'index',
]);

// ---------------------------------------------------------------------------
// KNOWN_SUITE_PLUGINS — canonical suite-slug catalog
// ---------------------------------------------------------------------------
// Single source of truth for "the 7 slugs that may legitimately appear in
// suite-wide telemetry": the meta-slug `suite` (for suite-repo-owned tests
// like §1 manifest-doc sync and §2 schema fixture) plus the 6 plugin slugs.
//
// Hoisted into suite-constants.js in v1.3.3 (W2). Previously duplicated as:
//   - lib/aggregator.js (Object.freeze Array, used by computeTestsCoveragePerPlugin
//     to enumerate plugins_unparticipating).
//   - lib/test-catalog-manifest.test.js (new Set, used for slug-membership check).
// Future plugin additions now touch one file, not three. Continues the
// precedent set by ADOPTION_LEDGER, EXPECTED_SOURCES, PAYLOAD_REQUIRED_FIELDS,
// and AGGREGATOR_KINDS.

export const KNOWN_SUITE_PLUGINS = Object.freeze([
  'suite',
  'deep-work',
  'deep-evolve',
  'deep-wiki',
  'deep-review',
  'deep-dashboard',
  'deep-docs',
]);
