# deep-dashboard — Project Guide

Cross-plugin harness diagnostics for the deep-suite: a pure-computational harnessability scorer
(6 weighted dimensions, 17 checks) plus a suite telemetry collector that reads other plugins' M3
envelopes and emits its own (`harnessability-report`) for deep-work Phase 1 Research. Node.js 22
on Windows/macOS/Linux, ESM, zero runtime deps — nothing outside `devDependencies`, test runner
is built-in `node --test`.

Manifests: `.claude-plugin/plugin.json` (Claude Code) + `.codex-plugin/plugin.json` (Codex);
skills in `skills/`, diagnostics in `lib/`, CLIs in `scripts/`. Version:
`jq -r .version .claude-plugin/plugin.json`; history in [`CHANGELOG.md`](CHANGELOG.md); doc rules
in `docs/DOCS_RULE.md`.

## Surfaces

- `/deep-harnessability` — synchronous scorer: bar-chart report, envelope JSON on stdout, writes
  `.deep-dashboard/harnessability-report.json`.
- `/deep-harness-dashboard` — legacy single-snapshot dashboard: CLI table, or exactly
  `{ data, effectiveness, actions }` with `--json`.
- `/deep-harness-dashboard --suite` — M4+ telemetry: appends `.deep-dashboard/suite-metrics.jsonl`,
  renders `suite-report.md`, optional OTLP export.

deep-work Phase 1 Research invokes `/deep-harnessability` when the report is missing or > 24 h old;
legacy mode runs the scorer inline when stale, then renders. `--suite` is manual-only — no other
plugin triggers it. `.deep-dashboard/` output belongs to the **target** project, never to this
repo, unless it is an intentional fixture.

## Contracts live in code — read the file, don't restate it

- `lib/suite-constants.js` — `EXPECTED_SOURCES` (15), `PAYLOAD_REQUIRED_FIELDS`,
  `PAYLOAD_SCHEMA_MAJOR`, `ENVELOPE_ROLLOUT`, `ADOPTION_LEDGER` (per-plugin adoption dates).
- `lib/metrics-catalog.yaml` — authoritative spec for all 17 suite metrics.
- `lib/harnessability/checklist.json` — dimension ids, weights, the 17 checks.
- `lib/test-catalog-manifest.json` — mirror of suite `docs/test-catalog.md` §1–§10;
  `check:catalog-drift` fails on desync.
- `test/fixtures/handoff-roundtrip/` — byte-identical mirror of suite §9; re-copy on suite update
  before release. `lib/e2e-suite-roundtrip.test.js` asserts the M5 metric values from it.

## `harnessability-report` — own emission

Identity, all four exactly: `envelope.producer === "deep-dashboard"`,
`envelope.artifact_kind === "harnessability-report"`,
`envelope.schema.name === "harnessability-report"`, `envelope.schema.version === "1.0"`.
Required payload fields: `PAYLOAD_REQUIRED_FIELDS['deep-dashboard/harnessability-report']`.

**Scoring**: `score = round((passed / applicable) * 10) / 10` per dimension,
`total = Σ(score × weight)`. `not_applicable` checks leave **both** numerator and denominator, and
their dimension weight is redistributed proportionally to the others — so a Python-only repo is
never penalised for TypeScript checks.

**Freshness**: fresh for 24 h after `envelope.generated_at`; missing, malformed,
identity-mismatched, future-dated, or ≥ 24 h → recompute. One threshold governs deep-work Phase 1
Research, the legacy-mode preflight, and both `skills/*/SKILL.md` — change them together.

## Reading other plugins' envelopes

Unwrap only when **all** hold:

- `schema_version === "1.0"`, strict string (legacy deep-docs v1.1.0 emitted numeric `2`)
- `envelope` is a non-null object, not an array (`typeof [] === "object"`)
- `payload` is a non-null, non-array object (primitives rejected)
- identity triple matches: `producer`, `artifact_kind`, `schema.name`
- required fields present per `PAYLOAD_REQUIRED_FIELDS[kind]`

