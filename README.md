**English** | [한국어](./README.ko.md)

# deep-dashboard

Cross-plugin harness diagnostics for the [deep-suite](https://github.com/sungmin/deep-suite) ecosystem.

deep-dashboard provides two capabilities:

1. **Harnessability Diagnosis** — a fully computational 6-dimension assessment of how "harness-able" a codebase is, with a 0–10 score and actionable recommendations.
2. **Unified Dashboard** — aggregates sensor receipts from deep-work, deep-review, and deep-docs into a single effectiveness view with action routing.

---

### Role in Harness Engineering

deep-dashboard is the **harness diagnostics layer** in the [Deep Suite](https://github.com/Sungmin-Cho/claude-deep-suite) ecosystem, implementing two concepts from the [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) framework:

- **Harnessability Assessment**: Quantitative measurement of how "harness-able" a codebase is — 6 dimensions, 17 computational detectors, 0-10 score. The framework describes this concept qualitatively; deep-dashboard implements it as a concrete tool.
- **Human Steering Loop**: Unified dashboard that aggregates sensor results from [deep-work](https://github.com/Sungmin-Cho/claude-deep-work), [deep-review](https://github.com/Sungmin-Cho/claude-deep-review), and [deep-docs](https://github.com/Sungmin-Cho/claude-deep-docs) into a single effectiveness score with action routing — closing the feedback loop the framework calls for.

In the 2×2 matrix, deep-dashboard operates as a **Computational Sensor** in the Continuous timing band — it runs outside the development lifecycle to measure harness effectiveness over time.

---

## Installation

Install as a Claude Code plugin from the project root:

```bash
claude plugin install path/to/deep-dashboard
```

Or, if published to a registry:

```bash
claude plugin install @deep-suite/deep-dashboard
```

After installation the two skills become available in any Claude Code session:
- `/deep-harnessability`
- `/deep-harness-dashboard`

---

## Features

### Harnessability Diagnosis

Assesses codebase readiness across 6 dimensions using 17 purely computational detectors (file and config checks only — no network calls, no LLM inference).

| Dimension | Weight | What it checks |
|---|---|---|
| Type Safety | 25% | TypeScript strict mode, tsconfig.json, mypy strict, py.typed / .pyi stubs |
| Module Boundaries | 20% | dependency-cruiser config, organised src/lib/app directory, index entry-point files |
| Test Infrastructure | 20% | Test framework installed, test files present, coverage configuration |
| Sensor Readiness | 15% | Linter configured, type-checker available, lock file present |
| Linter & Formatter | 10% | Linter config file, formatter config (Prettier / Biome / EditorConfig) |
| CI/CD | 10% | CI config present (.github/workflows, .gitlab-ci.yml, .circleci), CI runs tests |

**Scoring model**

Each dimension scores 0–10 based on the fraction of its checks that pass. Ecosystem-irrelevant checks are marked `not_applicable` and excluded from that dimension's denominator (e.g. TypeScript checks on a Python-only project). The final score is a weighted average of all dimension scores, rounded to one decimal.

| Grade | Score |
|---|---|
| Excellent | 8.0–10.0 |
| Good | 5.0–7.9 |
| Fair | 3.0–4.9 |
| Poor | 0.0–2.9 |

The report is saved to `.deep-dashboard/harnessability-report.json` and is consumed by:
- **deep-work** Phase 1 Research (when the file is present and less than 24 hours old)
- `/deep-harness-dashboard` (as one of its five effectiveness inputs)

**Recommendations**

Any dimension scoring below 5 contributes its failing checks to a recommendations list. The skill surfaces the top 3 with estimated impact.

---

### Unified Dashboard

Aggregates data from all installed v1 plugins into a single terminal view or markdown report.

**Data sources (supported plugins)**

| Plugin | Data read | Location |
|---|---|---|
| deep-work | Slice receipts, session receipt | `.deep-work/receipts/*.json`, `.deep-work/session-receipt.json` |
| deep-review | Review receipts, fitness rules | `.deep-review/receipts/*.json`, `.deep-review/fitness.json` |
| deep-docs | Last doc scan | `.deep-docs/last-scan.json` |
| deep-dashboard | Harnessability report | `.deep-dashboard/harnessability-report.json` |

The collector reads defensively — missing files return `null` rather than throwing.

**Effectiveness score**

A single 0–10 effectiveness score is calculated from five weighted dimensions:

| Dimension | Weight | Source |
|---|---|---|
| Health | 25% | `sensors_clean_ratio` from deep-review fitness data |
| Fitness | 20% | `rules_pass_ratio` from `.deep-review/fitness.json` |
| Session | 20% | Average `quality_score` of the last 3 deep-work receipts (normalized 0–100 → 0–10) |
| Harnessability | 15% | `total` from `.deep-dashboard/harnessability-report.json` |
| Evolve | 20% | `quality_score` from `.deep-evolve/evolve-receipt.json` (normalized 0–100 → 0–10) |

If a dimension has no data, its weight is redistributed proportionally to the available dimensions. When no data is available at all, the effectiveness score is `N/A`.

**Action routing**

Findings from fitness rules, review receipts, and docs staleness checks are mapped to `suggested_action` strings:

| Finding type | Category | Suggested action |
|---|---|---|
| `dependency-vuln` | health | `npm audit fix` |
| `dead-export` | health | Remove unused export or add to health-ignore.json |
| `stale-config` | health | Fix broken config references |
| `coverage-trend` | health | Add tests in next deep-work session |
| `file-metric` | fitness | Split large file in deep-work session |
| `forbidden-pattern` | fitness | Remove forbidden pattern |
| `structure` | fitness | Add colocated test file |
| `dependency` | fitness | Fix dependency constraint |
| `docs-stale` | docs | Run `/deep-docs-scan` |

**Output formats**

- **CLI table** — box-drawing ASCII table rendered directly in the terminal
- **Markdown report** — `harness-report-YYYY-MM-DD.md` written to the project root on request

#### deep-evolve Integration (v1.1)

- **Data Source**: `.deep-evolve/evolve-receipt.json`
- **Effectiveness Dimension**: `evolve` (weight 0.20) — normalized from `quality_score` (0-100 → 0-10)
- **Detection Rules** (5):
  - `evolve-low-keep`: keep rate < 15% → strategy refinement recommended
  - `evolve-high-crash`: crash rate > 20% → eval harness inspection
  - `evolve-low-q`: fires when the earliest of the last-3 `q_trajectory` values is more than 0.05 above the most recent value (i.e., the recent 3-point window is trending down) → strategy review
  - `evolve-stale`: receipt older than 30 days → further experiments recommended
  - `evolve-no-transfer`: transfer learning unused → meta-archive buildup recommended
- **Formatter**: Evolve section rendered in CLI and Markdown output (discarded sessions are shown separately)

**Schema notes**
- `transfer.received_from`: `non-empty string | null`. Empty strings and numeric sentinels are not part of the schema; `null` means no transfer learning was received.

---

## Skills

### `/deep-harnessability`

Runs the harnessability scorer against the current project and displays a bar-chart report.

```
/deep-harnessability
```

Example output:

```
[Harnessability Report] Score: 7.2/10 (Good)

  Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
  Module Bounds    ██████░░░░  6/10  ! 1 item needs attention
  Test Infra       ███████░░░  7/10  ! no coverage config found
  Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, lock file
  Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
  CI/CD            ██████████ 10/10  ✓ CI runs tests
```

Dimensions scoring below 5 are followed by the top 3 recommendations with estimated impact. The report is saved to `.deep-dashboard/harnessability-report.json`.

---

### `/deep-harness-dashboard`

Aggregates all available plugin data and renders the unified dashboard.

```
/deep-harness-dashboard
```

With JSON output:

```
/deep-harness-dashboard --json
```

The skill:
1. Collects data from all available v1 plugins.
2. Runs `/deep-harnessability` if the report is missing or stale.
3. Calculates the effectiveness score.
4. Renders the CLI dashboard.
5. Optionally generates a markdown report (`harness-report-YYYY-MM-DD.md`) and offers to commit it.

Example CLI output:

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

---

## Architecture

deep-dashboard is a **read-only consumer** of the deep-suite ecosystem. It never writes to another plugin's output directory.

```
deep-work   ──┐
              │
deep-review ──┤
              ├──► deep-dashboard (collector → effectiveness → formatter)
deep-docs   ──┤         │
              │         └──► .deep-dashboard/harnessability-report.json
deep-evolve ──┘
```

The harnessability scorer writes only to `.deep-dashboard/` within the target project. All other reads are from the owning plugin's output directories (`.deep-work/`, `.deep-review/`, `.deep-docs/`).

The scorer, collector, effectiveness calculator, action router, and formatter are all pure Node.js ESM modules with no external runtime dependencies.

---

## v1 Scope

**Supported plugins:** deep-work, deep-review, deep-docs.

**Deferred to v2:**
- Inferential review (LLM-assisted harnessability hints)
- `changedFiles` scoping (score only files changed in the current session)
- deep-wiki and deep-research data contracts
