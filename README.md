**English** | [한국어](./README.ko.md)

# deep-dashboard

![version](https://img.shields.io/github/package-json/v/Sungmin-Cho/claude-deep-dashboard?label=version)
![license](https://img.shields.io/github/license/Sungmin-Cho/claude-deep-dashboard)
[![part of deep-suite](https://img.shields.io/badge/part%20of-deep--suite-5b8def)](https://github.com/Sungmin-Cho/claude-deep-suite)

> Cross-plugin harness diagnostics for the [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) ecosystem.

deep-dashboard measures how "harness-able" a codebase is, aggregates sensor signals from the other deep-suite plugins into a single effectiveness view, and accumulates a cross-plugin telemetry time-series. It is a **read-only consumer** — it never writes to another plugin's output directory.

It ships native manifests for both runtimes: the Claude Code manifest in `.claude-plugin/plugin.json` and a Codex manifest in `.codex-plugin/plugin.json`, both pointing at the same skills.

## Role in deep-suite

deep-dashboard is the **harness diagnostics layer**, implementing two ideas from the [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) framework:

- **Harnessability assessment** — a quantitative 0–10 measure of codebase readiness across 6 dimensions (17 computational detectors).
- **Human steering loop** — a unified dashboard that aggregates sensor results from [deep-work](https://github.com/Sungmin-Cho/claude-deep-work), [deep-review](https://github.com/Sungmin-Cho/claude-deep-review), [deep-docs](https://github.com/Sungmin-Cho/claude-deep-docs), and [deep-evolve](https://github.com/Sungmin-Cho/claude-deep-evolve) into one effectiveness score with action routing.

In the framework's 2×2 matrix it operates as a **Computational Sensor** in the Continuous timing band — it runs outside the development lifecycle to measure harness effectiveness over time.

## Install

Via the `claude-deep-suite` marketplace:

```bash
# Claude Code
/plugin install deep-dashboard@claude-deep-suite

# Codex
codex plugin install deep-dashboard
```

Or directly from this repo with `--source url` pointed at the GitHub URL.

After installation two skills become available in any session:

- `/deep-harnessability`
- `/deep-harness-dashboard`

## Skills

| Skill | Purpose |
|---|---|
| `/deep-harnessability` | Score the current codebase across 6 dimensions; render a bar chart; write `.deep-dashboard/harnessability-report.json`. |
| `/deep-harness-dashboard` | Aggregate available plugin data and render the unified effectiveness dashboard (`--json` for JSON). |
| `/deep-harness-dashboard --suite` | Accumulate the 17-metric cross-plugin telemetry time-series + markdown trend report; optional OTel export. |

### `/deep-harnessability`

Runs the scorer against the current project and displays a bar-chart report:

```
[Harnessability Report] Score: 7.2/10 (Good)

  Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
  Module Bounds    ██████░░░░  6/10  ! 1 item needs attention
  Test Infra       ███████░░░  7/10  ! no coverage config found
  Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, lock file
  Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
  CI/CD            ██████████ 10/10  ✓ CI runs tests
```

Dimensions scoring below 5 are followed by the top 3 recommendations with estimated impact.

### `/deep-harness-dashboard`

Collects data from all available plugins, runs the scorer if its report is missing or stale, computes the effectiveness score, and renders a CLI dashboard (optionally writing `harness-report-YYYY-MM-DD.md`):

```
╔═══════════════════════════════════════════════════════╗
         Deep-Suite Harness Dashboard
╠═══════════════════════════════════════════════════════╣
║ Topology: node-lib │ Harnessability: 7.2/10 (Good)   ║
╠═══════════════════════════════════════════════════════╣
║ ◆ Health Status (last: 2026-04-09)                    ║
║   dependency-vuln   ✓ clean                           ║
║   dead-export        ✗ 2 findings                     ║
╠═══════════════════════════════════════════════════════╣
║ Overall Harness Effectiveness: 6.8/10                 ║
║ Suggested actions:                                    ║
║  1. Remove unused export or add to health-ignore.json ║
╚═══════════════════════════════════════════════════════╝
```

## Harnessability scoring

Assesses codebase readiness across 6 dimensions using 17 purely computational detectors (file and config checks only — no network calls, no LLM inference).

| Dimension | Weight | What it checks |
|---|---|---|
| Type Safety | 25% | TypeScript strict mode, tsconfig.json, mypy strict, py.typed / .pyi stubs |
| Module Boundaries | 20% | dependency-cruiser config, organised src/lib/app directory, index entry-point files |
| Test Infrastructure | 20% | test framework installed, test files present, coverage configuration |
| Sensor Readiness | 15% | linter configured, type-checker available, lock file present |
| Linter & Formatter | 10% | linter config, formatter config (Prettier / Biome / EditorConfig) |
| CI/CD | 10% | CI config present (`.github/workflows`, `.gitlab-ci.yml`, `.circleci`), CI runs tests |

Each dimension scores 0–10 from the fraction of its checks that pass. Ecosystem-irrelevant checks are marked `not_applicable` and excluded from that dimension's denominator (e.g. TypeScript checks on a Python-only project), with their weight redistributed proportionally. The final score is the weighted average, rounded to one decimal.

| Grade | Score |
|---|---|
| Excellent | 8.0–10.0 |
| Good | 5.0–7.9 |
| Fair | 3.0–4.9 |
| Poor | 0.0–2.9 |

The report is saved to `.deep-dashboard/harnessability-report.json`, wrapped in the [claude-deep-suite M3 cross-plugin envelope](https://github.com/Sungmin-Cho/claude-deep-suite/blob/main/docs/envelope-migration.md) (`schema_version: "1.0"` + `envelope` block + `payload`). Domain data lives at `.payload.*` (`total`, `grade`, `dimensions`, `recommendations`). It is consumed by deep-work Phase 1 Research (when present and < 24 hours old) and by `/deep-harness-dashboard`.

## Unified dashboard

Aggregates data from installed plugins into a single terminal view or markdown report. The collector reads defensively — missing files return `null` rather than throwing — and is **M3 envelope-aware**: for each source it detects the envelope wrapper, enforces identity guards on `producer` / `artifact_kind` / `schema.name`, and exposes the unwrapped payload. Legacy un-wrapped artifacts pass through unchanged; identity-mismatched envelopes resolve to `null` with a stderr warning (defense-in-depth).

**Data sources**

| Plugin | Data read | Location |
|---|---|---|
| deep-work | slice receipts, session receipt | `.deep-work/receipts/*.json`, `.deep-work/session-receipt.json` |
| deep-review | review receipts, fitness rules | `.deep-review/receipts/*.json`, `.deep-review/fitness.json` |
| deep-docs | last doc scan | `.deep-docs/last-scan.json` |
| deep-evolve | evolve receipt | `.deep-evolve/evolve-receipt.json` |
| deep-dashboard | harnessability report | `.deep-dashboard/harnessability-report.json` |

**Effectiveness score** — a single 0–10 score from five weighted dimensions:

| Dimension | Weight | Source |
|---|---|---|
| Health | 25% | `sensors_clean_ratio` from deep-review fitness data |
| Fitness | 20% | `rules_pass_ratio` from `.deep-review/fitness.json` |
| Session | 20% | average `quality_score` of the last 3 deep-work receipts |
| Harnessability | 15% | `total` from the harnessability report |
| Evolve | 20% | `quality_score` from `.deep-evolve/evolve-receipt.json` |

If a dimension has no data, its weight is redistributed proportionally to the available dimensions; when no data is available at all, the score is `N/A`.

**Action routing** — findings from fitness rules, review receipts, and docs staleness checks map to `suggested_action` strings (e.g. `dependency-vuln` → `npm audit fix`, `docs-stale` → run `/deep-docs-scan`, `file-metric` → split large file in a deep-work session).

## Suite telemetry (`--suite`)

Suite mode is an opt-in superset of the single-snapshot dashboard. Where legacy mode renders a one-shot effectiveness view from 5 sources, suite mode accumulates a **time-series** of 17 cross-plugin metrics across all 6 deep-suite plugins, and is the substrate for OTel observability.

It reads 11 sources (8 M3 envelope artifacts + 3 NDJSON event logs), honoring `options.wikiRoot` / `DEEP_WIKI_ROOT` for vaults outside the project root. The authoritative metric catalog is [`lib/metrics-catalog.yaml`](./lib/metrics-catalog.yaml), where every metric carries its sources, aggregation formula, and `null_when` semantics.

| Tier | Metric ID | Summary |
|---|---|---|
| M4-core | `suite.hooks.block_rate` | Hook invocations blocked by hook scripts. |
| M4-core | `suite.hooks.error_rate` | Hook script internal-error rate. |
| M4-core | `suite.artifact.freshness_seconds` | Maximum age of any envelope-wrapped artifact. |
| M4-core | `suite.artifact.schema_failures_total` | Envelopes rejected by collector identity-guards. |
| M4-core | `suite.integrate.recommendation_accept_rate` | Phase 5 Integrate accept rate. |
| M4-core | `suite.review.verdict_mix` | APPROVE / CONCERN / REQUEST_CHANGES split. |
| M4-core | `suite.review.recurring_finding_count` | Findings with occurrences ≥ 2. |
| M4-core | `suite.wiki.auto_ingest_candidates_total` | **Deprecated** (always `null`): producer has no durable candidate signal; wire key preserved. |
| M4-core | `suite.wiki.ingest_actions_total` | Ingest lifecycle activity (`ingest`, `ingest-skip`, `ingest-repair`, `ingest-fail`) from deep-wiki `log.jsonl`. |
| M4-core | `suite.docs.auto_fix_accept_rate` | deep-docs garden auto-fix acceptance rate. |
| M4-core | `suite.evolve.q_delta_per_epoch` | Per-epoch quality delta. |
| M4-core | `suite.dashboard.missing_signal_ratio` | Fraction of expected sources missing or invalid. |
| M4-core | `suite.cross_plugin.run_id_chain_completeness` | `parent_run_id` chain integrity across plugins. |
| M5-activated | `suite.compaction.frequency` | Compaction events observed across sessions. |
| M5-activated | `suite.compaction.preserved_artifact_ratio` | Mean preserved-vs-discarded ratio per compaction. |
| M5-activated | `suite.handoff.roundtrip_success_rate` | Fraction of initiating handoffs that round-tripped. |
| M5.5-activated | `suite.tests.coverage_per_plugin` | Per-plugin test catalog coverage. |

**Outputs**

- `.deep-dashboard/suite-metrics.jsonl` — append-only JSONL time series (one snapshot per `--suite` run).
- `.deep-dashboard/suite-report.md` — markdown trend report with arrows (↑/↓/→/·/?) comparing the latest snapshot to the previous baseline.

**Optional OTel export** — when `OTEL_EXPORTER_OTLP_ENDPOINT` is set, the snapshot is also pushed to the configured OTLP/HTTP-JSON collector. Export failures are non-fatal: logged and reported, but they do not block local report rendering.

```bash
/deep-harness-dashboard --suite
```

## Architecture

deep-dashboard never writes to another plugin's output directory — the scorer writes only to `.deep-dashboard/` within the target project. All other reads are from the owning plugin's output directories.

```
deep-work   ──┐
              │
deep-review ──┤
              ├──► deep-dashboard (collector → effectiveness → formatter)
deep-docs   ──┤         │
              │         └──► .deep-dashboard/harnessability-report.json
deep-evolve ──┘
```

The scorer, collector, effectiveness calculator, action router, and formatter are all pure Node.js ESM modules with no external runtime dependencies.

## Links

- [Changelog](CHANGELOG.md)
- [deep-suite marketplace](https://github.com/Sungmin-Cho/claude-deep-suite)
- Related plugins: [deep-work](https://github.com/Sungmin-Cho/claude-deep-work) · [deep-review](https://github.com/Sungmin-Cho/claude-deep-review) · [deep-docs](https://github.com/Sungmin-Cho/claude-deep-docs) · [deep-evolve](https://github.com/Sungmin-Cho/claude-deep-evolve) · [deep-wiki](https://github.com/Sungmin-Cho/claude-deep-wiki)

## License

MIT
