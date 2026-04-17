# Ultrareview Fixes — Design Spec

**Date**: 2026-04-17
**Target version**: deep-dashboard v1.1.1 (patch)
**Scope**: Fix 10 issues identified in the 2026-04-17 ultrareview report.
**Branch**: `fix/ultrareview-v1.1.1`

**Revision history**:
- Rev 1 (commit `d9e91e0`): initial spec.
- Rev 2 (commit `0b51257`): incorporated first deep-review feedback (`.deep-review/reports/2026-04-17-142904-review.md`). Accepted 7 items (C-1, C-2, C-3, C-5, W-2, W-3, W-4), partial-accepted W-1, deferred W-5, rejected review-finding **C-4 (meta_archive_updated preservation)** as moot — Path A for C-3 meant action-router.js was no longer edited, so the preservation concern became vacuous. (This is distinct from the ultrareview's own "C-4" — that one, the README effectiveness weight table, is addressed by commit 5.)
- Rev 3 (this commit): incorporates re-review feedback (`.deep-review/reports/2026-04-17-145458-review.md`). Fixed three verifiable technical defects introduced by Rev 2 (P-1 skill command, P-2 `test.skipIf`, P-3 prefix bypass) and four polish issues (N-1…N-4). See `.deep-review/responses/2026-04-17-150211-response.md`.

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

All work lands on a single feature branch `fix/ultrareview-v1.1.1` branched from `main`. One PR at the end. **All code-file references are symbolic (function / section names) — line numbers are not cited and should not drift-check the spec.**

### Commit 1 — `fix(scorer): correct TS detection and filter NA from recommendations`

Addresses: **C1, C2**.

**Files**: `lib/harnessability/scorer.js`, `lib/harnessability/scorer.test.js`.

**Changes**:
- In `scoreHarnessability`: replace the `isTypeScript` heuristic `exists(root, 'tsconfig.json') || exists(root, 'package.json')` with `exists(root, 'tsconfig.json')`. Rationale: `package.json` is present in every Node project regardless of TS usage; including it forces TS-only checks onto pure-JS and Python-with-frontend projects. Intentional narrowing — a JS project that wants TS-specific scoring should add a `tsconfig.json`. This intent will be called out in the PR body.
- In the recommendation loop inside `scoreHarnessability`: change the inner guard from `if (!chk.passed)` to `if (!chk.passed && !chk.not_applicable)`. Rationale: not-applicable checks have `passed: false` by convention; without this guard, a low-scoring dimension emits recommendations like "enable Python type hints" to TypeScript projects.

**New tests** (2):
- "JS-only project (package.json without tsconfig.json) does not apply TS-only checks"
- "low-scoring type_safety dimension in TS project does NOT emit Python recommendations"

### Commit 2 — `fix(formatter): guard undefined fields and escape markdown pipes`

Addresses: **H1, H2** (plus related fixes: `centerLine` width, NaN in `q_trajectory`).

**Files**: `lib/dashboard/formatter.js`, `lib/dashboard/formatter.test.js`.

**Changes**:
- In `centerLine`: use `stripAnsi(text).length` for width calculation. Rationale: all other width-sensitive helpers already strip ANSI; `centerLine` is an outlier that would throw `RangeError` if an ANSI-colored title is ever passed. Known limitation: width math still assumes ASCII cell width — full-width or emoji characters would still misalign. No current caller passes such strings; documented as a future item, not fixed here.
- In `renderHealth`: guard `h.type` and `h.summary` with `?? ''` before passing to `pad`. Rationale: `pad` calls `.replace(...)` on its input; `undefined.replace` throws.
- In `renderActions` (CLI path): guard `actions[i].suggested_action` with `?? ''`. The Markdown equivalent (the `- **${a.finding}**: ${a.suggested_action}` bullet list) likewise guards `a.finding` and `a.suggested_action`.
- In `renderEvolveCLI` / `renderEvolveMarkdown`: before calling `.toFixed(2)` on a `q_trajectory` element, check `typeof === 'number' && !Number.isNaN(x)`; otherwise render `'?'`.
- Introduce helper `escapePipe = (s) => String(s ?? '').replace(/\|/g, '\\|')` and apply it to **every interpolated cell in every Markdown table**. Specifically:
  - Health Status row: `| ${h.type} | ${icon} ${h.status} | ${detail} |`
  - Fitness Rules row: `| ${f.ruleId} | ${result} | ${violations} |`
  - Recent Sessions row: `| ${s.id} | ${s.date} | ${s.quality} | ${s.sensors ?? '-'} | ${s.mutation ?? '-'} |`
  - Evolve table rows inside `renderEvolveMarkdown`: Experiments, Improvement, Strategy Evolution, Archives, Transfer (`transfer.received_from` especially likely to contain `|`), and Quality Score cells.
  - Bullet list (`- **${a.finding}**: ${a.suggested_action}`) does **not** need pipe escaping (not a pipe table). Keep the undefined-guard only.

**New tests** (3):
- "renderHealth does not throw when health entry lacks `type`"
- "formatMarkdown escapes literal `|` in finding strings, session sensors/mutation, and transfer.received_from"
- "renderEvolveCLI emits `?` (not `NaN`) when q_trajectory contains NaN"

### Commit 3 — `test(action-router): pin boundary behavior for keep_rate and crash_rate`

Addresses: **M2**. (M1 closed as won't-fix — see below.)

**Files**: `lib/dashboard/action-router.test.js`.

**Changes**:
- No code changes. This commit adds regression tests only.
- Decision on **M1** (evolve-no-transfer on falsy `received_from`): **closed as won't-fix**. Rationale: consumer inconsistency — the formatter's transfer row uses `if (transfer?.received_from)` truthiness, so changing only the action-router would suppress the router finding while the formatter still hides the transfer row, creating a silent false-negative. The `received_from` schema is now explicitly documented as `non-empty string | null` (see commit 5). Under that schema, `0` and `""` cannot occur, so the original M1 report describes an unreachable state.
- **Threshold decision**: both `keep_rate < 0.15` and `crash_rate > 0.2` remain strict (exclusive). Projects at exactly 15% / 20% are treated as acceptable. This aligns with the intuitive "worse than X%" UX convention used by the deep-evolve receipt schema. The new tests codify the boundary to prevent an accidental sign flip in future refactors.

**New tests** (2):
- "evolve-low-keep does NOT fire at exactly keep_rate = 0.15" (boundary)
- "evolve-high-crash does NOT fire at exactly crash_rate = 0.20" (boundary)

### Commit 4 — `fix(collector): follow symlinks safely within project boundary`

Addresses: **H3**.

**Files**: `lib/dashboard/collector.js`, `lib/dashboard/collector.test.js`.

**Changes**:
- In `readJsonDir`: replace `if (!entry.isFile()) continue;` with:
  1. Accept `entry.isFile()` outright.
  2. For `entry.isSymbolicLink()`, resolve both the scan directory and the entry via `fs.realpathSync`. Then containment-check using `path.relative`:
     ```js
     const resolvedScanDir = fs.realpathSync(dirPath);
     const resolvedTarget  = fs.realpathSync(path.join(dirPath, entry.name));
     const rel = path.relative(resolvedScanDir, resolvedTarget);
     const outOfBoundary = rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
     if (outOfBoundary) { /* skip + warn */ }
     else if (fs.statSync(resolvedTarget).isFile()) { /* accept */ }
     ```
     This avoids the `startsWith` prefix-bypass (e.g. `/tmp/receipts-old/...` no longer passes a `/tmp/receipts` check) and also handles macOS `/private/var` canonicalization because both sides are realpath'd.
  3. Broken symlinks (`ENOENT` thrown by `realpathSync`/`statSync`) skip with a warning, not silently.
- Warnings via `console.warn` with prefix `[deep-dashboard/collector]`.
- Rationale: without containment, a repository-local symlink can cause the dashboard to ingest arbitrary JSON from anywhere on disk the current user can read, breaking the "project-rooted data" invariant.

**New tests** (4):
- "readJsonDir loads JSON content when the entry is a symbolic link to a regular file within the same directory"
- "readJsonDir rejects a symlink whose target resolves OUTSIDE the scanned directory" (general out-of-tree case)
- "readJsonDir rejects a symlink whose target sits in a SIBLING directory with a shared prefix" (P-3 regression — e.g. scan `tmp/recv`, symlink points to `tmp/recv-old/foo.json`)
- "readJsonDir skips a broken symlink with a warning"

**Windows skip mechanism**: use the supported `node:test` option form — `test('...', { skip: noSymlinkPriv ? 'no symlink privilege' : false }, fn)` where `noSymlinkPriv` is probed once at suite setup by attempting a no-op `fs.symlinkSync` under `os.tmpdir()` inside try/catch. The `{ skip }` option is the documented API; `test.skipIf` does NOT exist in `node:test`.

### Commit 5 — `docs: sync weights, version, architecture, skill command, and received_from schema`

Addresses: **C3, C4, L1, L2, L3, L4** (ultrareview labels) + schema documentation supporting commit 3's won't-fix on M1.

**Files**: `.claude-plugin/plugin.json`, `README.md`, `README.ko.md`, `CHANGELOG.md`, `CHANGELOG.ko.md`, `skills/deep-harnessability.md`, `skills/deep-harness-dashboard.md` (if affected).

**Pre-commit verification step** (required before committing):
- Consult `claude-code-guide` subagent to verify the exact env-var name Claude Code injects for a plugin's installation directory. Candidates: `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DIR}`, or other. Do the same for the user's project directory (likely `${CLAUDE_PROJECT_DIR}` but verify).
- If verification succeeds: use the confirmed variables directly in the skill command.
- If verification fails or is inconclusive: ship `scripts/run-scorer.sh` in the plugin — a tiny wrapper that self-resolves its own directory via `$(dirname "$0")` and invokes the scorer with the first arg as project root. The skill then calls `bash "PLUGIN_SELF/scripts/run-scorer.sh" "$PROJECT"`, and `PLUGIN_SELF` either uses the verified env var or is replaced at plugin-install time. Either way, the skill command is NOT `./lib/...` — that form breaks for any user whose CWD is not the plugin repo.

**Changes**:

| Target | Change |
|---|---|
| `plugin.json` | `"version": "1.0.0"` → `"version": "1.1.0"` (match `package.json`). This is a catch-up, not a new release. |
| `README.md` / `README.ko.md` effectiveness table | Replace the 4-row table with the correct 5-row table: health 25%, fitness 20%, session 20%, harnessability 15%, evolve 20% (sums to 100%). |
| `README.md` / `README.ko.md` architecture diagram | Add `deep-evolve` as a fourth input arrow. |
| `README.md` evolve section | Translate Korean fragments ("권장", "점검", "검토") into English. `README.ko.md` unchanged. |
| `README.md` / `README.ko.md` evolve section | Add explicit schema note: `transfer.received_from: non-empty string \| null`. Empty-string or numeric sentinels are not part of the schema. |
| `skills/deep-harnessability.md` | Replace `PLUGIN_DIR`/`PROJECT_ROOT` literals with the verified env-var form (or the `scripts/run-scorer.sh` shim — see pre-commit step). |
| `CHANGELOG.md` / `CHANGELOG.ko.md` | Clarify `evolve-low-q` description: "the earliest of the last-3 Q(v) values is more than 0.05 above the most recent (i.e., the recent 3-point window is trending down)". |
| `README.md` / `README.ko.md` evolve section | Same `evolve-low-q` clarification as above. |

**No tests** — pure documentation/manifest.

## Test Strategy

- **TDD per code commit**: for commits 1, 2, 4, each new test is added in the same commit as the fix. The test must fail against the pre-fix code and pass against the fixed code.
- Commit 3 is pure test-only; tests characterize the decision (strict thresholds) and must pass against current code.
- Test isolation: any filesystem-touching test (commit 4) uses `os.tmpdir()` and cleans up. Windows symlink tests use the `{ skip: noSymlinkPriv }` option form (not `test.skipIf`, which does not exist).
- After each commit: `npm test` must pass with strictly more passing tests than before (no regressions, at least one new test per code commit).
- After commit 5: `npm test` total count unchanged from commit 4 (docs-only).
- **Expected final delta: 11 new tests** on top of existing 45 (total 56). Breakdown: commit 1 = 2, commit 2 = 3, commit 3 = 2, commit 4 = 4.

## Validation Plan

Before opening the PR:

1. `npm test` — all tests pass, counts match expectation (56 total).
2. `git log --oneline main..HEAD` — five commits in the order described, no fixup/amend noise.
3. Manual spot-check:
   - A throwaway JS-only project (has `package.json`, no `tsconfig.json`) — recommendations should no longer list TS items.
   - `README.md` / `README.ko.md` — effectiveness weight table has 5 rows summing to 100%, architecture diagram includes `deep-evolve`.
   - `jq .version .claude-plugin/plugin.json package.json` — both report `1.1.0`.
   - `/deep-harnessability` invoked from a throwaway project directory — resolves the scorer correctly (no `./lib/...` failure). This verifies commit 5's skill command change in its real runtime.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Claude Code plugin-root env var name is unknown / different across versions | Commit 5 pre-commit step verifies via `claude-code-guide`. If inconclusive, ships `scripts/run-scorer.sh` shim which is self-resolving and version-independent. Either path produces a working skill command. |
| Symlink test is platform-specific (Windows) | Use `test('...', { skip: noSymlinkPriv ? 'reason' : false }, fn)` — the documented `node:test` option form. Probe `noSymlinkPriv` once at setup via a try/catch around a no-op `symlinkSync` attempt. |
| Realpath containment rejects a legitimate in-directory symlink in an edge case (e.g., macOS `/private/var` vs `/var`) | Canonicalize both the scan dir and the target via `fs.realpathSync` before computing `path.relative`. This handles the macOS aliasing and any dirPath that is itself a symlink. |
| Prefix-bypass bug reintroduced in future refactor | Dedicated regression test "symlink whose target sits in a SIBLING directory with a shared prefix" pins the correct behavior. |
| `escapePipe` wraps a value that is already part of a Markdown structure (rare) | Applied only at final interpolation into pipe-table cells; does not touch header rows, separator rows, or bullet lists. Regression tests cover the intended call sites. |
| M1 "won't-fix" decision hides a latent bug if the schema ever permits falsy `received_from` | Schema is explicitly documented as `non-empty string \| null` in README. If deep-evolve ever changes this, action-router, formatter, and fixtures must be updated together. |

## Out of Scope (deferred)

- Version bump + CHANGELOG release entry for `v1.1.1` — a separate release commit after this PR lands.
- `centerLine` full-width / emoji character handling (W-5) — no current caller triggers it; tracked as a known limitation in commit 2.
- Broader defensive gardening (null-guarding every field in every formatter) — only the 10 enumerated issues.
- Expanded TS detection (W-1: sniffing `devDependencies.typescript` without `tsconfig.json`) — intentionally not added; the narrow check is the intended fix.
- Any refactoring (extract helpers beyond `escapePipe`, consolidate stripAnsi usage, etc.) — belongs in a follow-up if desired.
