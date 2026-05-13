---
name: deep-harness-dashboard
description: This skill should be used when the user asks for a cross-plugin harness summary, effectiveness score, action routing, or suite-level telemetry across deep-work / deep-review / deep-docs / deep-evolve / deep-wiki. Trigger phrases include "harness 대시보드 보여줘", "전체 sensor 통합 리포트", "suite metrics 누적", "trend report 만들어줘", "OTLP 로 내보내", "show the harness dashboard", "cross-plugin telemetry", "deep-suite snapshot". Two modes — legacy (default) aggregates 5 envelope/legacy sources for an effectiveness snapshot; suite mode (`--suite`, since v1.3.0) accumulates 16 metrics from 11 sources into `.deep-dashboard/suite-metrics.jsonl`, renders `.deep-dashboard/suite-report.md`, and optionally exports to OTLP/HTTP-JSON when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
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

## Invocation

Primary entry is the slash command registered by this skill:

| Command | Mode | Notes |
|---|---|---|
| `/deep-harness-dashboard` | Legacy | CLI table output (default). |
| `/deep-harness-dashboard --json` | Legacy | Raw JSON instead of the formatted table. |
| `/deep-harness-dashboard --suite` | Suite (M4) | Accumulates JSONL + renders markdown trend report. |

There is no standalone `node lib/.../*.js` CLI for the dashboard surface
(unlike `deep-harnessability`, which exposes `node lib/harnessability/scorer.js`).
Dashboard composition is driven entirely from this skill — the step lists
below describe the function calls the skill performs in-process, using ESM
imports from `lib/dashboard/` (legacy) and `lib/` (suite).

## Legacy mode steps

1. Collect data from available plugins by importing
   `collectData(projectRoot)` from `lib/dashboard/collector.js`. The collector
   is **M3 envelope-aware** (cf. claude-deep-suite/docs/envelope-migration.md):
   for each artifact path, it detects the envelope wrapper, applies identity
   guards (producer / artifact_kind / schema.name), and exposes the inner
   `payload` to downstream consumers. Legacy (un-wrapped) artifacts pass
   through unchanged. Identity-mismatched envelopes resolve to `null` (with a
   stderr warning) — defense-in-depth.
2. Run the harnessability scorer if the report is **missing or older than the
   24-hour freshness threshold** shared with the `deep-harnessability` skill
   and `deep-work` Phase 1 Research. The scorer writes the envelope-wrapped
   report to `.deep-dashboard/harnessability-report.json`; this skill never
   recomputes the score in-process.
3. Calculate the effectiveness score by importing
   `calculateEffectiveness(data)` from `lib/dashboard/effectiveness.js`
   against the (possibly unwrapped) data structures, then route findings
   through `getSuggestedActions(data)` from `lib/dashboard/action-router.js`.
4. Format and display the CLI dashboard via `formatCLI(data)` from
   `lib/dashboard/formatter.js`. For `--json`, emit the raw `data` object
   returned by `collectData` (annotated with `effectiveness` and
   `suggested_actions`) as `JSON.stringify(data, null, 2)` instead.
5. Ask: "리포트 파일을 생성할까요? (y/n)"
   - If yes: generate `harness-report-YYYY-MM-DD.md` in project root using
     `formatMarkdown(data)` from `lib/dashboard/formatter.js`.
   - Ask: "git commit 할까요? (y/n)"

## Suite mode steps (`--suite`)

1. Run `collectSuite(projectRoot)` from `lib/suite-collector.js` — covers 11
   sources: 8 envelope artifacts (M3-compliant) + 3 NDJSON event logs (2 hook
   logs + deep-wiki vault log). Honors `options.wikiRoot` or `DEEP_WIKI_ROOT`
   for external wiki vaults.
2. Run `buildSnapshot(collected)` from `lib/aggregator.js` — emits the 16
   M4 metrics: 12 M4-core (computed) + 3 M5-activated + 1 M5.5-activated
   (all currently in the core tier; `lib/metrics-catalog.yaml` is the
   canonical list).
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

## Freshness contract (shared with `deep-harnessability`)

The harnessability report at `.deep-dashboard/harnessability-report.json` is
treated as fresh for **24 hours after `envelope.generated_at`**. This single
threshold governs:

- step 2 of legacy mode above (re-run the scorer when missing or stale)
- `deep-work` Phase 1 Research's reuse rule (read-only when fresh)
- the sibling `deep-harnessability` skill's "Consumed by" section

Update the threshold in all three places together so the policy stays
unambiguous.

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

## Outputs (suite mode)

Downstream consumers of this skill's outputs:

- `.deep-dashboard/suite-metrics.jsonl` — append-only time series; one snapshot per `--suite` run. Future tooling (e.g. external dashboards, deep-evolve insight aggregators) may read this file.
- `.deep-dashboard/suite-report.md` — human-facing markdown report; not consumed by other plugins.
- OTLP collector (when `OTEL_EXPORTER_OTLP_ENDPOINT` is set) — out-of-process observability sink; transport details in `lib/otel.js`.
