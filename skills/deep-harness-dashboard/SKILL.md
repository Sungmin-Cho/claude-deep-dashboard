---
name: deep-harness-dashboard
description: Aggregates deep-suite harness sensors into an effectiveness snapshot or a 17-metric `--suite` series. Triggers on "harness 대시보드 보여줘", "전체 sensor 통합 리포트", "suite metrics 누적", "trend report 만들어줘", "OTLP 로 내보내", "show the harness dashboard", "cross-plugin telemetry", "deep-suite snapshot". Writes `.deep-dashboard/suite-metrics.jsonl` + `suite-report.md`.
---

# Harness Dashboard

Two modes over one CLI:

- **Legacy** (default) — envelope-aware single snapshot: 5 sources, effectiveness score, action
  routing.
- **Suite** (`--suite`, M4) — accumulates the 17 metrics from 15 sources into an append-only JSONL
  time series plus a trend report. `lib/metrics-catalog.yaml` owns the metric ids, tiers,
  `null_when` semantics, and the deprecated wire keys.

## Invocation

| Command | Mode | Output |
|---|---|---|
| `/deep-harness-dashboard` | Legacy | formatted CLI table |
| `/deep-harness-dashboard --json` | Legacy | exactly `{ data, effectiveness, actions }` |
| `/deep-harness-dashboard --suite` | Suite (M4) | JSONL append + markdown trend report |

Standalone route:
`node <plugin-root>/scripts/dashboard-cli.js [--suite] [--json] --project-root <target-project-root>`

### Loaded-SKILL routing handoff

`pluginRoot = dirname(dirname(dirname(loadedSkillPath)))`, where `loadedSkillPath` is this file's
absolute path as the host passes it — Claude Code derives it from
`realpath($CLAUDE_PLUGIN_ROOT/skills/deep-harness-dashboard/SKILL.md)`; Codex passes the loaded
`SKILL.md` path itself and defines no `CLAUDE_*` variable. Build the
`scripts/dashboard-cli.js` path from `pluginRoot`; if `loadedSkillPath` is unavailable, fail with a
routing error rather than inferring a root. The caller's cwd is neither the plugin root nor an
implicit target root, so always pass the target as `--project-root`. Prefer absolute Node argv
through the host execution tool — the commands below are fallback documentation; substitute the
real absolute root and never execute an argument containing `..`.

```text
POSIX dashboard:      node "$CLAUDE_PLUGIN_ROOT/scripts/dashboard-cli.js" --project-root "$PWD"
PowerShell dashboard: node "C:\absolute\plugin\scripts\dashboard-cli.js" --project-root (Get-Location).Path
```

## Legacy mode steps

1. **Freshness preflight.** Reuse the existing harnessability report only when it is an M3 envelope
   with the exact harnessability identity and a parseable `envelope.generated_at` in
   `0 <= age < 24h`. Missing, malformed, identity-mismatched, future-dated, and ≥ 24 h reports are
   stale: run the scorer and write `.deep-dashboard/harnessability-report.json` **before**
   `collectData(projectRoot)` reads it.
