# Ultrareview Fixes — Design Spec

**Date**: 2026-04-17
**Target version**: deep-dashboard v1.1.1 (patch)
**Scope**: Fix 10 issues identified in the 2026-04-17 ultrareview report.
**Branch**: `fix/ultrareview-v1.1.1`

## Context

The ultrareview (performed against `main` at commit `ff119eb`) identified 10 defects across 5 dimensions:

- **Critical (4)**: wrong TS detection heuristic, spurious recommendations for not-applicable checks, stale `plugin.json` version, wrong effectiveness-weight table in READMEs.
- **High (3)**: formatter crash on undefined fields, unescaped pipes in Markdown tables, silent drop of symlinked receipts.
- **Medium (2)**: `evolve-no-transfer` misfires on falsy `received_from`, boundary values (`keep_rate = 0.15`, `crash_rate = 0.20`) untested.
- **Low (4)**: unresolved `PLUGIN_DIR`/`PROJECT_ROOT` literal in skill, architecture diagram missing `deep-evolve`, Korean fragments in English README, `evolve-low-q` window logic undocumented.

All 45 existing tests pass — the defects live in edge cases and documentation that fixtures don't cover.

## Goals

1. Every defect in the ultrareview report receives a fix or a documented decision not to fix.
2. Every code fix ships with at least one regression test that would have caught the defect.
3. Commit history reads as a clean narrative — one commit per affected module plus one docs-sweep commit.

## Non-goals

- No new features, no new data sources, no API/schema changes.
- No refactoring beyond the minimum needed to fix each defect.
- No version bump to `1.1.1` in this branch — the release cut is a separate decision.
- Scope is limited to the 10 enumerated ultrareview items. Other latent bugs are out of scope.

## Branch & Commit Plan

All work lands on a single feature branch `fix/ultrareview-v1.1.1` branched from `main`. One PR at the end.

### Commit 1 — `fix(scorer): correct TS detection and filter NA from recommendations`

Addresses: **C1, C2**.

**Files**: `lib/harnessability/scorer.js`, `lib/harnessability/scorer.test.js`.

**Changes**:
- `scorer.js:310` — replace `exists(root, 'tsconfig.json') || exists(root, 'package.json')` with `exists(root, 'tsconfig.json')`. Rationale: `package.json` is present in every Node project regardless of TS usage; including it forces TS-only checks onto pure-JS and Python-with-frontend projects.
- `scorer.js:351` — change the inner recommendation guard from `if (!chk.passed)` to `if (!chk.passed && !chk.not_applicable)`. Rationale: not-applicable checks have `passed: false` by convention; without this guard, a low-scoring dimension emits recommendations like "enable Python type hints" to TypeScript projects.

**New tests**:
- "JS-only project (package.json without tsconfig.json) does not apply TS-only checks"
- "low-scoring dimension in TS project does NOT emit Python recommendations"

### Commit 2 — `fix(formatter): guard undefined fields and escape markdown pipes`

Addresses: **H1, H2** (plus the bonus fixes identified: `centerLine` width, NaN in `q_trajectory`).

**Files**: `lib/dashboard/formatter.js`, `lib/dashboard/formatter.test.js`.

**Changes**:
- `centerLine` (line 50): use `stripAnsi(text).length` for width calculation. Rationale: all other width-sensitive helpers already strip ANSI; `centerLine` is an outlier that would throw `RangeError` if an ANSI-colored title is ever passed.
- `renderHealth` (line 70): guard `h.type`, `h.summary`, and similar string fields with `?? ''` before passing to `pad`. Rationale: `pad` calls `.replace(...)` on its input; `undefined.replace` throws.
- `renderActions` (line 101): guard `actions[i].suggested_action` with `?? ''`. Markdown equivalent (line 329) likewise guards `a.finding` and `a.suggested_action`.
- `renderEvolveCLI` / `renderEvolveMarkdown` (lines 118–119, 146–147): before calling `.toFixed(2)` on a `q_trajectory` element, check `typeof === 'number' && !Number.isNaN(x)`; otherwise render `'?'`.
- Introduce a small helper `escapePipe = (s) => String(s ?? '').replace(/\|/g, '\\|')` and apply it to every interpolated cell in Markdown tables at lines 285, 299, 329.

**New tests**:
- "renderHealth does not throw when health entry lacks `type`"
- "formatMarkdown escapes literal `|` in finding strings"
- "renderEvolveCLI emits `?` (not `NaN`) when q_trajectory contains NaN"

### Commit 3 — `fix(action-router): treat null received_from distinctly, add boundary tests`

Addresses: **M1, M2**.

**Files**: `lib/dashboard/action-router.js`, `lib/dashboard/action-router.test.js`.

