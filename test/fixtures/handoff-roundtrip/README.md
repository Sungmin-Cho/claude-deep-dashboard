# handoff-roundtrip — suite §9 mirror

These four envelope-wrapped artifacts are the **canonical consumer-side input
set** for the M5.7.B end-to-end regression guard
(`lib/e2e-suite-roundtrip.test.js`).

**Source of truth**: `claude-deep-suite/tests/fixtures/handoff-roundtrip/`
(`docs/test-catalog.md` §9). Suite PR #24, merge `0ca870e`.

This is a **byte-identical mirror** maintained manually. When the suite repo
publishes a fixture update (any change under
`tests/fixtures/handoff-roundtrip/` in claude-deep-suite), the same files
MUST be re-mirrored here before the next dashboard release. The drift
is detected at consumer time by `lib/e2e-suite-roundtrip.test.js` failing
its metric assertions — values are derived from the fixture math and pinned.

## Files

| File | Producer | Kind | Purpose |
|---|---|---|---|
| `01-deep-work-forward-handoff.json` | deep-work | handoff (phase-5-to-evolve) | Initiating handoff (run_id == 04's parent_run_id) |
| `02-deep-work-compaction.json` | deep-work | compaction-state (phase-transition) | preserved=2, discarded=3 → ratio 0.4 |
| `03-deep-evolve-compaction.json` | deep-evolve | compaction-state (loop-epoch-end) | preserved=2, discarded=3 → ratio 0.4 |
| `04-deep-evolve-reverse-handoff.json` | deep-evolve | handoff (evolve-to-deep-work) | Reverse handoff with parent_run_id chain closing 01 |

## Expected metric values (pinned in test)

- `suite.compaction.frequency` = **2**
- `suite.compaction.preserved_artifact_ratio` (mean) = **0.4**
- `suite.handoff.roundtrip_success_rate` = **1.0**

If the suite-repo fixture math shifts (preserved/discarded counts) or the
chain is broken (`parent_run_id` drift), this fixture-derived assertion
fires and the maintainer re-mirrors + re-pins.

## Why mirror instead of cross-repo path / fetch

- Suite-repo fixture is **dev-tool input**, not a runtime dependency. No
  npm dependency on claude-deep-suite.
- gh-api fetch at test time would couple test execution to network +
  GitHub-API rate limits (CI flake risk).
- Path reference (`../claude-deep-suite/...`) depends on user-local
  sibling-directory layout — brittle across machines and CI.

Manual mirror is the simplest invariant: "the same bytes are in two places".
Drift surfaces as test failure (numeric assertion diverges) at the consumer.
