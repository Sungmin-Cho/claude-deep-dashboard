---
name: deep-harness-dashboard
description: Unified harness dashboard — aggregates sensor results from deep-work, deep-review, deep-docs into a single view with effectiveness scoring and action routing.
---

# Harness Dashboard

Aggregates cross-plugin sensor data into a unified view.

## Steps

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

## Options
- `--json` — output raw JSON instead of formatted CLI table

## Envelope-aware sources

| Source | Path | Envelope identity (when wrapped) |
|---|---|---|
| deep-docs | `.deep-docs/last-scan.json` | `(deep-docs, last-scan)` |
| deep-dashboard (self) | `.deep-dashboard/harnessability-report.json` | `(deep-dashboard, harnessability-report)` |
| deep-work session | `.deep-work/session-receipt.json` | `(deep-work, session-receipt)` (forward-compat) |
| deep-work slices | `.deep-work/receipts/*.json` | `(deep-work, slice-receipt)` (forward-compat) |
| deep-evolve | `.deep-evolve/evolve-receipt.json` | `(deep-evolve, evolve-receipt)` (forward-compat) |

`.deep-review/fitness.json` and `.deep-review/receipts/*.json` are **NOT** in
the M3 envelope plan — deep-review's envelope-bound artifact is
`recurring-findings.json`, which the dashboard does not currently consume. Reads
from those paths remain legacy pass-through.
