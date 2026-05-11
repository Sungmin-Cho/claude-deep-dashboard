---
name: deep-harness-dashboard
description: Unified harness dashboard — aggregates sensor results from deep-work, deep-review, deep-docs into a single view with effectiveness scoring and action routing. Use `--suite` for the M4 suite-level telemetry mode (16 metrics, JSONL time-series, markdown trend report, optional OTel export).
---

# Harness Dashboard

Aggregates cross-plugin sensor data into a unified view. Two modes:

- **Legacy mode** (default) — envelope-aware single-snapshot dashboard with
  effectiveness scoring and action routing. Reads 5 sources (deep-work,
  deep-review legacy, deep-docs, deep-evolve, harnessability self).
- **Suite mode** (`--suite`, M4) — accumulates time-series metrics for all 16
  suite-level signals defined in `lib/metrics-catalog.yaml`. Appends to
  `.deep-dashboard/suite-metrics.jsonl`, renders trend report
  (`.deep-dashboard/suite-report.md`), and optionally exports to OTLP/HTTP-JSON.

## Legacy mode steps

1. Collect data from available plugins by running the collector. The collector
   is **M3 envelope-aware** (cf. claude-deep-suite/docs/envelope-migration.md):
   for each artifact path, it detects the envelope wrapper, applies identity
   guards (producer / artifact_kind / schema.name), and exposes the inner
   `payload` to downstream consumers. Legacy (un-wrapped) artifacts pass
   through unchanged. Identity-mismatched envelopes resolve to `null` (with a
   stderr warning) — defense-in-depth.
2. Run harnessability scorer if report is stale/missing. The scorer writes
   the envelope-wrapped report to `.deep-dashboard/harnessability-report.json`.
3. Calculate effectiveness score from the (possibly unwrapped) data structures.
4. Format and display the CLI dashboard.
5. Ask: "리포트 파일을 생성할까요? (y/n)"
   - If yes: generate `harness-report-YYYY-MM-DD.md` in project root
   - Ask: "git commit할까요? (y/n)"

## Suite mode steps (`--suite`)

1. Run `collectSuite(projectRoot)` from `lib/suite-collector.js` — covers 11
   sources: 8 envelope artifacts (M3-compliant) + 3 NDJSON event logs (2 hook
   logs + deep-wiki vault log). Honors `options.wikiRoot` or `DEEP_WIKI_ROOT`
   for external wiki vaults.
2. Run `buildSnapshot(collected)` from `lib/aggregator.js` — emits the 16
   M4 metrics: 12 M4-core (computed) + 4 M4-deferred (null, awaiting M5/M5.5).
3. Run `appendSnapshot(snapshot, projectRoot)` — appends one JSONL line to
   `.deep-dashboard/suite-metrics.jsonl` (append-only time series).
4. Run `readRecentSnapshots(projectRoot, 2)` to fetch the trend baseline.
5. Run `formatSuiteReportMarkdown(snapshot, previous)` from
   `lib/suite-formatter.js` — emits markdown with trend arrows
   (↑/↓/→/·/?, see file for full vocabulary).
6. Ask: "`.deep-dashboard/suite-report.md` 에 저장할까요? (y/n)"
   - If yes: `writeSuiteReportFile(snapshot, previous, projectRoot)`.
7. **Optional OTLP export**: when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, also
   run `exportSnapshot(snapshot)` from `lib/otel.js`. Failures are non-fatal
   (logged, reported in stdout, do not block report rendering).

## Options
- `--json` — output raw JSON instead of formatted CLI table (legacy mode)
- `--suite` — switch to M4 suite telemetry mode (above)

## Envelope-aware sources (legacy mode)

| Source | Path | Envelope identity (when wrapped) |
|---|---|---|
| deep-docs | `.deep-docs/last-scan.json` | `(deep-docs, last-scan)` |
| deep-dashboard (self) | `.deep-dashboard/harnessability-report.json` | `(deep-dashboard, harnessability-report)` |
| deep-work session | `.deep-work/session-receipt.json` | `(deep-work, session-receipt)` |
| deep-work slices | `.deep-work/receipts/*.json` | `(deep-work, slice-receipt)` |
| deep-evolve | `.deep-evolve/evolve-receipt.json` | `(deep-evolve, evolve-receipt)` |

`.deep-review/fitness.json` and `.deep-review/receipts/*.json` remain legacy
pass-through; deep-review's M3 envelope-bound artifact (`recurring-findings.json`)
is consumed only by suite mode.

## Suite mode sources (M4)

| Source | Producer / Kind | Path | Notes |
|---|---|---|---|
| Session receipts | `(deep-work, session-receipt)` | `.deep-work/session-receipt.json` | M3 envelope |
| Slice receipts | `(deep-work, slice-receipt)` | `.deep-work/receipts/*.json` | M3 envelope (multi) |
| Recurring findings | `(deep-review, recurring-findings)` | `.deep-review/recurring-findings.json` | M3 envelope |
| Last scan | `(deep-docs, last-scan)` | `.deep-docs/last-scan.json` | M3 envelope |
| Evolve receipt | `(deep-evolve, evolve-receipt)` | `.deep-evolve/evolve-receipt.json` | M3 envelope |
| Evolve insights | `(deep-evolve, evolve-insights)` | `.deep-evolve/evolve-insights.json` | M3 envelope (aggregator) |
| Harnessability | `(deep-dashboard, harnessability-report)` | `.deep-dashboard/harnessability-report.json` | M3 envelope (aggregator) |
| Wiki index | `(deep-wiki, index)` | `<wiki_root>/.wiki-meta/index.json` | M3 envelope (aggregator) |
| Hook log (work) | `(deep-work, hook-log)` | `.deep-work/hooks.log.jsonl` | NDJSON (legacy) |
| Hook log (evolve) | `(deep-evolve, hook-log)` | `.deep-evolve/hooks.log.jsonl` | NDJSON (legacy) |
| Wiki event log | `(deep-wiki, log)` | `<wiki_root>/log.jsonl` | NDJSON (legacy) |