**A mismatch resolves to `null` plus a stderr warning — never a throw.** Consumers read `null` as
"no data" and skip that dimension; one plugin's envelope landing under another's read path (e.g. a
symlink) is never silently trusted.

The 15 `EXPECTED_SOURCES` are the `missing_signal_ratio` denominator — 12 envelopes (deep-work
`session-receipt`/`slice-receipt`/`handoff`/`compaction-state`, deep-evolve
`evolve-receipt`/`evolve-insights`/`handoff`/`compaction-state`, deep-review
`recurring-findings`, deep-docs `last-scan`, deep-dashboard `harnessability-report`, deep-wiki
`index`) plus 3 NDJSON logs (`.deep-work/hooks.log.jsonl`, `.deep-evolve/hooks.log.jsonl`,
`<wiki_root>/log.jsonl`). The collector's 11 read sources and this 15-entry denominator are
deliberately different numbers — don't "fix" one to match the other.

## Gotchas

- **`null` ≠ missing signal.** A metric is `null` when its own source is absent, insufficient, or
  uncomputable. `missing_signal_ratio` = sources with no/invalid data ÷ 15; 0 means full
  observability, 1.0 means diagnostics have degraded to legacy fallback mode.
- **`suite.wiki.auto_ingest_candidates_total` is deprecated** — wire key preserved, value pinned
  `null` (no durable producer signal). `suite.wiki.ingest_actions_total` replaces it.
- **Chain completeness is snapshot-only.** `suite.cross_plugin.run_id_chain_completeness` =
  envelopes with a valid in-suite parent ÷ total. It validates no DAG and no transitive closure, so
  a snapshot of only reverse handoffs still scores high — by design.
- **A handoff roundtrip has no receiver-receipt file.** The receiver of a forward handoff (A→B)
  signals success by emitting a **reverse** handoff (B→A), which the aggregator counts as the
  roundtrip. Multi-ack (2 reverse to 1 forward) and unrelated-child filtering are covered by
  `lib/e2e-suite-roundtrip.test.js` Round 3 C3.
- **Legacy-fallback cutoff `2026-11-07`, exclusive.** Before it, missing envelopes are silently
  accepted; after it, a `legacy_fallback_warning` is emitted.
- **The wiki `log.jsonl` is not a hook log** — wiki ingest/query operations append to it, so the
  suite collector ignores non-hook events from it. Hook block counting spans the 3 NDJSON logs and
  keys on `event ∈ { hook-block, hook-deny }`; malformed lines are skipped, never fatal.
- **The scorer resolves its own root literally**: `lib/harnessability/scorer.js` walks upward from
  its own module path for `producer_version`, never from the caller's cwd — a consumer project may
  hold an unrelated `.claude-plugin/plugin.json`. Git-state detection uses the `projectRoot`
  parameter, also never cwd.
- **The duplicated envelope-unwrap helpers** in `lib/dashboard/collector.js` and
  `lib/suite-collector.js` are intentional (PR 1 scope boundary; consolidation deferred to M5).

## Verification

```bash
npm test                    # node --test "lib/**/*.test.js" "tests/**/*.test.js"
npm run validate:envelope   # producer_version + identity triple + payload shape
npm run check:catalog-drift # lib/test-catalog-manifest.json vs suite docs/test-catalog.md
npm run check:version-sync  # plugin.json.version === package.json.version
node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8'))"
node scripts/validate-codex-release-candidate.js --candidate-root "$PWD"
```

## Release

Releases follow the deep-suite repo's `CLAUDE.md` §Release workflow (`npm run release:bump`) as the
single source — never hand-edit marketplace manifests or suite READMEs. This repo owns only its
`CHANGELOG.md` entry and the version bump in `.claude-plugin/plugin.json`,
`.codex-plugin/plugin.json`, and `package.json` (`npm run check:version-sync`).
Suite marketplace: <https://github.com/Sungmin-Cho/claude-deep-suite>.
