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
   This outputs JSON with the score, grade, dimensions, and recommendations.
   It also saves the result to `.deep-dashboard/harnessability-report.json`.

2. Display the formatted report to the user using bar chart format:
   ```
   [Harnessability Report] Score: X.X/10 (Grade)

     Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
     Module Bounds    ██████░░░░  6/10  ! 3 items need attention
     Test Infra       ███████░░░  7/10  ! no coverage config found
     Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, coverage available
     Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
     CI/CD            ██░░░░░░░░  2/10  ✗ no CI config detected
   ```

3. If any dimension scores below 5, present the top 3 recommendations with estimated impact.

4. If topology was detected, show topology-specific hints from `harnessability_hints`.

## Output File

The result file at `.deep-dashboard/harnessability-report.json` is consumed by:
- deep-work Phase 1 Research (if file exists and is < 24h old)
- deep-harness-dashboard (as a data source)

## Usage

Run independently: `/deep-harnessability`
Or automatically in deep-work Phase 1 Research if deep-dashboard is installed.
