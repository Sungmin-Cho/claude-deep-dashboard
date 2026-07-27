---
name: deep-harnessability
description: Rates codebase harness-ability across 6 weighted dimensions. Triggers on "코드베이스 진단", "harness 준비도", "harnessability 점수", "type safety / 센서 / CI 점검", "harness 가능성 평가", "diagnose codebase", "harness readiness score", "rate this repo". Emits `.deep-dashboard/harnessability-report.json`.
---

# Harnessability Diagnosis

Assess how "harness-able" this codebase is. Every measurement is computational — no LLM inference.

## Invocation

Slash command `/deep-harnessability`, or directly
`node <plugin-root>/lib/harnessability/scorer.js --project-root <target-project-root>`.

### Loaded-SKILL routing handoff

`pluginRoot = dirname(dirname(dirname(loadedSkillPath)))`, where `loadedSkillPath` is this file's
absolute path as the host passes it — Claude Code derives it from
`realpath($CLAUDE_PLUGIN_ROOT/skills/deep-harnessability/SKILL.md)`; Codex passes the loaded
`SKILL.md` path itself and defines no `CLAUDE_*` variable. Build the scorer path from `pluginRoot`;
if `loadedSkillPath` is unavailable, fail with a routing error rather than inferring a root. The
caller's cwd is neither the plugin root nor an implicit target root, so always pass the target as
`--project-root`. Prefer absolute Node argv through the host execution tool — the commands below
are fallback documentation; substitute the real absolute root and never execute an argument
containing `..`.

```text
POSIX scorer:      node "$CLAUDE_PLUGIN_ROOT/lib/harnessability/scorer.js" --project-root "$PWD"
PowerShell scorer: node "C:\absolute\plugin\lib\harnessability\scorer.js" --project-root (Get-Location).Path
```

The scorer never defaults to `process.cwd()`. One positional root (`node scorer.js PATH`) stays a
compatibility form; a missing root, duplicate flags, extra positionals, or a positional root
combined with `--project-root` are usage errors.

## Steps

1. Run the scorer:
   ```bash
   node "<absolute-plugin-root>/lib/harnessability/scorer.js" --project-root "<absolute-target-project-root>"
   ```
   It prints the M3 envelope on stdout and writes the same envelope to
   `.deep-dashboard/harnessability-report.json`.

2. Render the report as a bar chart from `payload.total`, `payload.grade`, and
   `payload.dimensions[]` — NOT the top-level keys, which belong to the envelope wrapper. Bars use
   `█` (filled) and `░` (empty) over a fixed 10-character width with `filled = round(score)`; the
   labels are display abbreviations of `payload.dimensions[].label`.
   ```
   [Harnessability Report] Score: X.X/10 (Grade)

     Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
     Module Bounds    ██████░░░░  6/10  ! 3 items need attention
     Test Infra       ███████░░░  7/10  ! no coverage config found
     Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, coverage available
     Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
     CI/CD            ██░░░░░░░░  2/10  ✗ no CI config detected
   ```

3. If any dimension in `payload.dimensions[]` scores **below 5**, present the top 3 entries from
   `payload.recommendations[]` with estimated impact. 5 is the scorer's recommendation-emit
   boundary (`lib/harnessability/scorer.js`); `payload.recommendations[]` is one flat array to
   which only sub-5 dimensions contribute.

4. If `payload.topology_hints` is non-null, render each string as a suggestion.
   `payload.topology` and `payload.topology_hints` are **caller-injected** via
   `scoreHarnessability(projectRoot, { topology, topologyHints })`; the CLI entry injects neither,
   so both are `null` in standalone runs — then this step is a no-op.

## Output file

`.deep-dashboard/harnessability-report.json` is a deep-suite M3 cross-plugin envelope
(claude-deep-suite `docs/envelope-migration.md` §1): top-level `schema_version: "1.0"` + `envelope`
(producer, run_id ULID, git, provenance) + `payload` (score, grade, dimensions, recommendations).
Identity, all four exact — these are what downstream identity guards check:

- `envelope.producer === "deep-dashboard"`
- `envelope.artifact_kind === "harnessability-report"`
- `envelope.schema.name === "harnessability-report"`
- `envelope.schema.version === "1.0"`

## Freshness contract (this plugin)

The report is fresh for **24 hours after `envelope.generated_at`**; missing, malformed,
identity-mismatched, future-dated, or ≥ 24 h → recompute. The threshold is implemented once, as
`DAY_MS` in `scripts/dashboard-cli.js`; its prose sites are both `skills/*/SKILL.md` and
`<plugin-root>/AGENTS.md` — change them together. It governs this plugin's own reuse only; other
plugins set their own policy.

## Consumed by

- **deep-harness-dashboard** legacy mode step 1 — applies the 24 h rule above through the dashboard
  CLI's freshness preflight, re-running the scorer before `lib/dashboard/collector.js` reads the
  envelope. Aggregator-pattern producer: it writes only the target project's refreshed report.
- **deep-work** Phase 1 Research — reads the report **read-only** when it exists, applying the same
  envelope identity guards, and skips one older than **7 days** (its own policy, not the 24 h
  threshold). It never re-runs the scorer.
