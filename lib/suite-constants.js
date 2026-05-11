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
// Six-month legacy fallback timer reaches `2026-11-07`; at that point the
// dashboard switches from silent-fallback to warning-emit for any plugin
// artifact whose envelope adoption is still pending.
//
// Per M3 Phase 3 handoff §5: "현재 상태 — 6/6 plugin envelope adoption 완료.
// 이론적으로는 warning trigger 가 발생하지 않을 예정. 다만 사용자가 직접
// plugin downgrade 시 활성." — so the warning is a defensive guard for the
// downgrade path, not an expected emit during normal operation.

export const ENVELOPE_ROLLOUT = Object.freeze({
  /** First envelope adoption (T+0). RFC 3339 date. */
  t0_date: '2026-05-07',
  /** Six-month legacy fallback timer end (T+0+6mo). RFC 3339 date. */
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
 * Returns true when `nowIso` is strictly past the 6-month legacy fallback timer.
 * Accepts an injectable `nowIso` for testability (default = current wall clock).
 */
export function legacyFallbackExpired(nowIso = new Date().toISOString()) {
  const now = Date.parse(nowIso);
  const cutoff = Date.parse(`${ENVELOPE_ROLLOUT.t0_plus_6mo_date}T00:00:00Z`);
  if (Number.isNaN(now) || Number.isNaN(cutoff)) return false;
  return now > cutoff;
}

/**
 * Catalog of expected (producer, kind) tuples for M4-core `missing_signal_ratio`.
 * Order independent. Mirrors lib/metrics-catalog.yaml M4-core source enumeration.
 */
export const EXPECTED_SOURCES = Object.freeze([
  { producer: 'deep-work',      kind: 'session-receipt' },
  { producer: 'deep-work',      kind: 'slice-receipt' },
  { producer: 'deep-review',    kind: 'recurring-findings' },
  { producer: 'deep-docs',      kind: 'last-scan' },
  { producer: 'deep-evolve',    kind: 'evolve-receipt' },
  { producer: 'deep-evolve',    kind: 'evolve-insights' },
  { producer: 'deep-dashboard', kind: 'harnessability-report' },
  { producer: 'deep-wiki',      kind: 'index' },
]);
