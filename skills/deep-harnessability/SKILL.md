---
name: deep-harnessability
description: This skill should be used when the user asks to assess how "harness-able" a codebase is — diagnosing type safety, module boundaries, test infrastructure, sensor readiness, linter/formatter configuration, and CI/CD presence across 6 weighted dimensions. Trigger phrases include "코드베이스 진단", "harness 준비도", "harnessability 점수", "type safety / 센서 / CI 점검", "harness 가능성 평가", "diagnose codebase", "harness readiness score", "rate this repo". Runs a pure-computational scorer (no LLM inference), emits an M3 envelope to `.deep-dashboard/harnessability-report.json`, and surfaces a 0-10 score plus top recommendations.
---

# Harnessability Diagnosis

Assess how "harness-able" this codebase is. All measurements are computational — no LLM inference needed.

## Invocation

- Slash command: `/deep-harnessability` (registered via this skill's frontmatter).
- Direct script: `node <plugin-root>/lib/harnessability/scorer.js --project-root <target-project-root>`.

### Loaded-SKILL routing handoff

The host passes the absolute path of this exact loaded file as
`loadedSkillPath` to its execution tool. Derive
`pluginRoot = dirname(dirname(dirname(loadedSkillPath)))`, then construct the
absolute `lib/harnessability/scorer.js` path from that root. The caller's
current directory is neither the plugin root nor an implicit target root: pass
the target explicitly as `--project-root`.

- **Claude Code:** its plugin launcher obtains the absolute loaded path as
  `realpath($CLAUDE_PLUGIN_ROOT/skills/deep-harnessability/SKILL.md)` and passes
  that exact path as `loadedSkillPath`. `CLAUDE_PLUGIN_ROOT` is only the Claude
  bootstrap used to form the absolute loaded path; routing then uses the
  path-derived root.
- **Codex:** the marketplace skill loader passes the absolute filesystem path
  of the selected `skills/deep-harnessability/SKILL.md` as `loadedSkillPath` in
  the execution request. Codex does not invent a `CLAUDE_*` or other
  environment variable. If the path is unavailable, fail with a routing error
  rather than inferring a plugin root from the target cwd.

Prefer passing the absolute Node argv directly through the host execution tool.
These shell commands are fallback documentation only. For the PowerShell form,
substitute `C:\absolute\plugin` first with the real absolute path derived three
levels above `loadedSkillPath`; do not execute an argument containing `..`.

```text
POSIX scorer:         node "$CLAUDE_PLUGIN_ROOT/lib/harnessability/scorer.js" --project-root "$PWD"
PowerShell scorer:    node "C:\absolute\plugin\lib\harnessability\scorer.js" --project-root (Get-Location).Path
```

One positional root remains a compatibility form (`node scorer.js PATH`), but
it is still explicit. The scorer rejects a missing root, duplicate flags, extra
positionals, and a positional root combined with `--project-root` as usage
errors; it never defaults to `process.cwd()`.

Also runs automatically inside deep-work Phase 1 Research when deep-dashboard is installed and the report is missing or older than 24 hours (see "Consumed by" below for the shared freshness contract).

## Steps

1. Run the scorer:
   ```bash
   node "<absolute-plugin-root>/lib/harnessability/scorer.js" --project-root "<absolute-target-project-root>"
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
   --project-root <projectRoot>`) does not inject either, so both fields default to `null`
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
- **deep-harness-dashboard** (legacy mode, step 1) — same 24h re-run rule via
  the dashboard CLI's freshness preflight before `collector.js` reads the
  envelope. Aggregator-pattern producer; the dashboard writes only the target
  project's refreshed report.

## Usage

Run independently: `/deep-harnessability`
Or automatically in deep-work Phase 1 Research if deep-dashboard is installed.
