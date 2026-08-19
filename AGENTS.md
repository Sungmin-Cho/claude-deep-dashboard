# deep-dashboard — Project Guide

Cross-plugin harness diagnostics for the deep-suite: a pure-computational harnessability scorer
(6 weighted dimensions, 17 checks) plus a suite telemetry collector that reads other plugins' M3
envelopes and emits its own (`harnessability-report`) for deep-work Phase 1 Research. Node.js 22
on Windows/macOS/Linux, ESM, zero runtime deps — nothing outside `devDependencies`, test runner
is built-in `node --test`.

Manifests: `<plugin-root>/.claude-plugin/plugin.json` (Claude Code) +
`<plugin-root>/.codex-plugin/plugin.json` (Codex); skills in `skills/`, diagnostics in `lib/`, CLIs
in `scripts/`. Version: `jq -r .version <plugin-root>/.claude-plugin/plugin.json`; history in
[`CHANGELOG.md`](CHANGELOG.md).

> 📄 Doc maintenance follows `docs/DOCS_RULE.md` — a maintainer rulebook that is gitignored and
> ships with nothing. It exists only in a maintainer's own checkout; never try to open it at
> runtime, because the only place that path can resolve in an installed plugin is the project
> being analysed.

## Surfaces

- `/deep-harnessability` — synchronous scorer: bar-chart report, envelope JSON on stdout, writes
  `.deep-dashboard/harnessability-report.json`.
- `/deep-harness-dashboard` — legacy single-snapshot dashboard: CLI table, or exactly
  `{ data, effectiveness, actions }` with `--json`.
- `/deep-harness-dashboard --suite` — M4+ telemetry: appends `.deep-dashboard/suite-metrics.jsonl`,
  renders `suite-report.md`, optional OTLP export.

Legacy mode runs the scorer inline when the report is stale, then renders. deep-work Phase 1
Research consumes the report **read-only** and never triggers a scorer run. `--suite` is
manual-only — no other plugin triggers it. `.deep-dashboard/` output belongs to the **target** project, never to this
repo, unless it is an intentional fixture.

## Contracts live in code — read the file, don't restate it

- `<plugin-root>/lib/suite-constants.js` — `EXPECTED_SOURCES` (15), `PAYLOAD_REQUIRED_FIELDS`,
  `PAYLOAD_SCHEMA_MAJOR`, `ENVELOPE_ROLLOUT`, `ADOPTION_LEDGER` (per-plugin adoption dates).
- `<plugin-root>/lib/metrics-catalog.yaml` — authoritative spec for all 17 suite metrics.
- `<plugin-root>/lib/harnessability/checklist.json` — dimension ids, weights, the 17 checks.
- `<plugin-root>/lib/test-catalog-manifest.json` — mirror of §1–§8 of the test catalog kept in the
  deep-suite registry repo; `check:catalog-drift` fails on desync.
- `<plugin-root>/test/fixtures/handoff-roundtrip/` — byte-identical mirror of suite §9; re-copy on
  suite update before release. `<plugin-root>/lib/e2e-suite-roundtrip.test.js` asserts the M5
  metric values from it.

## `harnessability-report` — own emission

Identity, all four exactly: `envelope.producer === "deep-dashboard"`,
`envelope.artifact_kind === "harnessability-report"`,
`envelope.schema.name === "harnessability-report"`, `envelope.schema.version === "1.0"`.
Required payload fields: `PAYLOAD_REQUIRED_FIELDS['deep-dashboard/harnessability-report']`.

**Scoring**: `score = round((passed / applicable) * 100) / 10` per dimension — a 0–10 value with
one decimal, not a 0–1 fraction — and `total = round(Σ(score × weight) × 10) / 10`.
`not_applicable` checks are excluded from **both** the numerator and the denominator of their own
dimension's score.

