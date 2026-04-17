# Ultrareview Fixes — Design Spec

**Date**: 2026-04-17
**Target version**: deep-dashboard v1.1.1 (patch)
**Scope**: Fix 10 issues identified in the 2026-04-17 ultrareview report.
**Branch**: `fix/ultrareview-v1.1.1`

**Revision history**:
- Rev 1 (commit `d9e91e0`): initial spec.
- Rev 2 (this commit): incorporates deep-review feedback from `.deep-review/reports/2026-04-17-142904-review.md`. Accepted 7 items (C-1, C-2, C-3, C-5, W-2, W-3, W-4), partial-accepted W-1, deferred W-5, rejected C-4 as moot. See `.deep-review/responses/2026-04-17-143254-response.md` for evidence and rationale.

## Context

The ultrareview (performed against `main` at commit `ff119eb`) identified 10 defects across 5 dimensions:

- **Critical (4)**: wrong TS detection heuristic, spurious recommendations for not-applicable checks, stale `plugin.json` version, wrong effectiveness-weight table in READMEs.
- **High (3)**: formatter crash on undefined fields, unescaped pipes in Markdown tables, silent drop of symlinked receipts.
- **Medium (2)**: `evolve-no-transfer` misfires on falsy `received_from` (closed as won't-fix per Rev 2 — see below), boundary values (`keep_rate = 0.15`, `crash_rate = 0.20`) untested.
- **Low (4)**: unresolved `PLUGIN_DIR`/`PROJECT_ROOT` literal in skill, architecture diagram missing `deep-evolve`, Korean fragments in English README, `evolve-low-q` window logic undocumented.

All 45 existing tests pass — the defects live in edge cases and documentation that fixtures don't cover.

## Goals

1. Every defect in the ultrareview report receives a fix or a documented decision not to fix.
2. Every code fix ships with at least one regression test that would have caught the defect.
3. Commit history reads as a clean narrative — one commit per affected module plus one docs-sweep commit.
4. Cross-module consistency is preserved — any semantic change (e.g. schema) updates every consumer in the same commit.

## Non-goals

- No new features, no new data sources, no API/schema changes.
- No refactoring beyond the minimum needed to fix each defect.
- No version bump to `1.1.1` in this branch — the release cut is a separate decision. (Note: `plugin.json` is bumped to `1.1.0` to align with `package.json`, not to `1.1.1`.)
- Scope is limited to the 10 enumerated ultrareview items. Other latent bugs are out of scope.

## Branch & Commit Plan

All work lands on a single feature branch `fix/ultrareview-v1.1.1` branched from `main`. One PR at the end.

### Commit 1 — `fix(scorer): correct TS detection and filter NA from recommendations`

Addresses: **C1, C2**.

**Files**: `lib/harnessability/scorer.js`, `lib/harnessability/scorer.test.js`.

**Changes**:
- In `scoreHarnessability` (currently scorer.js:310): replace `exists(root, 'tsconfig.json') || exists(root, 'package.json')` with `exists(root, 'tsconfig.json')`. Rationale: `package.json` is present in every Node project regardless of TS usage; including it forces TS-only checks onto pure-JS and Python-with-frontend projects. Intentional narrowing — a JS project that wants TS-specific scoring should add a `tsconfig.json`. This intent will be called out in the PR body.
- In the recommendation loop (currently scorer.js:351): change the inner guard from `if (!chk.passed)` to `if (!chk.passed && !chk.not_applicable)`. Rationale: not-applicable checks have `passed: false` by convention; without this guard, a low-scoring dimension emits recommendations like "enable Python type hints" to TypeScript projects.

**New tests**:
- "JS-only project (package.json without tsconfig.json) does not apply TS-only checks"
- "low-scoring type_safety dimension in TS project does NOT emit Python recommendations"

### Commit 2 — `fix(formatter): guard undefined fields and escape markdown pipes`

Addresses: **H1, H2** (plus the related fixes: `centerLine` width, NaN in `q_trajectory`).

**Files**: `lib/dashboard/formatter.js`, `lib/dashboard/formatter.test.js`.

**Changes** (all references are symbolic; line numbers will drift):
- In `centerLine`: use `stripAnsi(text).length` for width calculation. Rationale: all other width-sensitive helpers already strip ANSI; `centerLine` is an outlier that would throw `RangeError` if an ANSI-colored title is ever passed. Known limitation: width math still assumes ASCII cell width — full-width or emoji characters would still misalign. No current caller passes such strings; this is documented as a future item and not fixed here.
- In `renderHealth`: guard `h.type` and `h.summary` with `?? ''` before passing to `pad`. Rationale: `pad` calls `.replace(...)` on its input; `undefined.replace` throws.
- In `renderActions` (CLI path): guard `actions[i].suggested_action` with `?? ''`. The Markdown equivalent (the `- **${a.finding}**: ${a.suggested_action}` bullet list) likewise guards `a.finding` and `a.suggested_action`.
- In `renderEvolveCLI` / `renderEvolveMarkdown`: before calling `.toFixed(2)` on a `q_trajectory` element, check `typeof === 'number' && !Number.isNaN(x)`; otherwise render `'?'`.
- Introduce helper `escapePipe = (s) => String(s ?? '').replace(/\|/g, '\\|')` and apply it to **every interpolated cell in every Markdown table**. Specifically:
  - Health Status table row: `| ${h.type} | ${icon} ${h.status} | ${detail} |`
  - Fitness Rules table row: `| ${f.ruleId} | ${result} | ${violations} |`
  - Recent Sessions table row: `| ${s.id} | ${s.date} | ${s.quality} | ${s.sensors ?? '-'} | ${s.mutation ?? '-'} |`
  - Evolve table rows inside `renderEvolveMarkdown`: Experiments, Improvement, Strategy Evolution, Archives, Transfer (`transfer.received_from` is especially likely to contain `|`), and Quality Score cells.
  - Bullet list (`- **${a.finding}**: ${a.suggested_action}`) does **not** need pipe escaping — it is not a pipe table. Keep the undefined-guard only.

**New tests**:
- "renderHealth does not throw when health entry lacks `type`"
- "formatMarkdown escapes literal `|` in finding strings, session sensors/mutation, and transfer.received_from"
- "renderEvolveCLI emits `?` (not `NaN`) when q_trajectory contains NaN"

### Commit 3 — `test(action-router): pin boundary behavior for keep_rate and crash_rate`

Addresses: **M2**. (M1 closed as won't-fix — see below.)

**Files**: `lib/dashboard/action-router.test.js`.

**Changes**:
- No code changes. This commit adds regression tests only.
- Decision on **M1** (evolve-no-transfer on falsy `received_from`): **closed as won't-fix**. Rationale: consumer inconsistency — the formatter's transfer row uses `if (transfer?.received_from)` truthiness, so changing only the action-router would suppress the router finding while the formatter still hides the transfer row, creating a silent false-negative. The `received_from` schema is now explicitly documented as `non-empty string | null` (see commit 5). Under that schema, `0` and `""` cannot occur, so the original M1 report describes an unreachable state.
- **Decision on thresholds**: both `keep_rate < 0.15` and `crash_rate > 0.2` remain strict (exclusive). Projects at exactly 15% / 20% are treated as acceptable. This aligns with the intuitive "worse than X%" UX convention used by the deep-evolve receipt schema. The new tests codify the boundary to prevent an accidental sign flip in future refactors.

**New tests**:
- "evolve-low-keep does NOT fire at exactly keep_rate = 0.15" (boundary)
- "evolve-high-crash does NOT fire at exactly crash_rate = 0.20" (boundary)

### Commit 4 — `fix(collector): follow symlinks safely within project boundary`

Addresses: **H3**.

**Files**: `lib/dashboard/collector.js`, `lib/dashboard/collector.test.js`.

**Changes**:
- In `readJsonDir`: replace `if (!entry.isFile()) continue;` with:
  1. Accept `entry.isFile()` outright.
  2. For `entry.isSymbolicLink()`, resolve via `fs.realpathSync(path.join(dirPath, entry.name))`. Reject (skip + log warning) if the resolved path does not start with `path.resolve(dirPath)` — i.e., the target must stay inside the scanned directory. Accept only if the resolved target passes `fs.statSync(resolved).isFile()`.
  3. Broken symlinks (caught `ENOENT` or similar on `realpathSync`/`statSync`) skip with a warning, not silently.
- Warnings are emitted via `console.warn` with a consistent prefix (`[deep-dashboard/collector]`). Silent drops are the bug — visibility is the fix.
- Rationale: without containment, a repository-local symlink can cause the dashboard to ingest arbitrary JSON from anywhere on disk the current user can read, breaking the "project-rooted data" invariant. Containment is cheap and preserves trust boundaries.

**New tests**:
- "readJsonDir loads JSON content when the directory entry is a symbolic link to a regular file within the same directory" (creates a real symlink inside a tmpdir).
- "readJsonDir rejects a symlink whose target resolves outside the scanned directory" (creates a symlink pointing to a file in a sibling tmpdir; asserts the entry is NOT in the result and a warning was emitted).
- "readJsonDir skips a broken symlink with a warning" (symlink to a nonexistent path).
- Windows mitigation: use `test.skipIf(process.platform === 'win32' && !isAdmin)` — explicit skip rather than silent `try/catch` on `EPERM`. `isAdmin` detection via a cheap probe (e.g., attempting a no-op `symlinkSync` in setup).

### Commit 5 — `docs: sync weights, version, architecture, skill command, and received_from schema`

Addresses: **C3, C4, L1, L2, L3, L4** + schema documentation mandated by Rev 2 (supporting commit 3's won't-fix on M1).

**Files**: `.claude-plugin/plugin.json`, `README.md`, `README.ko.md`, `skills/deep-harnessability.md`, `skills/deep-harness-dashboard.md` (if affected).

**Changes**:

| Target | Change |
|---|---|
| `plugin.json` | `"version": "1.0.0"` → `"version": "1.1.0"` (match `package.json`). Note: this is a catch-up, not a new release. |
| `README.md` / `README.ko.md` effectiveness table | Replace the 4-row table with the correct 5-row table: health 25%, fitness 20%, session 20%, harnessability 15%, evolve 20% (sums to 100%). |
| `README.md` / `README.ko.md` architecture diagram | Add `deep-evolve` as a fourth input arrow. |
| `README.md` evolve section | Translate Korean fragments ("권장", "점검", "검토") into English. `README.ko.md` unchanged. |
| `README.md` / `README.ko.md` evolve section | Add explicit schema note: `transfer.received_from: non-empty string \| null`. Note that empty-string or numeric sentinels are not part of the schema. |
| `skills/deep-harnessability.md` L13 | Default form: replace `PLUGIN_DIR`/`PROJECT_ROOT` literals with relative-path invocation (`node ./lib/harnessability/scorer.js "$(pwd)"`) which works from the project root. Claude Code env var resolution (`${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}`) is a follow-up verification item — if confirmed by the `claude-code-guide` subagent, upgrade in a separate commit. Primary goal here: remove the unresolved literal so the skill is runnable. |
| Docs `evolve-low-q` description | Change "delta > 0.05" → "the earliest of the last-3 Q(v) values is more than 0.05 above the most recent (i.e., the recent 3-point window is trending down)" in both READMEs and both CHANGELOGs. |

**No tests** — pure documentation/manifest.

## Test Strategy

- **TDD per code commit**: for commits 1, 2, 4, each new test is added in the same commit as the fix. The test must fail against the pre-fix code and pass against the fixed code.
- Commit 3 is pure test-only; tests characterize the decision (strict thresholds) and must pass against current code.
- Test isolation: any filesystem-touching test (commit 4) uses `os.tmpdir()` and cleans up.
- After each commit: `npm test` must pass with strictly more passing tests than before (no regressions, at least one new test per code commit).
- After commit 5: `npm test` total count unchanged from commit 4 (docs-only).
- Expected final delta: ~8 new tests on top of existing 45.

## Validation Plan

Before opening the PR:

1. `npm test` — all tests pass, counts match expectation.
2. `git log --oneline main..HEAD` — five commits in the order described, no fixup/amend noise.
3. Manual spot-check:
   - A throwaway JS-only project (has `package.json`, no `tsconfig.json`) — recommendations should no longer list TS items.
   - `README.md` / `README.ko.md` — effectiveness weight table has 5 rows summing to 100%, architecture diagram includes `deep-evolve`.
   - `jq .version .claude-plugin/plugin.json package.json` — both report `1.1.0`.
   - Manual grep for unescaped pipes: craft a test fixture where session `sensors` contains `|`, format to Markdown, verify the table still parses.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude Code plugin runtime variable name for plugin/project dir is unknown or differs across versions | Default to the relative-path form (`./lib/...` from project root) in commit 5, which works without any runtime variable. Env-var upgrade is a separate follow-up, not a blocker. |
| Symlink test is platform-specific (Windows) | Use `test.skipIf(process.platform === 'win32' && !isAdmin)` with explicit intent; `isAdmin` probed via a no-op symlink attempt in setup. |
| Realpath containment check rejects a legitimate in-directory symlink in an edge case (e.g., macOS `/private/var` vs `/var`) | Test resolves both `dirPath` and the target through `fs.realpathSync` before comparison so the check operates on canonicalized forms. |
| `escapePipe` wraps a value that is already part of a Markdown structure (rare) | Applied only at final interpolation into pipe-table rows; does not touch header rows, separator rows, or bullet lists. Regression tests cover the intended call sites. |
| M1 "won't-fix" decision hides a latent bug if the schema ever permits falsy `received_from` | Schema is now explicitly documented as `non-empty string \| null` in README. If deep-evolve ever changes this, action-router, formatter, and fixtures must be updated together as a single change. |

## Out of Scope (deferred)

- Version bump + CHANGELOG entry for `v1.1.1` — a separate release commit after this PR lands.
- `centerLine` full-width / emoji character handling (W-5) — no current caller triggers it; tracked as a known limitation in commit 2.
- Broader defensive gardening (e.g., null-guarding every field in every formatter) — only the 10 enumerated issues.
- Expanded TS detection (W-1: sniffing `devDependencies.typescript` without `tsconfig.json`) — intentionally not added; the narrow check is the intended fix.
- Claude Code plugin runtime env var verification for the skill command — follow-up after primary docs sweep.
- Any refactoring (extract helpers beyond `escapePipe`, consolidate stripAnsi usage, etc.) — belongs in a follow-up if desired.
