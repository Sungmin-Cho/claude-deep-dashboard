**English** | [한국어](./CHANGELOG.ko.md)

# Changelog

## [1.3.1] — 2026-05-11 — M5 Activation: handoff + compaction-state metrics

Activates 3 of the 4 M4-deferred metrics now that
`claude-deep-suite` PRs #11/#12/#13 (merged 2026-05-11) have ratified the
`handoff` and `compaction-state` payload schemas. The 4th deferred metric
(`suite.tests.coverage_per_plugin`) stays deferred until M5.5 — its source
(`ci-status-aggregate`) is independent of M5 schema work.

Single PR, backward-compatible additions only.

### Round 1 review polish (3-way: Opus + Codex review + Codex adversarial)

`/deep-review` C1 (3-way agreement) + W1 (Opus single) addressed in PR.
Round 1 expanded the dashboard's source declaration to match the actual
producer surface described in the suite guides.

- **C1 (3-way) — Handoff metric discovery contract**:
  - `EXPECTED_SOURCES` 13 → 15: added `(deep-evolve, handoff)` and
    `(deep-evolve, compaction-state)`. Reverse handoffs
    (`handoff_kind: "evolve-to-deep-work"`) are emitted by deep-evolve per
    `long-run-handoff.md` §4.3; compaction-state is also a deep-evolve emit
    at epoch boundaries per `context-management.md` §6.
  - New collector cardinality `dir+session-glob`: each (producer, kind)
    source now scans BOTH the flat aggregation dir
    (`.deep-<plugin>/<kind-plural>/*.json`) AND per-session subdir
    (`.deep-<plugin>/<session>/<kind-singular>.json`). Matches both layouts
    that appear in suite docs without forcing producers to write duplicates.
  - `computeHandoffRoundtripSuccessRate` and the two compaction metrics now
    aggregate across all `(*, handoff)` / `(*, compaction-state)` sources.
  - `computeCompactionFrequency` / `computeHandoffRoundtripSuccessRate`
    `source_summary` carries a `*_producers` array for drill-down.
  - End-to-end fixture pair: `handoff.fixture.json` +
    `evolve-receipt-roundtrip.fixture.json` (chains back via `parent_run_id`)
    + new e2e test asserts `roundtrip_success_rate === 1.0` on happy path.
