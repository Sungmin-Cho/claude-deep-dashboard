# Plugin Monitors — adoption decision

> **Decision date**: 2026-05-11
> **Spec reference**: claude-deep-suite/docs/deep-suite-harness-roadmap.md §M4, 4.6
> **Roadmap task**: M4 §4.6 plugin monitors spike + 의사결정 문서
> **Decision**: **HOLD — defer to M4.5**

## Context

Claude Code v2.1.105+ exposes a `monitors/monitors.json` manifest field that
lets a plugin spawn a background command whose stdout lines are streamed back
to Claude as notifications. The M4 roadmap (`docs/deep-suite-harness-roadmap.md`
§M4 #5) names this as a "potential channel for M4 telemetry" and requires the
spike to land on one of three decisions:

- **(a) ACCEPT** — add `monitors/monitors.json` to deep-dashboard so the
  monitor tails `.deep-dashboard/suite-metrics.jsonl` and notifies on
  threshold breaches.
- **(b) HOLD** — defer monitor adoption to a separate milestone (M4.5).
- **(c) REJECT** — monitor cost/noise exceeds dashboard value.

## Spike scope (1d budget per roadmap)

In place of an end-to-end implementation, we evaluated against three concrete
acceptance gates that any monitor adoption would need to clear:

1. **Threshold defensibility** — can we name a value of
   `suite.dashboard.missing_signal_ratio` (or any of the 12 M4-core metrics)
   that warrants a Claude notification *today*?
2. **Cross-platform reliability** — does the monitor command run unmodified on
   macOS + Linux + (best-effort) Windows under WSL?
3. **Notification-fatigue posture** — what is the steady-state notification
   rate in a project that has the dashboard running daily?

## Findings

### Gate 1 — Threshold defensibility — **FAIL**

The 12 M4-core metrics emitted by PR 2 have **no historical baseline**. The
first `suite-metrics.jsonl` records are being written by PR 2; trend
direction is meaningful only after several days of accumulation. Setting a
fixed threshold today (e.g., "notify when `block_rate > 0.1`") would either:

- Fire constantly in greenfield projects where `block_rate` is null /
  oscillates wildly (notification fatigue), or
- Never fire in steady-state projects where the operator already knows the
  baseline (no operational value).

Per-metric defensible thresholds depend on data we are just starting to
collect. **Premature**.

### Gate 2 — Cross-platform reliability — **PARTIAL**

A naive monitor command (`tail -F .deep-dashboard/suite-metrics.jsonl | grep …`)
works on macOS + Linux but not on stock Windows. Cross-platform support
would require a small Node-based watcher script (`fs.watch` or `chokidar`),
which is an additional dependency footprint for an optional feature.

This is solvable but adds complexity not justified by the current value.

### Gate 3 — Notification-fatigue posture — **UNKNOWN**

Without Gate 1, we cannot estimate steady-state notification rate. The risk
profile suggests:

- Aggregator emits 1 snapshot per `/deep-harness-dashboard` invocation
  (interactive — bounded by user invocations).
- If a long-running daemon writes snapshots every minute, monitor
  notifications would be ~1440/day, of which < 1% are likely actionable.

**Not assessable without Gate 1**.

## Decision: HOLD (M4.5)

We **defer** monitor adoption to a follow-up milestone (M4.5) with two
prerequisites:

1. **At least 4 weeks of `suite-metrics.jsonl` history** from real projects
   (dogfooding deep-dashboard itself + 1-2 user projects).
2. **Threshold tuning derived from observed variance** — e.g., notify when
   `missing_signal_ratio` deviates more than 2σ from the trailing-30-snapshot
   mean.

When the M4.5 prerequisites are met, the implementation will be:

```jsonc
// .claude-plugin/monitors/monitors.json (M4.5)
{
  "monitors": [
    {
      "name": "suite-telemetry-watch",
      "command": "node ${CLAUDE_PLUGIN_DIR}/scripts/monitor-suite-metrics.js",
      "trigger": "interval",
      "interval_seconds": 300
    }
  ]
}
```

Where `monitor-suite-metrics.js` reads the trailing N records and emits a
line only when a metric crosses a 2σ threshold. This stays interaction-light
and skips the "tail every line" notification trap.

## Why not REJECT?

REJECT would close the option permanently. The monitor mechanism is a
well-designed primitive in Claude Code v2.1.105+, and the dashboard accumulates
exactly the kind of time-series signal that monitors are good at watching.
Once baselines exist, the value calculation flips positive — so we keep the
option alive in M4.5 rather than closing it.

## Why not ACCEPT now?

ACCEPT before baselines exist guarantees either notification fatigue or
silent uselessness. Either failure mode would damage user trust in the
dashboard's signal quality and undermine the M4 telemetry mission.

## Tracking

- **Follow-up milestone**: M4.5 — "Threshold-tuned suite monitors"
- **Prerequisite signals**: 4 weeks of suite-metrics.jsonl on 2+ projects
- **Owner**: claude-deep-dashboard maintainer (this plugin)
- **Re-evaluate by**: 2026-08-11 (T+0 + 3 months)
