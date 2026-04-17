**English** | [한국어](./CHANGELOG.ko.md)

# Changelog

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
