---
name: deep-harnessability
description: This skill should be used when the user asks to assess how "harness-able" a codebase is — diagnosing type safety, module boundaries, test infrastructure, sensor readiness, linter/formatter configuration, and CI/CD presence across 6 weighted dimensions. Trigger phrases include "코드베이스 진단", "harness 준비도", "harnessability 점수", "type safety / 센서 / CI 점검", "harness 가능성 평가", "diagnose codebase", "harness readiness score", "rate this repo". Runs a pure-computational scorer (no LLM inference), emits an M3 envelope to `.deep-dashboard/harnessability-report.json`, and surfaces a 0-10 score plus top recommendations.
---

# Harnessability Diagnosis

Assess how "harness-able" this codebase is. All measurements are computational — no LLM inference needed.

## Invocation

- Slash command: `/deep-harnessability` (registered via this skill's frontmatter).
- Direct script: `node "${CLAUDE_PLUGIN_ROOT}/lib/harnessability/scorer.js" "${CLAUDE_PROJECT_DIR}"` — identical output.

Also runs automatically inside deep-work Phase 1 Research when deep-dashboard is installed and the report is missing or older than 24 hours (see "Consumed by" below for the shared freshness contract).

## Steps

1. Run the scorer:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lib/harnessability/scorer.js" "${CLAUDE_PROJECT_DIR}"
   ```
   This outputs JSON (the M3 envelope) on stdout and writes the same envelope
   to `.deep-dashboard/harnessability-report.json`. The domain data (score,
   grade, dimensions, recommendations) is inside `payload`.

2. Display the formatted report to the user using bar chart format. Read
   `payload.total`, `payload.grade`, and `payload.dimensions[]` from the
   envelope (NOT the top-level — those keys belong to the envelope wrapper).
   Each bar is rendered with block characters `█` (filled) and `░` (empty)
   over a fixed 10-character width, where `filled = round(score)`.
   ```
   [Harnessability Report] Score: X.X/10 (Grade)

     Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
     Module Bounds    ██████░░░░  6/10  ! 3 items need attention
     Test Infra       ███████░░░  7/10  ! no coverage config found
     Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, coverage available
     Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
     CI/CD            ██░░░░░░░░  2/10  ✗ no CI config detected
   ```

   Label-to-payload mapping (the bar labels are display-only abbreviations of
   `payload.dimensions[].label`):

   | Bar label | `payload.dimensions[].id` | Weight |
   |---|---|---|
   | Type Safety | `type_safety` | 0.25 |
   | Module Bounds | `module_boundaries` | 0.20 |
   | Test Infra | `test_infra` | 0.20 |
   | Sensor Ready | `sensor_readiness` | 0.15 |
   | Linter/Fmt | `linter_formatter` | 0.10 |
   | CI/CD | `ci_cd` | 0.10 |

3. If any dimension in `payload.dimensions[]` scores **below 5** (Fair/Poor
   band — the same boundary the grade table in README uses to separate
   actionable from healthy dimensions), present the top 3 entries from
   `payload.recommendations[]` with estimated impact. The 5-point boundary is
   the scorer's internal recommendation-emit threshold (see
   `lib/harnessability/scorer.js`): below 5 the scorer surfaces failing
   checks into `payload.recommendations[]`; at or above 5 the dimension is
   self-healing and no recommendations are emitted.

4. If `payload.topology_hints` is non-null, surface topology-specific advice.
   `payload.topology` and `payload.topology_hints` are **caller-injected**
   via `scoreHarnessability(projectRoot, { topology, topologyHints })`
   (see `lib/harnessability/scorer.js`). The CLI entry (`node scorer.js
   <projectRoot>`) does not inject either, so both fields default to `null`
   in standalone runs — render this step as a no-op when both are null.
   When a parent flow (e.g. deep-work Phase 1) does inject `topology_hints`
   (a `string[]`), render each line as a suggestion.

## Output File

The result file at `.deep-dashboard/harnessability-report.json` is the
**claude-deep-suite M3 cross-plugin envelope** (`docs/envelope-migration.md` §1):
top-level `schema_version: "1.0"` + `envelope` block (producer, run_id ULID,
git, provenance) + `payload` (score, grade, dimensions, recommendations).

Envelope identity (defense-in-depth identity guards for downstream readers):
- `envelope.producer === "deep-dashboard"`
- `envelope.artifact_kind === "harnessability-report"`
- `envelope.schema.name === "harnessability-report"`
- `envelope.schema.version === "1.0"`

## Freshness contract (shared with consumers)

The report is treated as fresh for **24 hours after `envelope.generated_at`**.
This single threshold governs every downstream consumer in the suite —
update the threshold here, in `lib/harnessability/scorer.js`, and in the
sibling `deep-harness-dashboard` skill together so the policy stays
unambiguous.

## Consumed by

- **deep-work** Phase 1 Research — re-runs this skill when the file is missing
  or older than the 24h freshness threshold above; otherwise unwraps the
  envelope and uses the cached payload. Envelope-aware.
- **deep-harness-dashboard** (legacy mode, step 2) — same 24h re-run rule via
  `collector.js`'s envelope-aware reader. Aggregator-pattern producer; the
  dashboard never writes back here.

## Usage

Run independently: `/deep-harnessability`
Or automatically in deep-work Phase 1 Research if deep-dashboard is installed.