2. `collectData(projectRoot)` is **M3 envelope-aware** — it applies the identity guards
   (`<plugin-root>/AGENTS.md` §Reading other plugins' envelopes), passes legacy artifacts through
   unchanged, and resolves identity-mismatched envelopes to `null` as defense-in-depth.
3. Score with `calculateEffectiveness(data)` from `lib/dashboard/effectiveness.js`, then route
   findings through `getSuggestedActions(data)` from `lib/dashboard/action-router.js`.
4. Build the default view explicitly — harnessability as `{ total, grade }` from
   `data.harnessability.data`, effectiveness as the numeric `.effectiveness` return field, actions
   from the router. That explicit shaping is what prevents `undefined/10` and `[object Object]`.
   With `--json`, emit exactly `{ data, effectiveness, actions }`.

## Suite mode steps (`--suite`)

One ordering constraint: read the previous snapshot **before** appending the new one, or the trend
baseline becomes the row just written. The sequence below mirrors `runSuite` in
`scripts/dashboard-cli.js`.

1. `collectSuite(projectRoot)` from `lib/suite-collector.js` — the 15 sources below. Honors
   `options.wikiRoot` or `DEEP_WIKI_ROOT` for external wiki vaults.
2. `readRecentSnapshots(projectRoot, 1)` — its first result is the previous trend baseline (or
   `null`). This is the step that must precede step 4.
3. `buildSnapshot(collected)` from `lib/aggregator.js` — emits the 17 metrics per
   `lib/metrics-catalog.yaml`.
4. `appendSnapshot(snapshot, projectRoot)` — appends one JSONL line to
   `.deep-dashboard/suite-metrics.jsonl`.
5. `writeSuiteReportFile(snapshot, previous, projectRoot)` — renders
   `.deep-dashboard/suite-report.md` with trend arrows (↑/↓/→/·/?).
6. `exportSnapshot(snapshot)` from `lib/otel.js` — always called; without
   `OTEL_EXPORTER_OTLP_ENDPOINT` it returns `{ exported: false, reason: 'no-endpoint' }` and does
   nothing. Export failures are non-fatal and never block rendering.

## Options

- `--json` — legacy mode outputs `{ data, effectiveness, actions }` instead of the CLI table
- `--suite` — switch to M4 suite telemetry mode
- `--project-root PATH` — **required in every mode**

## Freshness contract (shared with `deep-harnessability`)

`.deep-dashboard/harnessability-report.json` is fresh for **24 hours after
`envelope.generated_at`**. The threshold is implemented once, as `DAY_MS` in
`scripts/dashboard-cli.js`, and governs legacy-mode step 1 above; its prose sites are both
`skills/*/SKILL.md` and `<plugin-root>/AGENTS.md` — change them together. It binds no other plugin:
deep-work Phase 1 Research reads the report read-only under its own 7-day policy.

## Envelope-aware sources (legacy mode, 5)

| Producer / kind (when wrapped) | Path |
|---|---|
| `(deep-docs, last-scan)` | `.deep-docs/last-scan.json` |
| `(deep-dashboard, harnessability-report)` — self | `.deep-dashboard/harnessability-report.json` |
| `(deep-work, session-receipt)` | `.deep-work/session-receipt.json` |
| `(deep-work, slice-receipt)` | `.deep-work/receipts/*.json` |
| `(deep-evolve, evolve-receipt)` | `.deep-evolve/evolve-receipt.json` |

`.deep-review/fitness.json` and `.deep-review/receipts/*.json` stay legacy pass-through;
deep-review's envelope-bound artifact (`recurring-findings.json`) is suite-mode only.

These 5 envelope-aware rows are **not** the 5 keys `collectData()` returns (`deepWork`,
`deepReview`, `deepDocs`, `harnessability`, `deepEvolve`): the two deep-work artifacts collapse
into one key, and `deepReview` contributes no envelope row. Same count, different grouping.

## Suite mode sources (15)

12 M3 envelopes:

| Producer / kind | Path |
|---|---|
| `(deep-work, session-receipt)` | `.deep-work/session-receipt.json` |
| `(deep-work, slice-receipt)` | `.deep-work/receipts/*.json` |
| `(deep-work, handoff)` | `.deep-work/handoffs/*.json` + `.deep-work/<session>/handoff.json` |
| `(deep-work, compaction-state)` | `.deep-work/compaction-states/*.json` + `.deep-work/<session>/compaction-state.json` |
| `(deep-review, recurring-findings)` | `.deep-review/recurring-findings.json` |
| `(deep-docs, last-scan)` | `.deep-docs/last-scan.json` |
| `(deep-evolve, evolve-receipt)` | `.deep-evolve/evolve-receipt.json` |
| `(deep-evolve, evolve-insights)` | `.deep-evolve/evolve-insights.json` |
| `(deep-evolve, handoff)` | `.deep-evolve/handoffs/*.json` + `.deep-evolve/<session>/handoff.json` |
| `(deep-evolve, compaction-state)` | `.deep-evolve/compaction-states/*.json` + `.deep-evolve/<session>/compaction-state.json` |
| `(deep-dashboard, harnessability-report)` | `.deep-dashboard/harnessability-report.json` |
| `(deep-wiki, index)` | `<wiki_root>/.wiki-meta/index.json` |

The four M5 rows are `dir+session-glob`: the flat aggregation dir **and** one level of per-session
subdirs are both read, then merged per (producer, kind). A session subdir named like the flat dir
(`handoffs`, `compaction-states`) is skipped so nothing is counted twice.

3 NDJSON logs: `(deep-work, hook-log)` `.deep-work/hooks.log.jsonl`, `(deep-evolve, hook-log)`
`.deep-evolve/hooks.log.jsonl`, `(deep-wiki, log)` `<wiki_root>/log.jsonl`.

These 15 read sources are exactly the 15 `EXPECTED_SOURCES` of `lib/suite-constants.js` that form
the `missing_signal_ratio` denominator — the two sets must stay in step.

## Outputs (suite mode)

- `.deep-dashboard/suite-metrics.jsonl` — append-only time series, one snapshot per `--suite` run;
  external tooling (dashboards, deep-evolve insight aggregators) may read it.
- `.deep-dashboard/suite-report.md` — human-facing only, not consumed by other plugins.
- OTLP collector (when `OTEL_EXPORTER_OTLP_ENDPOINT` is set) — out-of-process observability sink;
  transport details in `lib/otel.js`.
