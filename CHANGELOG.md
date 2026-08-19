**English** | [한국어](./CHANGELOG.ko.md)

# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] — 2026-07-27 (context diet per Claude 5 context-engineering rules)

### Changed

- Claude Code and Codex now read one shared project guide instead of two copies that could drift apart.
- Both skill guides are substantially shorter, leaving more of the session context window for the user's own work.
- Both skill descriptions are half their previous length, with every English and Korean trigger phrase preserved verbatim.

### Fixed

- The documented dimension score formula now matches the 0–10 score the scorer actually reports.
- Harnessability dimension weights are documented as never redistributed, so a dimension with no applicable checks costs its full weight by design; the separate effectiveness score remains the documented exception that does redistribute.
- Suite mode is documented as reading 15 sources, matching what it collects.
- The 24-hour freshness rule is documented as this plugin's own behaviour; deep-work reads the report under its own, longer staleness window.
- Envelope-reading rules are documented per reader, so the stricter suite-mode validation is no longer attributed to the legacy dashboard.

## [1.5.0] — 2026-07-10 (native Codex and Windows support)

### Added

- Native Windows 11 support joins macOS and Linux under the same Node.js 22 release contract, including isolated Codex marketplace installation.
- Codex users can install and discover both dashboard skills through the Deep Suite marketplace.

### Changed

- Skill execution now derives absolute script paths from the host-loaded skill file, keeping Claude Code and Codex routing shell-neutral.
- Symlink-dependent security checks skip only when host privilege is unavailable while retaining their assertions on capable hosts.

## [1.4.0] — 2026-07-07 (honest wiki metrics + session effectiveness revival)

### Added

- `ingest_actions_total` — a new wiki metric that counts actual ingest actions, the honest signal that replaces the misleading `auto_ingest_candidates_total`.
- Effectiveness reports a **session** dimension again, reconstructed from a union over emitted `session-receipt` artifacts.

### Changed

- `auto_ingest_candidates_total` is **deprecated** — it counted candidates rather than performed actions, overstating activity. It is retained one release for back-compat and superseded by `ingest_actions_total`.

### Fixed

- Payload `schema.version` MAJOR is now guarded at both unwrap seams, so a future incompatible payload MAJOR is rejected instead of silently mis-parsed.
- `wiki-index` project-local fallback path was missing the `.wiki-meta` segment; the fallback now resolves the correct location.

## [1.3.7] — 2026-05-18 (Codex skill directory layout)

### Changed

- Moved Codex skill surfaces to `skills/<skill>/SKILL.md` directories so Codex can discover `deep-harnessability` and `deep-harness-dashboard` from the manifest's `"skills": "./skills/"` root.

## [1.3.6] — 2026-05-18 (Codex-native plugin manifest and AGENTS guide)

### Added

- `.codex-plugin/plugin.json` — Codex-native plugin manifest pointing at the same skill and hook surfaces as the Claude Code manifest.
- `AGENTS.md` — Codex project guide covering runtime surfaces and verification commands.

### Changed

- README now documents Codex compatibility alongside the Claude Code surface.

## [1.3.5] — 2026-05-16 (catalog-drift horizon mechanism)

### Changed

- Catalog-drift checker no longer fails when the suite catalog grows beyond the dashboard's tracked scope: the heading is treated as a table anchor, and suite-side rows whose id exceeds the manifest horizon are reported as info (exit 0) instead of drift. Within-horizon drift still fails the check.

### Fixed

- `test` script switched to `node --test $(find lib -name '*.test.js')` for portable test-file enumeration across bash and zsh (the previous `**` glob silently dropped test files on CI).

## [1.3.4] — 2026-05-12 (cross-plugin roundtrip guard)

### Added

- Consumer-side end-to-end test driving the suite's canonical 4-artifact handoff fixture set through the aggregator's M5 compute functions, pinning expected metric values (`compaction.frequency`, `compaction.preserved_artifact_ratio`, `handoff.roundtrip_success_rate`) so a silent provider-side change surfaces as a test failure.

## [1.3.3] — 2026-05-12 (post-review cleanup)

### Added

- Catalog-drift checker (`scripts/check-catalog-drift.js` + `npm run check:catalog-drift`) comparing the local test-catalog manifest against the suite-repo source of truth, resolved via `--suite-path=`, `SUITE_REPO_LOCAL`, or `gh api` fallback.
- First GitHub Actions workflow (`catalog-drift-check.yml`) running the drift checker on PR, push to main, and a daily cron.

### Changed

- Hoisted the known-suite-plugins catalog into `lib/suite-constants.js` as a single source of truth (previously duplicated).

### Migration

- Envelope schema unchanged. Consumers using strict equality on `producer_version` must bump 1.3.2 → 1.3.3.

## [1.3.2] — 2026-05-12 (M5.5: per-plugin test coverage)

Activates the final deferred metric. With this release all 16 metrics in the catalog are M4-core.

### Added

- `suite.tests.coverage_per_plugin` metric — emits a per-plugin distribution of `{ covered, expected, ratio, tests }` against the standard test catalog. Non-participating plugins are omitted from the value map and surfaced via `source_summary.plugins_unparticipating`.
- `lib/test-catalog-manifest.json` — dashboard-internal source of truth for the metric, kept in lockstep with the suite-repo catalog.