- **W1 (Opus) — Aggregator-kind exclusion in roundtrip metric**:
  - `AGGREGATOR_KINDS` promoted from `suite-collector.js#_internal` to
    `suite-constants.js` as a top-level export (shared single source of truth).
  - `computeHandoffRoundtripSuccessRate` now skips aggregator-kind envelopes
    (`harnessability-report`, `evolve-insights`, `index`) when building
    `childrenByParent` — matches the catalog contract ("downstream
    non-aggregator envelope's parent_run_id chains back") and mirrors
    `reconstructChains`'s existing exclusion logic.
- **I1 — `missing_signal_ratio` source_summary**: literal `expected_total: 13`
  replaced with `EXPECTED_SOURCES.length` to prevent magic-number drift on
  the next activation cycle.

Test count: 188 → 201 (+13 round-1 review tests covering per-session subdir
discovery, flat+session merge no-double-count, hidden-dir skip, reverse
handoff identity validation, aggregator-kind exclusion, and the happy-path
fixture pair).

### Round 2 review polish (3-way: Opus + Codex review + Codex adversarial)

- **C2 (Codex review P2 — security)** Symlink containment in
  `readSessionGlob`: previously followed symlinks via `readJsonSafe` without
  the realpath boundary check that `readJsonDir` enforces. A malicious
  `.deep-work/<session>/handoff.json` symlinked outside the project root
  could ingest forged JSON as a valid M5 envelope. Fix mirrors
  `readJsonDir`'s containment check; out-of-boundary symlinks fail with
  `out-of-boundary-symlink` reason. In-tree symlinks (atomic-swap pattern)
  still honored.
- **W2 (Codex adversarial MEDIUM)** `computeHandoffRoundtripSuccessRate`
  tightened to enforce receiver semantics per guide §7. A child envelope
  now must satisfy BOTH (a) `parent_run_id === handoff.run_id` AND (b)
  `child.envelope.producer === handoff.payload.to.producer`. Previously
  any non-aggregator child counted, allowing a same-sender follow-up
  artifact to falsely mark the handoff as roundtripped.
- **W3 (Codex P3 + Opus Info-2, 2-way)** `source_summary.handoff_producers`
  and `compaction_producers` now filter to sources with non-empty
  envelopes — empty sources (e.g., deep-evolve handoff source in a
  project that only emits forward handoffs) no longer appear in the
  drill-down.
- **I5 (Opus Info-1)** Updated stale "// All 13 expected sources missing"
  comment to "All 15" in `suite-collector.test.js`.
- **I6 (Opus Info-3)** Added docstring note in `readSessionGlob` about
  session-name convention (`<date>-<slug>` per long-run-handoff.md §4.1)
  and the intentional skip for names colliding with flat-aggregation
  dirnames.

Test count: 201 → 209 (+8 round-2 tests: out-of-tree symlink rejection,
broken symlink rejection, in-tree symlink allowed, unrelated-sender child
rejection (W2 negative), receiver-produced child counting (W2 positive),
missing payload.to defensive path, and 2 W3 symmetric tests for
empty-source filtering on handoff + compaction).

### Round 3 review polish (3-way: Opus + Codex review + Codex adversarial)

- **C3 (Codex adversarial HIGH)** Reverse handoff inflated denominator.
  Per `long-run-handoff.md` §7, a reverse handoff (handoff whose
  `parent_run_id` chains to another handoff's `run_id`) IS the receiver's
  success signal for the upstream handoff — NOT a fresh initiating
  handoff requiring its own child. Round-2 counted ALL handoffs in the
  denominator, capping the canonical happy path (forward + reverse) at
  50% — materially misleading for an operator dashboard.
  Fix: denominator = INITIATING handoffs only (parent_run_id absent OR
  not chaining to another handoff's run_id). `source_summary` now exposes
  `handoffs_continuation` for drill-down. The canonical happy path now
  correctly reports 1.0.
- **W4 (Codex review P2)** `dir+session-glob` merge concatenated flat +
  per-session entries without dedup by `run_id`. A producer writing the
  same envelope to both layouts (transitional period, accidental
  double-write) would inflate `compaction.frequency`, the `roundtrip`
  denominator, and the `chains` index.
  Fix: dedup by `envelope.run_id` within the merged source result. Flat
  entries win on collision (scanned first); the second instance is
  recorded as a `duplicate-run-id` failure for producer-side debugging.
- **I7 (Opus Info-1)** Metrics catalog `description` + `aggregation`
  strings updated to reflect the round-2 W2 receiver-filter AND the
  round-3 C3 initiating-handoff denominator. `null_when` clarified.
- **I8 (Opus Info-2)** `Object.freeze(new Set(...))` is a no-op for Set
  mutation methods. Dropped the freeze with a comment explaining the
  convention; `const` reference alone is sufficient.
- **I9 (Opus Info-3)** Added a symlinked-SUBDIR rejection test (sibling
  to the round-2 symlinked-FILE test) — same defense, different attack
  vector.
- **I10 (Opus Info-4)** Broken-symlink test comment clarified — rejection
  happens at the `pathExists` short-circuit, not the realpath check.
  Added explicit `failures.length === 0` assertion.

Test count: 209 → 214 (+5 net: 3 new C3 tests for multi-ack, new-task-via-reverse,
all-continuations-degenerate; 1 W4 dedup test; 1 I9 symlinked-subdir test;
2 existing tests updated for the new C3 semantic).

### Added
- **`lib/suite-constants.js`** — `EXPECTED_SOURCES` extended with two envelope
  tuples (`deep-work / handoff` and `deep-work / compaction-state`), bringing
  the dashboard's `missing_signal_ratio` denominator from 11 → 13.
  `PAYLOAD_REQUIRED_FIELDS` gains 1:1 mirrors of each schema's `required[]`:
  - `deep-work/handoff`: `schema_version`, `handoff_kind`, `from`, `to`,
    `summary`, `next_action_brief`.
  - `deep-work/compaction-state`: `schema_version`, `compacted_at`, `trigger`,
    `preserved_artifact_paths`.
- **`lib/suite-collector.js`** — Two new `SOURCE_SPECS` entries scanning
  `.deep-work/handoffs/*.json` and `.deep-work/compaction-states/*.json`
  with `cardinality: 'dir'` (mirrors the existing `.deep-work/receipts/`
  flat-dir pattern for slice receipts).
- **`lib/aggregator.js`** — Three new compute functions:
  - `computeCompactionFrequency`: total compaction-state envelope count;
    `source_summary` surfaces `unique_sessions` for per-session drill-down.
  - `computeCompactionPreservedArtifactRatio`: mean per-envelope ratio
    `preserved / (preserved + discarded)`. Per
    `claude-deep-suite/guides/context-management.md` §5: envelopes that omit
    `discarded_artifact_paths` contribute UNDEFINED (excluded from the mean),
    and empty-preserved + empty-discarded (full-reset) is also excluded.
  - `computeHandoffRoundtripSuccessRate`: per
    `claude-deep-suite/guides/long-run-handoff.md` §7 — a handoff round-trips
    when any non-aggregator envelope's `parent_run_id` chains back to the
    handoff's `run_id`. Covers reverse-handoff and downstream-receipt cases.
- **`lib/metrics-catalog.yaml`** — The 3 M5-activated entries moved from the
  M4-deferred block to a new "M5-activated" block, each carrying the new
  source path + schema_id pointing at the suite-repo M5 schemas.
- **`test/fixtures/{handoff,compaction-state}.fixture.json`** — Canonical
  envelope-wrapped fixtures mirroring the M5 schemas; consumed by the
  end-to-end activation test in `lib/aggregator.test.js`.
- 16 new tests (across `suite-constants.test.js`, `suite-collector.test.js`,
  `aggregator.test.js`) covering EXPECTED_SOURCES extension, payload required
  field rejection paths, per-metric formula correctness (frequency / preserved
  ratio / roundtrip rate), undefined-when-discarded path, full-reset path,
  reverse-handoff path, and fixture-driven end-to-end populate.

### Changed
- **`plugin.json.version`** + **`package.json.version`** bumped 1.3.0 → 1.3.1.
- **`lib/suite-formatter.js`** — Section count headers (`## M4-core metrics (N)`,
  `## M4-deferred metrics (N)`) now derive `N` from the snapshot rather than
  a literal, so the next milestone's activation lands without re-editing
  hard-coded strings. Sub-heading text simplified from "M5 / M5.5" to "M5.5"
  to reflect post-activation state.
- **`lib/aggregator.js`** — `M4_DEFERRED_METRICS` constant trimmed from 4
  entries to 1 (`suite.tests.coverage_per_plugin`, M5.5). The 3 M5-gated
  metrics now route through real compute functions; their tier flipped to
  `M4-core`. `missing_signal_ratio` source_summary's `expected_total`
  updated 11 → 13.

### Backward-compatibility notes
- Snapshot JSONL shape unchanged: the same 16 metric IDs appear in every
  snapshot. The 3 newly-activated metrics' `tier` field changes from
  `M4-deferred` to `M4-core` and the `deferred_until` field is dropped on
  those entries — old JSONL records continue to parse cleanly via the
  formatter's tier-based switch.
- Producer-side adoption is independent: until a plugin actually writes
  `handoff.json` / `compaction-state.json`, the 3 activated metrics emit
  `value: null` (greenfield path). Existing consumers see no value-shape
  change.

### Migration notes
- Plugins that want their compaction or handoff events surfaced on the
  dashboard SHOULD emit envelope-wrapped artifacts under
  `.deep-work/handoffs/*.json` (artifact_kind = "handoff", schema.name =
  "handoff", schema.version = "1.0") and `.deep-work/compaction-states/*.json`
  (artifact_kind = "compaction-state", schema.name = "compaction-state",
  schema.version = "1.0"). The producer-side adoption ledger is tracked in
  the suite repo's `docs/envelope-migration.md` §6.

---

## [1.3.0] — 2026-05-11 — M4 Suite Telemetry Aggregator

Closes M4 milestone (cf. `claude-deep-suite/docs/deep-suite-harness-roadmap.md` §M4). 16 suite-level metrics, time-series JSONL accumulation, markdown trend report, optional OTLP exporter, and a deliberate "HOLD" decision on plugin monitors (revisit in M4.5).

This release rolls up three PRs:
- PR 1 #5 — `lib/metrics-catalog.yaml` + `lib/suite-collector.js` + `lib/suite-constants.js`.
- PR 2 #6 — `lib/aggregator.js` + `lib/suite-formatter.js`.
- PR 3 #7 — `lib/otel.js` + `docs/monitor-decision.md` + version bump + README/skill docs.

### Added (PR 3/3 — §4.5 + §4.6 + §4.7)
- **`lib/otel.js`** — Optional OTLP/HTTP-JSON exporter. Activates only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; no-op otherwise (default M4 output path remains JSONL + markdown). Posts each non-null M4-core numeric metric as a gauge data point. Distribution metric `suite.review.verdict_mix` fans out into three gauges. M4-deferred metrics (null) skipped. Failures non-fatal — returns `{ exported: false, reason }`. Zero new dependency — uses `globalThis.fetch` + OTLP/HTTP-JSON body shape. Resource attributes: `service.name=deep-dashboard`, `suite.snapshot.run_id`, `suite.project_root`.
- **`docs/monitor-decision.md`** — Plugin monitors spike decision (M4 §4.6): **HOLD until M4.5**. Spike evaluated 3 acceptance gates (threshold defensibility, cross-platform reliability, notification-fatigue posture). Gate 1 FAIL — no baseline data to set defensible thresholds. Re-evaluation by 2026-08-11 (T+0 + 3 months) after `suite-metrics.jsonl` accumulates 4+ weeks of history.
- 17 new tests (`lib/otel.test.js`) covering: endpoint resolution (with/without `/v1/metrics` suffix, trailing slash) + header parsing (key=value, malformed, empty) + OTLP payload shape (gauge fan-out for distribution + skip rules for M4-deferred and null + timeUnixNano encoding + resource attributes) + env-gated no-op (unset/empty) + injectable fetcher + http-status / network-error / fetch-unavailable failure paths.

### Changed (PR 3/3)
- **`plugin.json.version`** bumped 1.2.0 → 1.3.0.
- **`package.json.version`** bumped 1.2.0 → 1.3.0.
- **`skills/deep-harness-dashboard.md`** — added `--suite` mode steps + 11-source table for suite telemetry path. Frontmatter description mentions M4.
- **`README.md` + `README.ko.md`** — capability list expanded from 2 → 3, calling out M4 Suite Telemetry.
- **`.gitignore`** — pattern changed from `docs/` to `docs/*` with `!docs/monitor-decision.md` exception so the decision record ships with the plugin while local plans remain ignored.

### Migration notes (PR 3/3)
- Consumers wanting OTLP export only need to set `OTEL_EXPORTER_OTLP_ENDPOINT` (and optionally `OTEL_EXPORTER_OTLP_HEADERS=key=value,...`); no code change required.
- Aggregator + formatter API surface stable since PR 2. PR 3 only adds `lib/otel.js` and documentation.
- `package.json.version` is bumped in lockstep with `plugin.json` for local `npm` tooling consistency only — **`plugin.json.version` remains the single source of truth** per CLAUDE.md convention.

### Round 1 review polish (PR #7 — 1-way Opus, Codex tokens expired mid-session)

3 cheap improvements applied; remaining warnings/info documented:

- **W3 (cheap)**: `parseHeaders` now has a regression test asserting embedded `=` characters in values (base64 tokens ending `==`) round-trip correctly. Behavior was already correct via `indexOf('=')` + `slice(eq+1)`; the test locks it in.
- **W4 (UX)**: `exportSnapshot` now validates `OTEL_EXPORTER_OTLP_ENDPOINT` starts with `http://` or `https://` and returns `{ exported: false, reason: 'invalid-endpoint-scheme', endpoint: <raw> }` instead of letting fetch throw an opaque "Invalid URL". Catches the common typo of forgetting the scheme prefix.
- **W5 (shape consistency)**: All return paths now include the `endpoint` field (set to `null` for no-endpoint / fetch-unavailable cases). Eliminates the prior shape variance where callers had to defensively check `result.endpoint?.startsWith(...)`.

Accepted as-documented (no code change):
- **W1**: each metric carries one data point per snapshot (one-tick exporter). Acceptable for the M4 use case; documented in the module-level comment.
- **W2**: `parseHeaders` does NOT URL-decode `%2C` etc. Per the documented contract ("comma-separated `key=value`"), the implementation is honest. Full W3C-style URL-decoding is a M5 candidate if real OTel deployments need it.

Deferred (per anti-oscillation §4):
- I1 double-slash endpoint tolerance — low priority.
- I3 monitor decision: Gate 1 FAIL alone is dispositive (Gates 2–3 are downstream contingencies) — wording-only nit.
- I5–I6 integration test against real collector + concurrent / large payload tests — M5 candidate.

Tests: 169 → 172 (+3 polish regression tests). All pass.



## [Unreleased] — M4 Suite Telemetry Aggregator (PR 2/3)

### Added
- **`lib/aggregator.js`** — Suite metric aggregator. Consumes `collectSuite()` output and emits all 16 metrics from `lib/metrics-catalog.yaml`: 12 M4-core (computed) + 4 M4-deferred (`null` with `deferred_until: M5` / `M5.5` marker). Each metric carries `{ value, unit, tier, source_summary }`. `appendSnapshot()` writes to append-only `.deep-dashboard/suite-metrics.jsonl`; `readRecentSnapshots(n)` returns the latest N records skipping malformed lines.
- **`lib/suite-formatter.js`** — Markdown renderer for `.deep-dashboard/suite-report.md`. Compares current snapshot against the previous JSONL record and emits trend arrows (↑/↓/→) per metric. Distribution metrics (e.g., `verdict_mix`) render as compact `{ key=n, ... }` literals; trend falls back to `?` on shape divergence.
- Verdict parser for `.deep-review/reports/*-review.md` — scans for the `**Verdict**:` line and counts APPROVE / CONCERN / REQUEST_CHANGES tokens. Severity precedence on ambiguity: `REQUEST_CHANGES > CONCERN > APPROVE`.
- 38 new tests (`lib/aggregator.test.js` × 20, `lib/suite-formatter.test.js` × 18) covering: all 16 metric emission + greenfield-null contract + per-metric correctness (block_rate / error_rate / freshness / integrate_accept / verdict_mix / recurring_findings / wiki_ingest / docs_auto_fix / evolve_q_delta) + division-by-zero guards + JSONL append-only round-trip + malformed-line skip + trend arrows (numeric ↑/↓/→ + distribution deep-equal + null-handling) + ratio/seconds/count/numeric formatting + markdown rendering (sections, deferred-until display, pipe-escaping) + file overwrite idempotency.

### Migration notes
- `plugin.json.version` still 1.2.0; final bump to 1.3.0 in PR 3.

### Round 1 review fixes (PR #6 — 3-way Opus + Codex review + Codex adversarial)

8 findings, all addressed:

- **3-way agreement (🔴 1)**: `computeBlockRate` / `computeErrorRate` denominators included non-hook NDJSON events from the deep-wiki vault `log.jsonl` (`kind === 'log'`, carries wiki ingest events). A busy wiki log would dilute hook rates to near-zero. Filter added: only `kind === 'hook-log'` sources contribute. Two regression tests with 200/100 wiki events + 2 hook events confirm the wiki noise is excluded.
- **Opus W1 🟡**: `parseVerdictFromMarkdown` substring poisoning — `**Verdict**: APPROVE — no CONCERN raised` previously returned `CONCERN`. Rewrote as a 3-tier scanner: (1) leading-anchored regex `^<TOKEN>\b` against the verdict-line tail (handles markdown emphasis `**APPROVE**`, italics `*APPROVE*`, backticks `\`APPROVE\``), (2) severity-ordered word-boundaried scan inside the verdict line (handles table-cell verdicts), (3) whole-doc fallback. Three regression tests for prose distractors + emphasis markers.
- **Opus W2 🟡**: `trendArrow` collapsed "stable" and "regressed to unknown" into `→`. New arrow vocabulary: `↑` / `↓` / `→` (equal) / `·` (no baseline) / `?` (asymmetric null OR distribution shape divergence). Tests updated.
- **Opus W3 🟡**: `appendSnapshot` docstring honest about `O_APPEND` atomicity boundary (`PIPE_BUF` ≈ 4 KiB) and rotation absence. Cross-process advisory locking + rotation knob deferred to M5 backlog. No code change — the docstring update is the fix.
- **Opus W4 🟡**: `metrics-catalog.yaml` `suite.review.verdict_mix` listed `recurring-findings` as a 2nd source but the aggregator never consumed it — catalog drift. Removed the unused source entry; aggregation description now reflects the actual leading-anchored token parser.
- **Opus I5 ℹ️**: `metrics-catalog.yaml` `suite.wiki.auto_ingest_candidates_total.null_when` previously said "no matching events" → null. Implementation returns `0` (count semantics — file scanned, 0 matches). Catalog now matches: "missing or unreadable" only.
- **Opus I6 ℹ️**: `computeDocsAutoFixAcceptRate` + `computeEvolveQDelta` `envelopes[0]` access annotated with explicit single-cardinality contract comment, calling out the sort-by-generated_at-desc evolution path if collector ever emits multi-envelope.
- **Opus I7 ℹ️**: `metrics-catalog.yaml` `suite.evolve.q_delta_per_epoch` aggregation formula previously said `max(epochs, 1)` (never-null) but impl returns `null` when `epochs ≤ 0`. Catalog now matches impl with reasoning ("avoids implying a per-epoch delta exists when no epochs ran").

Deferred (out-of-scope per anti-oscillation §4):
- I8 cosmetic (`renderValue` integer-floored seconds, harmless fractional handling).
- I9 test gaps — concurrent appendSnapshot, unicode source_summary, very-large JSONL (>1 MB). M5 candidate.

Tests: 145 → 150 (+5 Round 1 regression tests). All pass.

## [Unreleased] — M4 Suite Telemetry Aggregator (PR 1/3)

### Added
- **`lib/metrics-catalog.yaml`** — Authoritative catalog of the 16 suite-level metrics defined in `claude-deep-suite/docs/deep-suite-harness-roadmap.md` §M4. 12 M4-core metrics activate immediately; 4 M4-deferred metrics carry `deferred_until: M5` / `M5.5` markers and emit `null` until source artifacts land.
- **`lib/suite-collector.js`** — Envelope-aware reader covering four sources the legacy `lib/dashboard/collector.js` does not consume: `deep-review/recurring-findings`, `deep-evolve/evolve-insights`, `deep-wiki/index` (external `<wiki_root>/.wiki-meta/index.json` per deep-wiki layout, resolved via `options.wikiRoot` argument, `DEEP_WIKI_ROOT` env var, or project-local fallback), and NDJSON event logs: 2 hook logs (`.deep-work/hooks.log.jsonl`, `.deep-evolve/hooks.log.jsonl`) + deep-wiki vault event log (`<wiki_root>/log.jsonl`, root-level — not under `.wiki-meta/`). Performs `parent_run_id` chain reconstruction with aggregator-pattern envelopes (`harnessability-report`, `evolve-insights`, `index`) excluded both as chain children AND as chain parents per their schema-documented contract.
- **`lib/suite-constants.js`** — Single-point-of-truth for the 6-month legacy fallback timer (`T+0 = 2026-05-07`, `T+0+6mo = 2026-11-07T00:00:00Z` **exclusive cutoff**), per-plugin envelope adoption ledger (mirrors `claude-deep-suite/docs/envelope-migration.md` §6.1), `EXPECTED_SOURCES` (11 entries: 8 envelope + 3 NDJSON), and `PAYLOAD_REQUIRED_FIELDS` (per-kind required-key list mirroring authoritative payload schemas). `legacyFallbackExpired(nowIso)` helper.
- 29 new tests (`lib/suite-collector.test.js` × 21, `lib/suite-constants.test.js` × 8) covering envelope unwrap + identity-guard rejection + payload-shape-violation rejection + **payload required-field check** (empty `{}` rejected, partial-shape rejected with field-list) + chain reconstruction (resolved / unresolved / aggregator-excluded-as-child / **aggregator-excluded-as-parent** / **non-string run_id rejected**) + missing-signal-ratio (envelope + NDJSON denominator) + NDJSON hook log parsing (malformed-line skip) + **readJsonDir parse-failure propagation** + `wikiRoot` option / `DEEP_WIKI_ROOT` env / project-local fallback + **legacy `<wiki_root>/index.json` location rejection** + bidirectional SOURCE_SPECS ↔ EXPECTED_SOURCES alignment + 6-month timer **exclusive-cutoff** boundary dates + PAYLOAD_REQUIRED_FIELDS coverage.

### Changed
- **`package.json` `test` script** quote-wrapped to `node --test "lib/**/*.test.js"` so node handles glob expansion (previously `sh` flat-globbing missed `lib/*.test.js` top-level entries — silent test-file drop).

### Round 1 review fixes (PR #5 — 3-way Opus + Codex review + Codex adversarial)

11 findings, all addressed in this PR before merge:

- **3-way agreement (🔴 1)**: `readJsonDir` silently dropped malformed JSON inside `.deep-work/receipts/` and similar dir-cardinality sources, undercounting `schema_failures_total`. Now propagates `unparseable-json` / `directory-unreadable` / `broken-symlink` / `out-of-boundary-symlink` failures with absolute paths.
- **Codex P2 × 2 (🔴 2)**: External wiki paths corrected per deep-wiki storage layout (`skills/wiki-schema/wiki-schema.yaml`): `index.json` resolves to `<wiki_root>/.wiki-meta/index.json` (was `<wiki_root>/index.json` — never existed) and `log.jsonl` resolves to `<wiki_root>/log.jsonl` (was `<wiki_root>/.wiki-meta/log.jsonl` — never existed). The asymmetry is intentional: `.wiki-meta/` is hidden from Obsidian's graph view while `log.jsonl` stays scriptable at vault root.
- **Codex adversarial HIGH (🔴 2)**:
  1. `missing_signal_ratio` denominator expanded from 8 to 11 entries — hook logs (deep-work, deep-evolve) and deep-wiki vault log now count toward the ratio. A project missing all hook logs no longer reports `0` missing signals behind a healthy envelope-only ratio.
  2. Payload-required-field validation layer added: empty `{}` payloads (and partial-shape payloads missing any required key per producer schema) are rejected with `missing-required-fields:<csv>` and flow into `schema_failures_total`. Zero-dep, mirrors `scripts/validate-envelope-emit.js` precedent; full ajv-style schema-runtime validation is a M5 candidate.
- **Opus warnings (🟡 5)**:
  - W1 — Aggregator-pattern envelopes (`harnessability-report`, `evolve-insights`, `index`) now excluded from `byRunId` map in `reconstructChains`, so they cannot serve as chain parents (previously asymmetric: excluded as children, eligible as parents — silently inflating completeness).
  - W2 — `run_id` indexing tightened from truthy-check to `typeof === 'string' && length > 0`. Malformed envelopes with `run_id = {nested: true}` or `[]` can no longer pollute the parent map.
  - W3 — 6-month timer comment rewritten with explicit exclusive-cutoff semantics + boundary table (2026-11-06T23:59:59Z → false, 2026-11-07T00:00:00Z → false, 2026-11-07T00:00:01Z → true).
  - W4 — `cardinality: 'dir'` failure modes (permission errors, missing dir) distinguished via new `failures: [{path, reason}]` channel from `readJsonDir`.
  - W5 — NDJSON stream IO error handler attached; `readNdjson` now returns `{events, missing, error}` so caller can distinguish "file absent" vs "read failed mid-stream".
- **Opus info (ℹ️ 2)**:
  - I6 — `TODO(M5): consolidate envelope unwrap into lib/envelope-unwrap.js` comment added near the duplicated `isEnvelopeShape` / `unwrapStrict`.
  - I7 — `SOURCE_SPECS ↔ EXPECTED_SOURCES` coverage test inverted to bidirectional containment (previously tautological — would have passed even if `SOURCE_SPECS` silently dropped a tuple).

Deferred (scope-resolved per anti-oscillation §4, mirror M3 Phase 3 INFO-2~5):
- Full JSON Schema runtime validation (ajv) — M5 candidate.
- `metrics-catalog.yaml` schema/linter — PR 3 candidate.
- Cached env-var reads — minor, deferred.
- `deep-review` review-report markdown frontmatter parsing — PR 2 (formatter introduces verdict_mix computation).

### Migration notes
- M4 collector is a CONSUMER. No producer-side breaking changes in PR 1; downstream PRs (PR 2 aggregator + PR 3 OTel/monitor) build on this foundation.
- `plugin.json.version` stays at 1.2.0 until the final M4 PR (3/3) merges; the suite repo `marketplace.json` SHA bump follows that final merge in a separate suite-repo PR.

## [1.2.0] — 2026-05-07

### Changed
- **`.deep-dashboard/harnessability-report.json` now wraps in the claude-deep-suite M3 cross-plugin envelope** (`docs/envelope-migration.md`). Top-level `schema_version: "1.0"` + `envelope` block (`producer = "deep-dashboard"`, `producer_version`, `artifact_kind = "harnessability-report"`, `run_id` ULID, `generated_at` RFC 3339, `schema { name, version }`, `git { head, branch, dirty }`, `provenance { source_artifacts, tool_versions }`) + `payload` (`total`, `grade`, `dimensions`, `recommendations`, `topology`, `topology_hints`, `projectRoot`).
- **`scorer.js` CLI** prints the envelope JSON on stdout (was: the unwrapped result). Disk file matches stdout. Domain data lives at `.payload.*` — adjust any inline consumers accordingly.
- **`scorer.js` `saveReport()`** return shape changed from `string` (path) to `{ path, envelope }` so callers can forward the envelope without re-reading the file.
- **`collector.js` is now M3 envelope-aware**. For each artifact it consumes, it detects the envelope wrapper (strict `schema_version === "1.0"` + `envelope` + `payload` triple), enforces identity guards (producer / artifact_kind / schema.name), and unwraps the inner `payload` for downstream consumers (effectiveness scorer, formatter). Identity-mismatched envelopes resolve to `null` with a stderr warning (defense-in-depth — handoff §4 round-4 lesson).
- Envelope-aware paths: `.deep-docs/last-scan.json`, `.deep-dashboard/harnessability-report.json`, `.deep-work/session-receipt.json`, `.deep-work/receipts/*.json`, `.deep-evolve/evolve-receipt.json`. `.deep-review/fitness.json` and `.deep-review/receipts/*.json` remain legacy reads — deep-review's M3 artifact is `recurring-findings.json`, which the dashboard does not currently consume.

### Added
- `scripts/validate-envelope-emit.js` — zero-dep envelope contract self-test mirroring suite spec (`additionalProperties: false`, ULID/SemVer 2.0.0 strict / kebab-case / RFC 3339 regex, identity check, payload shape minimal).
- `tests/fixtures/sample-harnessability-report.json` — envelope-wrapped sample emit (also serves as the Phase 3 input for `claude-deep-suite/schemas/payload-registry/deep-dashboard/harnessability-report/v1.0.schema.json` placeholder → authoritative replacement).
- `npm run validate:envelope` script (zero-dep node).
- 11 new collector tests covering envelope unwrap (deep-docs, self, deep-work session/slice, deep-evolve), identity-guard rejection (wrong producer, wrong kind, schema.name drift), legacy pass-through (mixed pre/post-envelope coexistence, numeric `schema_version: 2`).

### Migration notes
- Internal **breaking change** to `harnessability-report.json` shape. External readers that parsed `report.total` directly (instead of `report.payload.total`) must migrate. The 24-hour-stale rule from `skills/deep-harnessability.md` provides natural invalidation — old readers will simply re-run.
- Known cross-plugin consumer: `deep-work` Phase 1 Research consumes `harnessability-report.json` (handoff §3.3 chain). Its envelope-aware read will land in deep-work's Phase 2 PR (priority #3).
- Per claude-deep-suite handoff §1: this PR modifies plugin repo only. `marketplace.json` SHA bump and `payload-registry/deep-dashboard/harnessability-report/v1.0.schema.json` placeholder → authoritative replacement land in suite repo's Phase 3 batch PR.
- claude-deep-suite Phase 2 Adoption ledger (`docs/envelope-migration.md` §6.1) priority #2.

## [1.1.1] — 2026-04-17

Patch release addressing defects surfaced by the 2026-04-17 ultrareview of v1.1.0 and follow-up polish.

### Fixed
- **`scorer.js` `isTypeScript`** no longer triggers on plain `package.json`; TS-only checks are only applied when a `tsconfig.json` exists. Pure JS and Python-with-frontend projects are no longer penalized.
- **`scorer.js` recommendations** skip `not_applicable` checks — no more cross-ecosystem noise (e.g., "enable Python type hints" on TS projects).
- **`scorer.js` CLI entry** added. Previously the skill command `node scorer.js <project>` exited silently with no output; now it emits JSON and writes `.deep-dashboard/harnessability-report.json` as the skill promised.
- **`formatter.js` undefined guards** across `centerLine`, `renderHealth`, `renderActions`; `pad()` and `stripAnsi()` helpers also coerce input defensively so future callers can't reintroduce the crash path.
- **`formatter.js` NaN handling**: `q_trajectory` entries that are `NaN` render as `?` instead of the literal string `NaN`.
- **`formatter.js` Markdown tables**: new `escapePipe` helper escapes `|` characters in every interpolated cell (Health, Fitness, Sessions, Evolve). Session sensors, transfer IDs, and finding strings can no longer corrupt table structure.
- **`collector.js` `readJsonDir`** safely follows symlinks within the scanned directory. Uses `fs.realpathSync` + `path.relative` containment instead of a naïve `startsWith` prefix check, blocking both out-of-tree ingestion and sibling-prefix bypass (`.deep-work/receipts-old/` can no longer sneak past a `.deep-work/receipts` scan). Broken and out-of-boundary symlinks skip with a visible warning.
- **`action-router.js` runtime strings** translated to English (keep-rate, crash-rate, stale-receipt, no-transfer `detail` fields were partially Korean from the phase-3 integration).

### Changed
- **`README` effectiveness table** corrected to 5 weighted dimensions summing to 100%: Health 25% / Fitness 20% / Session 20% / Harnessability 15% / Evolve 20%. Earlier the table showed 4 rows with incorrect weights (30/25/25/20).
- **`README` architecture diagram** now shows `deep-evolve` as a fourth input source.
- **`README` evolve section**: Korean fragments translated in the English README; `evolve-low-q` rule described precisely as "earliest of last-3 `q_trajectory` values more than 0.05 above the most recent"; `transfer.received_from` schema documented as `non-empty string | null`.
- **`skills/deep-harnessability.md`** uses `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` (documented Claude Code env vars) instead of unresolved `PLUGIN_DIR` / `PROJECT_ROOT` literals.
- **`action-router.test.js`** pins strict-exclusive threshold behavior (`keep_rate < 0.15`, `crash_rate > 0.20`) so a future refactor cannot silently flip the sign.
- **`.claude-plugin/plugin.json`** was stale at 1.0.0 — bumped to match `package.json`.

### Notes
- Ultrareview M1 (`evolve-no-transfer` on falsy `received_from`) closed as won't-fix: the documented schema rules out `0` and `""`, making the reported case unreachable.
- Test count: 45 → 58 (+13 regression tests across scorer, formatter, action-router, collector).

## [1.1.0] — 2026-04-14

### Added
- **Cross-plugin feedback (Phase 3B):**
  - `collectDeepEvolve()` in collector for evolve-receipt.json consumption
  - `evolve` dimension (weight 0.20) in effectiveness scorer with weight redistribution
  - `extractEvolveFindings()` with 5 detection rules (low-keep, high-crash, low-q, stale, no-transfer)
  - `evolve-low-q`: fires when the earliest of the last-3 `q_trajectory` values is more than 0.05 above the most recent value (i.e., the recent 3-point window is trending down).
  - Evolve section in CLI and Markdown formatter output
  - `action-router.test.js` (new test file)
  - Contract test fixtures for cross-plugin schema validation

## 1.0.0 (2026-04-09)

### Features
- Harnessability Diagnosis: 6-dimension scoring engine with 17 computational detectors
- Unified Dashboard: cross-plugin data aggregation with effectiveness scoring
- Action routing: suggested_action per finding type
- CLI table + markdown report output
- /deep-harnessability and /deep-harness-dashboard skills

### Architecture
- Ecosystem-aware type_safety scoring (TS/Python not_applicable handling)
- Last 3 sessions effectiveness averaging
- generated_at timestamp for staleness checking
- Deep merge support for custom topologies
