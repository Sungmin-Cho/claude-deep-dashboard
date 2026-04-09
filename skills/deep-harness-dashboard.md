---
name: deep-harness-dashboard
description: Unified harness dashboard — aggregates sensor results from deep-work, deep-review, deep-docs into a single view with effectiveness scoring and action routing.
---

# Harness Dashboard

Aggregates cross-plugin sensor data into a unified view.

## Steps

1. Collect data from available plugins by running the collector
2. Run harnessability scorer if report is stale/missing
3. Calculate effectiveness score
4. Format and display the CLI dashboard
5. Ask: "리포트 파일을 생성할까요? (y/n)"
   - If yes: generate `harness-report-YYYY-MM-DD.md` in project root
   - Ask: "git commit할까요? (y/n)"

## Options
- `--json` — output raw JSON instead of formatted CLI table