### Changed

- `suite.tests.coverage_per_plugin` promoted from M4-deferred to M4-core; unit changed from `ratio` to `distribution` with a per-plugin participation-aware formula.
- Distribution renderer now prints per-plugin ratio cells inline; the empty M4-deferred section is omitted from the report.

### Fixed

- Sample harnessability-report fixture `producer_version` bumped to match `plugin.json.version` (was stale since the M3 envelope adoption).

### Migration

- No producer-plugin change required — the new metric is dashboard-internal.

## [1.3.1] — 2026-05-11 (M5: handoff + compaction-state metrics)

Activates 3 of the 4 deferred metrics now that the suite's `handoff` and `compaction-state` payload schemas are ratified. Backward-compatible additions only.

### Added

- Three new compute functions: `computeCompactionFrequency` (total compaction-state envelope count), `computeCompactionPreservedArtifactRatio` (mean per-envelope preserved-vs-discarded ratio, excluding undefined-discarded and full-reset cases), and `computeHandoffRoundtripSuccessRate` (a handoff round-trips when a receiver-produced envelope's `parent_run_id` chains back to it).
- `EXPECTED_SOURCES` extended to 15 entries, adding `deep-evolve/handoff` and `deep-evolve/compaction-state` (deep-evolve emits reverse handoffs and epoch-boundary compaction-state), with `PAYLOAD_REQUIRED_FIELDS` mirrors of each schema's required keys.
- New collector cardinality scanning both the flat aggregation dir and per-session subdir for each `(producer, kind)` source.
- Canonical envelope-wrapped fixtures for handoff and compaction-state, consumed by an end-to-end activation test.

### Changed

- The 3 M5-activated metrics moved from the M4-deferred block to M4-core, each pointing at the suite-repo M5 schemas.
- Section-count headers in the report derive their count from the snapshot instead of a literal.
- Roundtrip denominator counts only initiating handoffs (a reverse handoff is the receiver's success signal, not a fresh handoff), so the canonical forward+reverse happy path reports `1.0`.
- Roundtrip counting enforces receiver semantics — a child must satisfy both `parent_run_id === handoff.run_id` and `producer === handoff.payload.to.producer`.

### Fixed

- Symlink containment in per-session glob reads now mirrors the directory reader's realpath boundary check; out-of-boundary symlinks are rejected while in-tree atomic-swap symlinks are honored.
- Merged flat + per-session entries are deduplicated by `run_id` so a double-written envelope no longer inflates frequency, the roundtrip denominator, or the chain index.

### Compatibility

- Snapshot JSONL shape unchanged: the same 16 metric IDs appear in every snapshot. Until a plugin actually emits `handoff.json` / `compaction-state.json`, the 3 activated metrics emit `value: null`.

### Migration

- Plugins that want compaction or handoff events on the dashboard should emit envelope-wrapped artifacts under `.deep-work/handoffs/*.json` (`artifact_kind: "handoff"`) and `.deep-work/compaction-states/*.json` (`artifact_kind: "compaction-state"`), both at `schema.version: "1.0"`.

## [1.3.0] — 2026-05-11 (M4 Suite Telemetry Aggregator)

Closes the M4 milestone: 16 suite-level metrics, time-series JSONL accumulation, a markdown trend report, an optional OTLP exporter, and a deliberate HOLD decision on plugin monitors (revisit in M4.5).

### Added

- `lib/metrics-catalog.yaml` — authoritative catalog of the 16 suite-level metrics (12 M4-core active immediately; 4 deferred to M5 / M5.5, emitting `null` until source artifacts land).
- `lib/suite-collector.js` — envelope-aware reader for sources the legacy collector does not cover (`deep-review/recurring-findings`, `deep-evolve/evolve-insights`, `deep-wiki/index`) plus 3 NDJSON event logs, with `parent_run_id` chain reconstruction that excludes aggregator-pattern envelopes as both children and parents.
- `lib/suite-constants.js` — single source of truth for the 6-month legacy-fallback timer (`T+0 = 2026-05-07`, exclusive cutoff `2026-11-07`), the per-plugin envelope adoption ledger, `EXPECTED_SOURCES`, and `PAYLOAD_REQUIRED_FIELDS`.
- `lib/aggregator.js` — consumes the collector output and emits all 16 metrics, each carrying `{ value, unit, tier, source_summary }`; `appendSnapshot()` writes to append-only `.deep-dashboard/suite-metrics.jsonl` and `readRecentSnapshots(n)` returns the latest records, skipping malformed lines.
- `lib/suite-formatter.js` — renders `.deep-dashboard/suite-report.md`, comparing the current snapshot against the previous record and emitting trend arrows (↑/↓/→/·/?). Distribution metrics render as compact `{ key=n, ... }` literals.
- Verdict parser for `.deep-review/reports/*-review.md` counting APPROVE / CONCERN / REQUEST_CHANGES with severity precedence on ambiguity.
- `lib/otel.js` — optional OTLP/HTTP-JSON exporter, active only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (no-op otherwise). Posts each non-null M4-core numeric metric as a gauge (distribution metrics fan out); failures are non-fatal. Zero new dependency — uses `globalThis.fetch`.
- `docs/monitor-decision.md` — records the M4.5 HOLD decision on plugin monitors (no baseline data yet to set defensible thresholds; re-evaluate after history accumulates).

### Changed

- README capability list expanded from 2 to 3, calling out M4 Suite Telemetry.
- `--suite` mode steps and an 11-source table added to the dashboard skill.

### Fixed

- Hook block/error-rate metrics now only count `hook-log` sources, excluding deep-wiki vault `log.jsonl` ingest events that would otherwise dilute the rates.
- Verdict parser rewritten as a leading-anchored, severity-ordered scanner so prose like `APPROVE — no CONCERN raised` no longer misparses; trend arrows distinguish "stable" (`→`) from "regressed to unknown" (`?`).

### Migration

- For OTLP export, set `OTEL_EXPORTER_OTLP_ENDPOINT` (optionally `OTEL_EXPORTER_OTLP_HEADERS=key=value,...`); no code change required.
- `package.json.version` is bumped in lockstep with `plugin.json` for local tooling only — `plugin.json.version` remains the single source of truth.

## [1.2.0] — 2026-05-07 (M3 cross-plugin envelope)

### Changed

- `.deep-dashboard/harnessability-report.json` now wraps in the deep-suite M3 cross-plugin envelope: top-level `schema_version: "1.0"` + `envelope` block + `payload`. Domain data now lives at `.payload.*` (`total`, `grade`, `dimensions`, `recommendations`, …).
- The scorer CLI prints the envelope JSON on stdout (matching the disk file), and `saveReport()` returns `{ path, envelope }` so callers can forward the envelope without re-reading the file.
- The collector is now M3 envelope-aware: it detects the envelope wrapper, enforces identity guards (producer / artifact_kind / schema.name), and unwraps the inner payload. Legacy un-wrapped artifacts pass through; identity-mismatched envelopes resolve to `null` with a stderr warning.

### Added

- `scripts/validate-envelope-emit.js` + `npm run validate:envelope` — zero-dep envelope contract self-test (ULID / SemVer 2.0.0 / kebab-case / RFC 3339, identity check, payload shape).
- `tests/fixtures/sample-harnessability-report.json` — envelope-wrapped sample emit.

### Migration

- Internal **breaking change** to the `harnessability-report.json` shape: external readers that parsed `report.total` directly must read `report.payload.total`. The 24-hour staleness rule provides natural invalidation.
- Known cross-plugin consumer: deep-work Phase 1 Research consumes this report.

## [1.1.1] — 2026-04-17

Patch release addressing defects surfaced by the v1.1.0 review.

### Fixed

- `isTypeScript` no longer triggers on a plain `package.json`; TS-only checks apply only when `tsconfig.json` exists, so pure-JS and Python-with-frontend projects are no longer penalized.
- Recommendations skip `not_applicable` checks — no more cross-ecosystem noise (e.g. "enable Python type hints" on a TS project).
- Scorer CLI entry added — `node scorer.js <project>` now emits JSON and writes `.deep-dashboard/harnessability-report.json` instead of exiting silently.
- Formatter `undefined`/`NaN` guards added across rendering helpers; `NaN` trajectory entries render as `?`.
- Formatter Markdown tables now escape `|` in every interpolated cell so session sensors, transfer IDs, and finding strings can't corrupt table structure.
- `readJsonDir` follows symlinks only within the scanned directory (realpath containment instead of a prefix check), blocking out-of-tree ingestion and sibling-prefix bypass; broken and out-of-boundary symlinks skip with a warning.
- Action-router runtime strings translated to English.

### Changed

- README effectiveness table corrected to 5 weighted dimensions summing to 100% (Health 25% / Fitness 20% / Session 20% / Harnessability 15% / Evolve 20%); architecture diagram now shows deep-evolve as a fourth input source.
- `skills/deep-harnessability.md` uses the documented `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` env vars instead of unresolved literals.
- `.claude-plugin/plugin.json` version corrected (was stale at 1.0.0).

## [1.1.0] — 2026-04-14

### Added

- Cross-plugin feedback (Phase 3B): deep-evolve receipt consumption via `collectDeepEvolve()`, an `evolve` effectiveness dimension (weight 0.20) with weight redistribution, and `extractEvolveFindings()` with 5 detection rules (low-keep, high-crash, low-q, stale, no-transfer).
- Evolve section in the CLI and Markdown formatter output.
- Contract test fixtures for cross-plugin schema validation.

## [1.0.0] — 2026-04-09

### Added

- Harnessability Diagnosis: 6-dimension scoring engine with 17 computational detectors, with ecosystem-aware Type Safety scoring (TS/Python `not_applicable` handling).
- Unified Dashboard: cross-plugin data aggregation with effectiveness scoring (last-3-sessions averaging) and `generated_at` staleness checking.
- Action routing: a `suggested_action` per finding type.
- CLI table + markdown report output.
- `/deep-harnessability` and `/deep-harness-dashboard` skills.
