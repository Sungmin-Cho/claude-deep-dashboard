---
name: deep-harnessability
description: Assess codebase harnessability — type safety, module boundaries, test infrastructure, sensor readiness, linter/formatter, CI/CD. Outputs a 0-10 score with recommendations.
---

# Harnessability Diagnosis

Assess how "harness-able" this codebase is. All measurements are computational — no LLM inference needed.

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
   ```
   [Harnessability Report] Score: X.X/10 (Grade)

     Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
     Module Bounds    ██████░░░░  6/10  ! 3 items need attention
     Test Infra       ███████░░░  7/10  ! no coverage config found
     Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, coverage available
     Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
     CI/CD            ██░░░░░░░░  2/10  ✗ no CI config detected
   ```

3. If any dimension in `payload.dimensions[]` scores below 5, present the top
   3 entries from `payload.recommendations[]` with estimated impact.

4. If topology was detected, show topology-specific hints from `payload.topology_hints`.

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

Consumed by:
- deep-work Phase 1 Research (if file exists and is < 24h old) — envelope-aware
- deep-harness-dashboard (as a data source) — envelope-aware via collector unwrap

## Usage

Run independently: `/deep-harnessability`
Or automatically in deep-work Phase 1 Research if deep-dashboard is installed.
