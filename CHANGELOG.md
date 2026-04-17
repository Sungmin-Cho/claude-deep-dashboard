**English** | [한국어](./CHANGELOG.ko.md)

# Changelog

## [1.1.1] — 2026-04-17

Patch release addressing defects surfaced by the 2026-04-17 ultrareview of v1.1.0 and follow-up polish.

### Fixed
- **`scorer.js` `isTypeScript`** no longer triggers on plain `package.json`; TS-only checks are only applied when a `tsconfig.json` exists. Pure JS and Python-with-frontend projects are no longer penalized.
- **`scorer.js` recommendations** skip `not_applicable` checks — no more cross-ecosystem noise (e.g., "enable Python type hints" on TS projects).
- **`scorer.js` CLI entry** added. Previously the skill command `node scorer.js <project>` exited silently with no output; now it emits JSON and writes `.deep-dashboard/harnessability-report.json` as the skill promised.
- **`formatter.js` undefined guards** across `centerLine`, `renderHealth`, `renderActions`; `pad()` and `stripAnsi()` helpers also coerce input defensively so future callers can't reintroduce the crash path.
- **`formatter.js` NaN handling**: `q_trajectory` entries that are `NaN` render as `?` instead of the literal string `NaN`.
- **`formatter.js` Markdown tables**: new `escapePipe` helper escapes `|` characters in every interpolated cell (Health, Fitness, Sessions, Evolve). Session sensors, transfer IDs, and finding strings can no longer corrupt table structure.
- **`collector.js` `readJsonDir`** safely follows symlinks within the scanned directory. Uses `fs.realpathSync` + `path.relative` containment instead of a naïve `startsWith` prefix check, blocking both out-of-tree ingestion and sibling-prefix bypass (`.deep-work/receipts-old/` can no longer sneak past a `.deep-work/receipts` scan). Broken and out-of-boundary symlinks skip with a visible warning.
- **`action-router.js` runtime strings** translated to English (keep-rate, crash-rate, stale-receipt, no-transfer `detail` fields were partially Korean from the phase-3 integration).

### Changed
- **`README` effectiveness table** corrected to 5 weighted dimensions summing to 100%: Health 25% / Fitness 20% / Session 20% / Harnessability 15% / Evolve 20%. Earlier the table showed 4 rows with incorrect weights (30/25/25/20).
- **`README` architecture diagram** now shows `deep-evolve` as a fourth input source.
- **`README` evolve section**: Korean fragments translated in the English README; `evolve-low-q` rule described precisely as "earliest of last-3 `q_trajectory` values more than 0.05 above the most recent"; `transfer.received_from` schema documented as `non-empty string | null`.
- **`skills/deep-harnessability.md`** uses `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` (documented Claude Code env vars) instead of unresolved `PLUGIN_DIR` / `PROJECT_ROOT` literals.
- **`action-router.test.js`** pins strict-exclusive threshold behavior (`keep_rate < 0.15`, `crash_rate > 0.20`) so a future refactor cannot silently flip the sign.
- **`.claude-plugin/plugin.json`** was stale at 1.0.0 — bumped to match `package.json`.

### Notes
- Ultrareview M1 (`evolve-no-transfer` on falsy `received_from`) closed as won't-fix: the documented schema rules out `0` and `""`, making the reported case unreachable.
- Test count: 45 → 58 (+13 regression tests across scorer, formatter, action-router, collector).

## [1.1.0] — 2026-04-14

### Added
- **Cross-plugin feedback (Phase 3B):**
  - `collectDeepEvolve()` in collector for evolve-receipt.json consumption
  - `evolve` dimension (weight 0.20) in effectiveness scorer with weight redistribution
  - `extractEvolveFindings()` with 5 detection rules (low-keep, high-crash, low-q, stale, no-transfer)
  - `evolve-low-q`: fires when the earliest of the last-3 `q_trajectory` values is more than 0.05 above the most recent value (i.e., the recent 3-point window is trending down).
  - Evolve section in CLI and Markdown formatter output
  - `action-router.test.js` (new test file)
  - Contract test fixtures for cross-plugin schema validation

## 1.0.0 (2026-04-09)

### Features
- Harnessability Diagnosis: 6-dimension scoring engine with 17 computational detectors
- Unified Dashboard: cross-plugin data aggregation with effectiveness scoring
- Action routing: suggested_action per finding type
- CLI table + markdown report output
- /deep-harnessability and /deep-harness-dashboard skills

### Architecture
- Ecosystem-aware type_safety scoring (TS/Python not_applicable handling)
- Last 3 sessions effectiveness averaging
- generated_at timestamp for staleness checking
- Deep merge support for custom topologies