**Freshness — this plugin only**: fresh for 24 h after `envelope.generated_at`; missing, malformed,
identity-mismatched, future-dated, or ≥ 24 h → recompute. The threshold is implemented once, as
`DAY_MS` in `<plugin-root>/scripts/dashboard-cli.js`, and governs the legacy-mode preflight; its prose sites are
both `skills/*/SKILL.md` and this file — change them together. It binds no other plugin: deep-work
Phase 1 Research reads the report read-only and skips one older than **7 days** by its own policy
(deep-work `skills/deep-research/SKILL.md` §Cross-Plugin Context).

## Reading other plugins' envelopes

The two readers are deliberately not equally strict (the duplication is intentional — see Gotchas).

**Suite collector** — `unwrapStrict` in `<plugin-root>/lib/suite-collector.js` unwraps only when
**all** hold:

- `schema_version === "1.0"`, strict string (legacy deep-docs v1.1.0 emitted numeric `2`)
- `envelope` is a non-null object, not an array (`typeof [] === "object"`)
- identity triple matches: `producer`, `artifact_kind`, `schema.name`
- payload schema MAJOR matches `PAYLOAD_SCHEMA_MAJOR['<producer>/<artifact_kind>']` (MINOR is
  additive, accepted)
- `payload` is a non-null, non-array object carrying every
  `PAYLOAD_REQUIRED_FIELDS['<producer>/<artifact_kind>']` field

A failure returns `{ failure: <reason>, source }` — never `null`, never a throw — and the caller
records it per source with **nothing written to stderr**. Those counts sum into
`suite.artifact.schema_failures_total`; they do **not** drive `missing_signal_ratio`, which
independently counts how many of the 15 `EXPECTED_SOURCES` yielded *zero usable signal* (an envelope
source with no accepted envelope; an NDJSON log missing, errored, or empty). The two move
independently: one accepted envelope beside three rejected ones is 3 schema failures and 0 missing
signal, while an absent `last-scan.json` is 1/15 missing signal and 0 failures.

**Legacy collector** — `unwrapEnvelope` in `<plugin-root>/lib/dashboard/collector.js` **passes anything not
envelope-shaped (including `null`) through unchanged**, so pre-envelope artifacts keep working, and
it applies **no required-field check**. Envelope-shaped input still gets the identity, schema-MAJOR,
and payload-object guards; violating any of them returns `null` **plus a `console.warn` on stderr**.

Neither reader ever throws, and only the legacy reader resolves a rejection to `null` — consumers
read that `null` as "no data" and skip the dimension. Neither one silently trusts a plugin's
envelope landing under another's read path (e.g. via a symlink).

The 15 `EXPECTED_SOURCES` are the `missing_signal_ratio` denominator, and the suite collector reads
exactly that set: 12 envelopes (deep-work
`session-receipt`/`slice-receipt`/`handoff`/`compaction-state`, deep-evolve
`evolve-receipt`/`evolve-insights`/`handoff`/`compaction-state`, deep-review
`recurring-findings`, deep-docs `last-scan`, deep-dashboard `harnessability-report`, deep-wiki
`index`) plus 3 NDJSON logs (`.deep-work/hooks.log.jsonl`, `.deep-evolve/hooks.log.jsonl`,
`<wiki_root>/log.jsonl`).

## Gotchas

- **Harnessability weights are never renormalised.** A dimension whose checks are *all*
  `not_applicable` scores `0` and still contributes `0 × weight` to `total`, so a Go/Rust/Java repo
  really is marked down for `type_safety` (0.25 of the total). This ecosystem-mismatch penalty is
  deliberate — weight redistribution was considered and rejected to keep `payload.total` comparable
  across snapshots — and `<plugin-root>/lib/harnessability/missing-signal.test.js` pins it. Changing
  the math needs its own PR and version bump. The **effectiveness** scorer
  (`<plugin-root>/lib/dashboard/effectiveness.js`) does the opposite on purpose: it redistributes a missing
  dimension's weight across the available ones. Two scorers, two rules — don't unify them.
- **`null` ≠ missing signal.** A metric is `null` when its own source is absent, insufficient, or
  uncomputable. `missing_signal_ratio` = sources with no/invalid data ÷ 15; 0 means full
  observability, 1.0 means diagnostics have degraded to legacy fallback mode.
