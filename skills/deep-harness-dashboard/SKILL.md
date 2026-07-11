---
name: deep-harness-dashboard
description: This skill should be used when the user asks for a cross-plugin harness summary, effectiveness score, action routing, or suite-level telemetry across deep-work / deep-review / deep-docs / deep-evolve / deep-wiki. Trigger phrases include "harness 대시보드 보여줘", "전체 sensor 통합 리포트", "suite metrics 누적", "trend report 만들어줘", "OTLP 로 내보내", "show the harness dashboard", "cross-plugin telemetry", "deep-suite snapshot". Two modes — legacy (default) aggregates 5 envelope/legacy sources for an effectiveness snapshot; suite mode (`--suite`, since v1.3.0) accumulates 17 metrics from 11 sources into `.deep-dashboard/suite-metrics.jsonl`, renders `.deep-dashboard/suite-report.md`, and optionally exports to OTLP/HTTP-JSON when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
---

# Harness Dashboard

Aggregates cross-plugin sensor data into a unified view. Two modes:

- **Legacy mode** (default) — envelope-aware single-snapshot dashboard with
  effectiveness scoring and action routing. Reads 5 sources (deep-work,
  deep-review legacy, deep-docs, deep-evolve, harnessability self).
- **Suite mode** (`--suite`, M4) — accumulates time-series metrics for all 17
  suite-level signals defined in `lib/metrics-catalog.yaml`. Appends to
  `.deep-dashboard/suite-metrics.jsonl`, renders trend report
  (`.deep-dashboard/suite-report.md`), and optionally exports to OTLP/HTTP-JSON.

## Invocation

Primary entry is the slash command registered by this skill:

| Command | Mode | Notes |
|---|---|---|
| `/deep-harness-dashboard` | Legacy | CLI table output (default). |
| `/deep-harness-dashboard --json` | Legacy | `{ data, effectiveness, actions }` JSON instead of the formatted table. |
| `/deep-harness-dashboard --suite` | Suite (M4) | Accumulates JSONL + renders markdown trend report. |

The standalone dashboard route is:

```text
node <plugin-root>/scripts/dashboard-cli.js [--suite] [--json] --project-root <target-project-root>
```

### Loaded-SKILL routing handoff

The host passes the absolute path of this exact loaded file as
`loadedSkillPath` to its execution tool. Derive
`pluginRoot = dirname(dirname(dirname(loadedSkillPath)))`, then construct the
absolute `scripts/dashboard-cli.js` path from that root. The caller's current
directory is neither the plugin root nor an implicit target root: pass the
target explicitly as `--project-root`.

- **Claude Code:** its plugin launcher obtains the absolute loaded path as
  `realpath($CLAUDE_PLUGIN_ROOT/skills/deep-harness-dashboard/SKILL.md)` and
  passes that exact path as `loadedSkillPath`. `CLAUDE_PLUGIN_ROOT` is only the
  Claude bootstrap used to form the absolute loaded path; routing then uses the
  path-derived root.
- **Codex:** the marketplace skill loader passes the absolute filesystem path
  of the selected `skills/deep-harness-dashboard/SKILL.md` as `loadedSkillPath`
  in the execution request. Codex does not invent a `CLAUDE_*` or other
  environment variable. If the path is unavailable, fail with a routing error
  rather than inferring a plugin root from the target cwd.

Prefer passing the absolute Node argv directly through the host execution tool.
These shell commands are fallback documentation only. For the PowerShell form,
substitute `C:\absolute\plugin` first with the real absolute path derived three
levels above `loadedSkillPath`; do not execute an argument containing `..`.

```text
POSIX dashboard:      node "$CLAUDE_PLUGIN_ROOT/scripts/dashboard-cli.js" --project-root "$PWD"
PowerShell dashboard: node "C:\absolute\plugin\scripts\dashboard-cli.js" --project-root (Get-Location).Path
```

## Legacy mode steps

1. The CLI validates the existing harnessability report before collecting data.
   It only reuses an M3 envelope with the exact harnessability identity and a
   parseable `envelope.generated_at` in the range `0 <= age < 24h`; missing,
   malformed, identity-mismatched, future-dated, and 24-hour-old reports are
   stale. For stale reports it runs the scorer and writes
   `.deep-dashboard/harnessability-report.json` **before**
   `collectData(projectRoot)` reads it.
2. `collectData(projectRoot)` remains **M3 envelope-aware**
   (cf. claude-deep-suite/docs/envelope-migration.md): it applies identity
   guards and exposes a valid inner `payload` to downstream consumers.
   Legacy unwrapped artifacts pass through unchanged, while identity-mismatched
   envelopes resolve to `null` as defense-in-depth.
3. Calculate the effectiveness score by importing
   `calculateEffectiveness(data)` from `lib/dashboard/effectiveness.js`
   against the (possibly unwrapped) data structures, then route findings
   through `getSuggestedActions(data)` from `lib/dashboard/action-router.js`.
4. For default output, build the formatter's presentation view explicitly:
   harnessability is `{ total, grade }` from `data.harnessability.data`,
   effectiveness is the numeric `.effectiveness` return field, and actions are
   the action-router results. This prevents `undefined/10` and
   `[object Object]` output. With `--json`, emit exactly
   `{ data, effectiveness, actions }`.

## Suite mode steps (`--suite`)

1. Run `collectSuite(projectRoot)` from `lib/suite-collector.js` — covers 11
   sources: 8 envelope artifacts (M3-compliant) + 3 NDJSON event logs (2 hook
   logs + deep-wiki vault log). Honors `options.wikiRoot` or `DEEP_WIKI_ROOT`
   for external wiki vaults.
2. Run `buildSnapshot(collected)` from `lib/aggregator.js` — emits the 17
   M4 metrics: 13 M4-core (computed; includes the deprecated
   `suite.wiki.auto_ingest_candidates_total` wire key pinned `null` and its
   replacement `suite.wiki.ingest_actions_total`) + 3 M5-activated +
   1 M5.5-activated (all currently in the core tier;
   `lib/metrics-catalog.yaml` is the canonical list).
3. Run `readRecentSnapshots(projectRoot, 1)` **before** appending, so its
   first result is the previous trend baseline (or `null`).
4. Run `appendSnapshot(snapshot, projectRoot)` — appends one JSONL line to
   `.deep-dashboard/suite-metrics.jsonl` (append-only time series).
5. Run `writeSuiteReportFile(snapshot, previous, projectRoot)` to render
   `.deep-dashboard/suite-report.md` with trend arrows (↑/↓/→/·/?).
6. **Optional OTLP export**: when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, also
   run `exportSnapshot(snapshot)` from `lib/otel.js`. Failures are non-fatal
   and do not block report rendering.

## Options

- `--json` — output `{ data, effectiveness, actions }` instead of the
  formatted CLI table (legacy mode)
- `--suite` — switch to M4 suite telemetry mode (above)
- `--project-root PATH` — required explicit target project for every mode

## Freshness contract (shared with `deep-harnessability`)

The harnessability report at `.deep-dashboard/harnessability-report.json` is
treated as fresh for **24 hours after `envelope.generated_at`**. This single
threshold governs:

- step 1 of legacy mode above (re-run the scorer when missing or stale)
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
