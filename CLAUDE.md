# deep-dashboard — Project Guide for Claude

Cross-plugin harness diagnostics for the deep-suite ecosystem: harnessability scoring (6-dimension computational assessment of codebase health), cross-plugin effectiveness aggregation, and M4+ suite telemetry collection across all installed deep-suite plugins.

For detailed version history see [`CHANGELOG.md`](CHANGELOG.md). This file is intentionally short — it holds the overview, structure, and drift-resistant conventions only.

To check the current version: `jq -r .version .claude-plugin/plugin.json`

---

## Project Overview

**deep-dashboard** is a [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that closes the harness-engineering feedback loop. It reads M3-envelope-wrapped artifacts from every other deep-suite plugin, aggregates them into a unified view, and emits its own envelope (`harnessability-report`) for consumption by deep-work Phase 1 Research.

**Two distinct surfaces:**
1. **Harnessability scorer** (`/deep-harnessability`) — pure-computational 6-dimension assessment of the codebase itself (17 detectors). Output: `.deep-dashboard/harnessability-report.json` (M3 envelope) and a bar-chart report.
2. **Suite collector + dashboard** (`/deep-harness-dashboard`, optionally `--suite`) — reads 11 cross-plugin sources (8 M3 envelopes + 3 NDJSON logs), computes 16 metrics (12 M4-core + 4 M5), and renders a unified dashboard.

**Marketplace presence**: One of six plugins in the [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) marketplace.

---

## 🚨 CRITICAL — Plugin Update Workflow

**Every deep-dashboard release must be accompanied by the following work. No exceptions.**

### 1. Sync the deep-suite marketplace (required)

Update the following in `/Users/sungmin/Dev/claude-plugins/deep-suite/`:

- **`.claude-plugin/marketplace.json`** — under the `deep-dashboard` entry: `sha` = full 40-character merge commit hash on the new `main`; description = one-line headline summary.
- **`README.md`** / **`README.ko.md`** — the `deep-dashboard` row in the Plugins table and any narrative sections that reference the version.

After editing:
```bash
cd /Users/sungmin/Dev/claude-plugins/deep-suite
git add .claude-plugin/marketplace.json README.md README.ko.md
git commit -m "chore: bump deep-dashboard to vX.Y.Z — <one-line summary>"
git push
```

### 2. Update deep-dashboard CHANGELOG (required)

- Add a new version entry to `CHANGELOG.md`
- Bump the version in `.claude-plugin/plugin.json` and `package.json`
- Run `npm run check:version-sync` to confirm `plugin.json.version === package.json.version`

**Do NOT inline release notes in this CLAUDE.md** — CHANGELOG is the single source of truth.

---

## Directory Structure

```
deep-dashboard/
├── .claude-plugin/plugin.json     # plugin manifest; declares /deep-harnessability + /deep-harness-dashboard skills
├── package.json                    # @deep-suite/deep-dashboard (Node 20+, ESM)
├── lib/
│   ├── harnessability/
│   │   ├── scorer.js               # pure-computational 6-dimension scorer (17 detectors)
│   │   ├── checklist.json          # dimension/check metadata + weights
│   │   └── missing-signal.test.js  # not_applicable redistribution logic
│   ├── dashboard/
│   │   ├── collector.js            # M3 envelope-aware reader (5 dashboard sources)
│   │   ├── effectiveness.js        # 5-dimension scorer with weight redistribution
│   │   └── action-router.js        # suggests actions (npm audit fix, remove dead exports, …)
│   ├── suite-collector.js          # M4 collector for 11 cross-plugin sources (8 envelopes + 3 NDJSON)
│   ├── aggregator.js               # computes 16 M4/M5 metrics from raw snapshot
│   ├── suite-formatter.js          # renders .deep-dashboard/suite-report.md with trend arrows
│   ├── metrics-catalog.yaml        # authoritative spec for all 16 metrics
│   ├── suite-constants.js          # ENVELOPE_ROLLOUT dates, ADOPTION_LEDGER, EXPECTED_SOURCES,
│   │                                # PAYLOAD_REQUIRED_FIELDS (minimal field checks)
│   ├── otel.js                     # optional OTel/HTTP-JSON export (OTEL_EXPORTER_OTLP_ENDPOINT)
│   └── *.test.js                   # 259 unit tests (metric math, roundtrip, envelope, edge cases)
├── skills/
│   ├── deep-harnessability.md      # /deep-harnessability — scorer + bar chart + top 3 recommendations
│   └── deep-harness-dashboard.md   # /deep-harness-dashboard [--suite] — aggregated view + telemetry
├── scripts/
│   ├── validate-envelope-emit.js   # emit-validator (producer_version sync, identity-triple, payload shape)
│   ├── check-catalog-drift.js      # detects drift between local manifest and suite test-catalog.md
│   └── check-version-sync.js       # plugin.json.version === package.json.version
├── test/
│   └── fixtures/
│       └── handoff-roundtrip/      # canonical roundtrip fixtures (4 artifacts; mirror of suite §9)
├── .github/workflows/
│   └── catalog-drift-check.yml     # PR + push + daily 06:30 UTC
├── docs/                            # superpowers/, monitor-decision.md (gitignored)
├── CHANGELOG.md
└── README.md
```

---

## Key Concepts

### `harnessability-report` envelope (own emission)

```
envelope.producer:         "deep-dashboard"
envelope.artifact_kind:    "harnessability-report"
envelope.schema:           { name: "harnessability-report", version: "1.0" }

payload (REQUIRED, per lib/suite-constants.js PAYLOAD_REQUIRED_FIELDS):
  - projectRoot
  - total              (0–10, weighted avg across dimensions)
  - grade              (Excellent | Good | Fair | Poor)
  - dimensions[]:
      - id ∈ { type_safety, module_boundaries, test_infra,
               sensor_readiness, linter_formatter, ci_cd }
      - weight: 0.25 | 0.20 | 0.20 | 0.15 | 0.10 | 0.10
      - score: 0–10 (round((passed / applicable) * 10) / 10)
  - recommendations[]
```

**Scoring formula**: each dimension `score = round((passedChecks / applicableChecks) * 10) / 10`. `not_applicable` checks are excluded from BOTH numerator and denominator, and their weight is redistributed proportionally to other dimensions. `total = sum(dimensionScore × dimensionWeight)`.

**Freshness contract**: report is fresh if modified < 24 hours ago. Older or missing → recompute. Shared with deep-work Phase 1 Research.

### Suite telemetry — `.deep-dashboard/suite-metrics.jsonl`

Append-only JSONL, one object per `/deep-harness-dashboard --suite` run. **16 metrics**:

- **M4-core (12)**: `suite.hooks.{block_rate, error_rate}`, `suite.artifact.freshness_seconds`, `suite.artifact.schema_failures_total`, `suite.integrate.recommendation_accept_rate`, `suite.review.verdict_mix` (distribution), `suite.review.recurring_finding_count`, `suite.wiki.auto_ingest_candidates_total`, `suite.docs.auto_fix_accept_rate`, `suite.evolve.q_delta_per_epoch`, `suite.dashboard.missing_signal_ratio`, `suite.cross_plugin.run_id_chain_completeness`
- **M5 (4)**: `suite.compaction.{frequency, preserved_artifact_ratio}`, `suite.handoff.roundtrip_success_rate`, `suite.tests.coverage_per_plugin` (per-plugin distribution)

### Null semantics

Per `lib/metrics-catalog.yaml`, metrics emit `null` when their source data is absent, insufficient, or cannot be computed — this is distinct from "missing signal."

`missing_signal_ratio = (expected sources with no/invalid data) / (total expected sources)`. At 0% (all 15 expected sources present), dashboards assume full observability; at 100%, diagnostics degrade to legacy fallback mode.

### Cross-plugin sources (15 expected, per `EXPECTED_SOURCES`)

- **8 M3 envelopes**: `deep-work/{session,slice}-receipt`, `deep-review/recurring-findings`, `deep-docs/last-scan`, `deep-evolve/{evolve-receipt,evolve-insights}`, `deep-dashboard/harnessability-report`, `deep-wiki/index`
- **4 M5 envelopes**: `deep-work/{handoff,compaction-state}`, `deep-evolve/{handoff,compaction-state}`
- **3 NDJSON**: `.deep-work/hooks.log.jsonl`, `.deep-evolve/hooks.log.jsonl`, `<wiki_root>/log.jsonl`

### Envelope identity guards (defense-in-depth)

The collector unwraps only when ALL of:
- `schema_version === "1.0"` (strict string equality; numeric `2` rejected)
- `envelope` is non-null object (not array — `typeof [] === "object"`)
- `payload` is non-null, non-array object (primitives rejected)
- Identity triple matches: `producer`, `artifact_kind`, `schema.name`
- Required fields present per `PAYLOAD_REQUIRED_FIELDS[artifact_kind]`

**Mismatch → silent `null` with stderr warning** (NOT thrown). Downstream consumers treat null as "no data" and skip that dimension. One plugin's envelope landing under another's read path (e.g. via symlink) is NEVER silently trusted.

### Parent run ID chain

`suite.cross_plugin.run_id_chain_completeness = (envelopes with valid parent in suite) / (total envelopes)`. The metric aggregates a single snapshot — it does NOT validate DAGs or transitive closure. A snapshot with only reverse handoffs (no forward handoffs to ground the chain) can still score high.

### Adoption ledger (`lib/suite-constants.js`)

- T+0 = `2026-05-07` (first envelope adoption, deep-docs PR merge)
- T+0 + 6 months = `2026-11-07` (legacy-fallback cutoff, exclusive)

Before cutoff, missing envelopes are silently accepted (fallback mode). After, a `legacy_fallback_warning` is emitted (defensive guard against downgrade scenarios).

Per-plugin adoption since dates: deep-docs / deep-dashboard / deep-work `2026-05-07`; deep-evolve / deep-review `2026-05-08`; deep-wiki `2026-05-11`.

### M5.7.B roundtrip — handoff receiver signal

The receiver of a forward handoff (A → B) emits a **reverse handoff** (B → A) to signal success — there is NO separate "receiver-receipt" file. The aggregator counts the reverse handoff as a roundtrip. Multi-ack (2 reverse handoffs to 1 forward) and unrelated-child filtering are validated by `lib/e2e-suite-roundtrip.test.js` Round 3 C3 scenarios.

---

## Workflows & Conventions

### ESM-only, zero runtime deps

All modules are Node.js ESM with `import` / `export`. No npm packages outside `devDependencies` (the test runner is built-in `node --test`).

Envelope unwrap helpers are intentionally duplicated across `lib/dashboard/collector.js` and `lib/suite-collector.js` (PR 1 scope boundary; consolidation to `lib/envelope-unwrap.js` is deferred to M5).

### Literal CWD resolve

The harnessability scorer walks **upward from its own module path** (`lib/harnessability/scorer.js`) to find `.claude-plugin/plugin.json` for `producer_version` — NOT from the caller's cwd. This prevents corruption when the consumer (e.g. deep-work running in a user project) has an unrelated `.claude-plugin/plugin.json`. Git state detection also uses the `projectRoot` parameter, never cwd.

### Strict envelope shape detection

- `schema_version === "1.0"` (string, not numeric) — legacy deep-docs v1.1.0 used numeric `2`; strict check keeps them distinguishable.
- Envelope and payload must both be non-null, non-array objects.

### Per-plugin hook log reading (non-hook filter)

`suite.hooks.block_rate` reads from 3 NDJSON logs (deep-work, deep-evolve, deep-wiki). Events with `event ∈ { hook-block, hook-deny }` are counted as blocked. Malformed lines are skipped defensively (not fatal).

**Deep-wiki's `log.jsonl` is appended by wiki ingest/query operations, NOT hook lifecycle.** The suite collector ignores non-hook events from that file — flagged HIGH in Round 1 3-way review.

---

## Slash commands

| Command | Mode | Output |
|---|---|---|
| `/deep-harnessability` | synchronous | bar-chart report; envelope JSON to stdout; writes `.deep-dashboard/harnessability-report.json` |
| `/deep-harness-dashboard` | legacy (default) | CLI table; `--json` flag for JSON |
| `/deep-harness-dashboard --suite` | M4+ suite telemetry | JSONL append to `.deep-dashboard/suite-metrics.jsonl` + markdown trend report; optional OTel export |

**Automation**:
- `/deep-harnessability` is invoked by deep-work Phase 1 Research if the report is missing or > 24 hours old (shared freshness contract).
- `/deep-harness-dashboard` (legacy mode) runs the scorer inline if the report is stale, then renders.
- Suite mode (`--suite`) is manual-only — not triggered by other plugins' workflows.

---

## Tests

```bash
npm test                    # node --test on lib/**/*.test.js (259 cases)
npm run validate:envelope   # producer_version + identity + shape
npm run check:catalog-drift # lib/test-catalog-manifest.json vs suite docs/test-catalog.md
npm run check:version-sync  # plugin.json.version === package.json.version
```

**Test catalog manifest** (`lib/test-catalog-manifest.json`) mirrors `claude-deep-suite/docs/test-catalog.md` §1–§10 (10 cross-plugin e2e scenarios). The drift checker prevents this manifest from desynchronizing.

**M5.7.B consumer-side e2e** (`lib/e2e-suite-roundtrip.test.js`) drives 4 canonical handoff fixtures through aggregator M5 functions:
- `suite.compaction.frequency = 2`
- `suite.compaction.preserved_artifact_ratio = 0.4` (mean)
- `suite.handoff.roundtrip_success_rate = 1.0`

Fixtures at `test/fixtures/handoff-roundtrip/` are a byte-identical mirror of suite §9 source of truth. Re-copy on suite update before release.

**CI** (`.github/workflows/catalog-drift-check.yml`) runs on PR (path-filtered) + push to main + daily 06:30 UTC. Suite source resolved via `--suite-path=`, `SUITE_REPO_LOCAL` env, or `gh api` fallback.

---

## Quick references

| Question | Answer |
|---|---|
| Envelope identity mismatch found in production? | Should be `null` + stderr warning (NOT thrown) — fix the producer / reader path, not the dashboard |
| Python-only project scoring low on Type Safety? | Should NOT — `not_applicable` redistribution excludes TS checks; check `dimensions[].score` and `weight` redistribution |
| Chain completeness suspiciously high? | Metric aggregates a single snapshot; degenerate continuation-only chains still score high (by design) |
| Suite report empty after `--suite`? | Verify at least 1 of 15 expected sources is present; `missing_signal_ratio = 1.0` means full fallback mode |
| Catalog drift on PR? | Re-sync `lib/test-catalog-manifest.json` to `claude-deep-suite/docs/test-catalog.md` and re-run `check:catalog-drift` |

---

## Related repositories

- **deep-suite (marketplace)**: https://github.com/Sungmin-Cho/claude-deep-suite — `/Users/sungmin/Dev/claude-plugins/deep-suite`
- **deep-work**: https://github.com/Sungmin-Cho/claude-deep-work
- **deep-wiki**: https://github.com/Sungmin-Cho/claude-deep-wiki
- **deep-evolve**: https://github.com/Sungmin-Cho/claude-deep-evolve
- **deep-review**: https://github.com/Sungmin-Cho/claude-deep-review
- **deep-docs**: https://github.com/Sungmin-Cho/claude-deep-docs

---

**🔁 Reminder**: This CLAUDE.md is intentionally kept short. For every new release:

1. **Write the details in CHANGELOG** (not here — prevents drift)
2. **Only sync the schema sections** (harnessability-report payload, metrics catalog, envelope identity guards, EXPECTED_SOURCES) if the schema itself changed
3. **Sync the deep-suite marketplace** (see the "CRITICAL" section above)