- **`suite.wiki.auto_ingest_candidates_total` is deprecated** — wire key preserved, value pinned
  `null` (no durable producer signal). `suite.wiki.ingest_actions_total` replaces it.
- **Chain completeness is snapshot-only.** `suite.cross_plugin.run_id_chain_completeness` =
  envelopes whose `parent_run_id` resolves ÷ envelopes that **declare** a `parent_run_id`
  (aggregator kinds excluded from both sides). With nothing declaring a parent the value is `null`,
  not `0`. It validates no DAG and no transitive closure, so a snapshot of only reverse handoffs
  still scores high — by design.
- **A handoff roundtrip has no receiver-receipt file.** A forward handoff (A→B) is closed by **any**
  non-aggregator envelope whose `parent_run_id` is that handoff's `run_id` and whose `producer`
  equals the handoff's `payload.to.producer` — a reverse handoff, a plain receipt, whatever B emits.
  Two consequences: a handoff carrying no `payload.to.producer` can **never** be closed and sits in
  the denominator forever, and a child emitted by the *sender* never counts. Multi-ack, the
  missing-receiver case, and unrelated-child filtering are pinned in
  `<plugin-root>/lib/aggregator.test.js`; `<plugin-root>/lib/e2e-suite-roundtrip.test.js` covers the
  closed- and broken-chain cases only.
- **Legacy-fallback cutoff `2026-11-07`, exclusive** — but the switch is **not wired up**.
  `legacyFallbackExpired()` exists in `<plugin-root>/lib/suite-constants.js` and is unit-tested, and no emit path
  calls it, so no `legacy_fallback_warning` is produced today, before or after the cutoff. Treat the
  cutoff as a planned behaviour, not a current one.
- **The wiki `log.jsonl` is not a hook log.** `suite.hooks.block_rate` and `error_rate` skip every
  source whose `kind !== 'hook-log'`, so the wiki vault log is excluded **as a source** — even a
  well-formed hook event inside it could never be counted. Hook metrics therefore span exactly the
  two hook logs (deep-work, deep-evolve); the wiki log feeds wiki metrics only. Blocking keys on
  `event ∈ { hook-block, hook-deny }`; malformed lines are skipped, never fatal.
- **The scorer resolves its own root literally**: `<plugin-root>/lib/harnessability/scorer.js` reads
  `producer_version` from `../../.claude-plugin/plugin.json` resolved against its own module path,
  never from the caller's cwd — a consumer project may hold an unrelated Claude plugin manifest of
  its own. Git-state detection uses the `projectRoot` parameter, also never cwd.
- **The duplicated envelope-unwrap helpers** in `<plugin-root>/lib/dashboard/collector.js` and
  `<plugin-root>/lib/suite-collector.js` are intentional (PR 1 scope boundary; consolidation
  deferred to M5).

## Verification

```bash
npm test                    # node --test "lib/**/*.test.js" "tests/**/*.test.js"
npm run validate:envelope   # producer_version + identity triple + payload shape
npm run check:catalog-drift # <plugin-root>/lib/test-catalog-manifest.json vs the suite test catalog
npm run check:version-sync  # plugin.json.version === package.json.version
node -e "JSON.parse(require('fs').readFileSync('<plugin-root>/.codex-plugin/plugin.json','utf8'))"
node "<plugin-root>/scripts/validate-codex-release-candidate.js" --candidate-root "$PWD"
```

## Release

Releases follow the deep-suite repo's `CLAUDE.md` §Release workflow (`npm run release:bump`) as the
single source — never hand-edit marketplace manifests or suite READMEs. The one exception:
`release:bump` does not write the suite's `.agents/plugins/marketplace.json` mirror, which stays
manually synced. This repo owns only its
`CHANGELOG.md` entry and the version bump in `<plugin-root>/.claude-plugin/plugin.json`,
`<plugin-root>/.codex-plugin/plugin.json`, and `package.json` (`npm run check:version-sync`).
Suite marketplace: <https://github.com/Sungmin-Cho/deep-suite>.