**Changes**:
- `action-router.js:148` — change `!receipt.transfer?.received_from` to `receipt.transfer?.received_from == null`. Rationale: only `null`/`undefined` mean "no transfer attempted"; `0` or `""` are (admittedly unusual but) valid archive identifiers that should not fire `evolve-no-transfer`.
- No threshold changes to `keep_rate < 0.15` or `crash_rate > 0.2`. **Decision: both thresholds remain strict** (exclusive). A project at exactly 15% keep rate or exactly 20% crash rate is treated as acceptable. The boundary tests codify this so a future refactor cannot accidentally flip the sign. Rationale: inclusive thresholds would fire on perfectly-tuned projects hitting the exact cutoff; the strict form aligns with typical "worse than X%" intuition.

**New tests**:
- "evolve-no-transfer does NOT fire when received_from is numeric 0"
- "evolve-low-keep does NOT fire at exactly keep_rate = 0.15" (boundary)
- "evolve-high-crash does NOT fire at exactly crash_rate = 0.20" (boundary)

### Commit 4 — `fix(collector): follow symlinks when scanning JSON directories`

Addresses: **H3**.

**Files**: `lib/dashboard/collector.js`, `lib/dashboard/collector.test.js`.

**Changes**:
- `collector.js:36` — replace `if (!entry.isFile()) continue;` with a two-step check: accept `entry.isFile()` OR (`entry.isSymbolicLink()` AND the resolved target is a regular file via `fs.statSync`). Rationale: `Dirent.isFile()` returns `false` for symlinks even when the target is a regular JSON file, causing silent data loss for any setup that symlinks receipts.
- Guard against broken symlinks: wrap the `statSync` call; on `ENOENT`, skip the entry silently (same behavior as before).

**New test**:
- "readJsonDir loads JSON content when the directory entry is a symbolic link to a regular file" (creates a real symlink under `os.tmpdir()`).

### Commit 5 — `docs: sync weights, version, architecture diagram, and skill command`

Addresses: **C3, C4, L1, L2, L3, L4**.

**Files**: `.claude-plugin/plugin.json`, `README.md`, `README.ko.md`, `skills/deep-harnessability.md`, `skills/deep-harness-dashboard.md` (if affected).

**Changes**:

| Target | Change |
|---|---|
| `plugin.json` | `"version": "1.0.0"` → `"version": "1.1.0"` (match `package.json`) |
| `README.md` / `README.ko.md` effectiveness table | Replace the 4-row table with the correct 5-row table: health 25%, fitness 20%, session 20%, harnessability 15%, evolve 20% |
| `README.md` / `README.ko.md` architecture diagram (lines 217–223) | Add `deep-evolve` as a fourth input arrow |
| `README.md` evolve section | Translate Korean fragments ("권장", "점검", "검토") into English |
| `skills/deep-harnessability.md` L13 | Replace `PLUGIN_DIR`/`PROJECT_ROOT` literals with the Claude Code plugin runtime variables. Before making this edit, consult the `claude-code-guide` subagent for the exact variable names; the current best guess is `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PROJECT_DIR}` but must be verified against official docs |
| Docs `evolve-low-q` description | Change "delta > 0.05" → "the first of the last-3 Q(v) values is more than 0.05 above the last (i.e., the recent 3-point window is trending down)" in both READMEs and CHANGELOGs |

**No tests** — pure documentation/manifest.

## Test Strategy

- **TDD per code commit**: for commits 1–4, each new test is added in the same commit as the fix. The test must fail against the pre-fix code and pass against the fixed code.
- Test isolation: any filesystem-touching test (commit 4) uses `os.tmpdir()` and cleans up.
- After each commit: `npm test` must pass with strictly more passing tests than before (no regressions, at least one new test per code commit).
- After commit 5: `npm test` total count unchanged from commit 4 (docs-only).

## Validation Plan

Before opening the PR:

1. `npm test` — all tests pass, counts match expectation (~8 new tests).
2. `git log --oneline main..HEAD` — five commits in the order described, no fixup/amend noise.
3. Manual spot-check:
   - `node -e "const s = require('./lib/harnessability/scorer.js'); ..."` on a sample JS-only project (e.g., any tiny repo with `package.json` but no `tsconfig.json`) — recommendations should no longer list TS items.
   - Cat `README.md` and `README.ko.md` — weight table shows 5 rows summing to 100%.
   - `jq .version .claude-plugin/plugin.json package.json` — both report `1.1.0`.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| The Claude Code plugin runtime variable name for `PLUGIN_DIR` / `PROJECT_ROOT` is wrong | Verify via `claude-code-guide` subagent before commit 5; if uncertain, fall back to relative-path form and flag in PR description |
| Symlink test is platform-specific (Windows) | `os.symlinkSync` raises `EPERM` on Windows without admin; test uses `try/catch + test.skip` on EPERM to avoid false CI failures |
| Markdown pipe-escape breaks existing snapshot tests | None currently exist; add only enough assertions to verify the new behavior |

## Out of Scope (deferred)

- Version bump + CHANGELOG entry for `v1.1.1` — a separate release commit after this PR lands.
- Broader defensive gardening (e.g., null-guarding every field in every formatter) — only the 10 enumerated issues.
- Any refactoring (extract helpers beyond `escapePipe`, consolidate stripAnsi usage, etc.) — belongs in a follow-up if desired.
