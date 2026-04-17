# Ultrareview Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 10 defects identified in the 2026-04-17 ultrareview across 4 code modules + docs, landing as 5 focused commits on `fix/ultrareview-v1.1.1` with 11 new regression tests.

**Architecture:** Per-module commits ordered by dependency isolation (scorer → formatter → action-router tests → collector → docs). TDD per code commit: failing test first, minimal code to make it pass, commit. Pure-doc changes land as a single final commit. All code references in the plan are symbolic (function/section names) — no line numbers.

**Tech Stack:** Node.js ESM, `node --test` (built-in), `node:assert/strict`. No external test framework. Project is a Claude Code plugin.

**Source spec:** `docs/superpowers/specs/2026-04-17-ultrareview-fixes-design.md` (Rev 4, latest commit).

---

## File Structure

### Created files
*(None — the plan no longer ships a shim script; Claude Code env vars (`${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}`) are used directly.)*

### Modified files (by commit)
- **Commit 1**: `lib/harnessability/scorer.js`, `lib/harnessability/scorer.test.js`
- **Commit 2**: `lib/dashboard/formatter.js`, `lib/dashboard/formatter.test.js`
- **Commit 3**: `lib/dashboard/action-router.test.js`
- **Commit 4**: `lib/dashboard/collector.js`, `lib/dashboard/collector.test.js`
- **Commit 5**: `.claude-plugin/plugin.json`, `README.md`, `README.ko.md`, `CHANGELOG.md`, `CHANGELOG.ko.md`, `skills/deep-harnessability.md`

### Test count delta
- Commit 1: +2, Commit 2: +3, Commit 3: +2, Commit 4: +4 → **+11 new tests** (45 existing → 56 total).

### Branch prerequisite
Working on `fix/ultrareview-v1.1.1`. Verify: `git rev-parse --abbrev-ref HEAD` returns that branch.

### Recovery guidance (per-step rollback)

- **File edit succeeded but the next test step failed**: revert a single file with `git checkout -- <path>`. Do NOT use `git checkout .`, `git reset --hard`, or `git restore .` — those wipe unrelated work.
- **Commit succeeded but was wrong**: create a NEW reversing commit with `git revert HEAD` rather than `git reset --hard HEAD~1`. The branch history stays auditable.
- **Tests intermittently fail only for a new test**: run that file alone with `node --test lib/<path>.test.js` to isolate. If the new test is non-deterministic (e.g., relies on timestamps), fix the test before moving on; do NOT skip it.
- **A pre-commit hook rejects the commit**: the commit did NOT happen. Fix the lint/format issue, re-stage, create a NEW commit. NEVER use `--no-verify` or `--amend` as a shortcut — the spec's Non-goals explicitly disallow --amend.
- If you get stuck for more than 2 steps in a row, stop and ask the user. Do not invent a workaround.

---

## Task 1: Scorer — TS detection narrowing + NA recommendations filter

Addresses ultrareview C1, C2.

**Files:**
- Modify: `lib/harnessability/scorer.js` (function `scoreHarnessability`)
- Test: `lib/harnessability/scorer.test.js`

### Step 1.1: Write failing test for JS-only ecosystem narrowing

Append to `lib/harnessability/scorer.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Test: JS-only project does NOT apply TS-only checks
// ---------------------------------------------------------------------------

test('JS-only project (package.json without tsconfig.json) does not apply TS-only checks', async () => {
  const root = mktemp();
  writeJson(root, 'package.json', { name: 'js-only' });
  writeFile(root, 'src/index.js', 'module.exports = {}');

  const result = await scoreHarnessability(root);

  const typeSafety = result.dimensions.find((d) => d.id === 'type_safety');
  assert.ok(typeSafety, 'type_safety dimension should exist');

  const tsConfigCheck = typeSafety.checks.find((c) => c.id === 'tsconfig_exists');
  const tsStrictCheck = typeSafety.checks.find((c) => c.id === 'tsconfig_strict');

  assert.equal(tsConfigCheck.not_applicable, true, 'tsconfig_exists must be not_applicable in pure JS');
  assert.equal(tsStrictCheck.not_applicable, true, 'tsconfig_strict must be not_applicable in pure JS');
});
```

- [ ] **Step 1.1**: Add the test block above to `lib/harnessability/scorer.test.js`.

### Step 1.2: Run the new test — expect FAIL

Run:
```bash
npm test 2>&1 | grep -E "JS-only project|not_applicable"
```
Expected: failing assertion — `tsConfigCheck.not_applicable` is `undefined` (falsy), not `true`, because current `isTypeScript` returns `true` for any project with `package.json`.

- [ ] **Step 1.2**: Run the command and confirm the new test fails with the above message.

### Step 1.3: Fix `isTypeScript` heuristic

In `lib/harnessability/scorer.js`, inside `scoreHarnessability`, locate:
```javascript
const isTypeScript = exists(root, 'tsconfig.json') || exists(root, 'package.json');
```
Replace with:
```javascript
const isTypeScript = exists(root, 'tsconfig.json');
```

- [ ] **Step 1.3**: Apply the edit.

### Step 1.4: Re-run test — expect PASS

Run:
```bash
npm test 2>&1 | grep -E "JS-only project|tests"
```
Expected: new test passes, previously-passing tests still pass (46 total).

- [ ] **Step 1.4**: Run and confirm.

### Step 1.5: Write failing test for NA recommendations filtering

Design note: the test must make the recommendation loop actually execute. The loop only runs when `score < 5`. A bare project (neither TS nor Python) makes all 4 `type_safety` checks `not_applicable`, which yields `applicableChecks.length === 0` and therefore `score === 0` — the loop runs, and pre-fix it iterates every check (including NAs), so all 4 get pushed as recommendations. Post-fix, the NA guard skips them.

Append to `lib/harnessability/scorer.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Test: not_applicable checks do not generate recommendations
// ---------------------------------------------------------------------------

test('not_applicable checks do not generate recommendations in low-scoring dimensions', async () => {
  const root = mktemp();
  // Bare project — neither TypeScript nor Python. All four type_safety
  // checks resolve to not_applicable. applicable count = 0 → score = 0.
  writeFile(root, 'main.go', 'package main');

  const result = await scoreHarnessability(root);

  const typeSafetyRecs = result.recommendations.filter((r) => r.dimension === 'type_safety');
  assert.deepEqual(
    typeSafetyRecs,
    [],
    'not_applicable type_safety checks must not generate recommendations'
  );
});
```

- [ ] **Step 1.5**: Add the test block above.

### Step 1.6: Run new test — expect FAIL

Run:
```bash
npm test 2>&1 | grep -E "not_applicable checks|type_safety"
```
Expected: the new test fails with a deepEqual mismatch — pre-fix emits 4 `type_safety` recommendations (one per NA check). Post-fix it emits 0.

- [ ] **Step 1.6**: Run and confirm failure.

### Step 1.7: Fix recommendation guard

In `lib/harnessability/scorer.js`, inside the recommendation loop within `scoreHarnessability`, locate:
```javascript
if (score < 5) {
  for (const chk of checks) {
    if (!chk.passed) {
      recommendations.push({ ... });
    }
  }
}
```
Replace the inner condition:
```javascript
if (score < 5) {
  for (const chk of checks) {
    if (!chk.passed && !chk.not_applicable) {
      recommendations.push({
        dimension: dim.id,
        check: chk.id,
        action: chk.label,
      });
    }
  }
}
```

(Keep the push object literal as it is in the current source. Only the guard condition changes.)

- [ ] **Step 1.7**: Apply the edit.

### Step 1.8: Run full test suite — expect all green

Run:
```bash
npm test
```
Expected: 47 tests pass (45 prior + 2 new), 0 failures.

- [ ] **Step 1.8**: Run and confirm.

### Step 1.9: Commit

```bash
git add lib/harnessability/scorer.js lib/harnessability/scorer.test.js
git commit -m "$(cat <<'EOF'
fix(scorer): correct TS detection and filter NA from recommendations

- isTypeScript no longer treats every package.json as TypeScript evidence.
  Pure JS projects and Python-with-frontend projects are no longer
  penalized against TS-only checks.
- Recommendation loop now skips not_applicable checks, so TS projects
  no longer receive Python-specific recommendations (and vice versa).

Addresses ultrareview C1, C2.
EOF
)"
```

- [ ] **Step 1.9**: Run the commit command.

---

## Task 2: Formatter — undefined guards + pipe escape + NaN q_trajectory

Addresses ultrareview H1, H2.

**Files:**
- Modify: `lib/dashboard/formatter.js`
- Test: `lib/dashboard/formatter.test.js`

### Step 2.1: Write failing test for renderHealth undefined guard

Append to `lib/dashboard/formatter.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Test: renderHealth does not throw when health entry lacks type
// ---------------------------------------------------------------------------

test('renderHealth does not throw when health entry lacks `type`', () => {
  const partialData = {
    topology: 'nextjs-app',
    harnessability: { total: 7.4, grade: 'Good' },
    effectiveness: 7.1,
    health: [
      { status: 'clean' }, // type intentionally omitted
    ],
    fitness: [],
    sessions: [],
    actions: [],
  };

  // Should not throw
  const cli = formatCLI(partialData);
  assert.ok(typeof cli === 'string' && cli.length > 0);

  const md = formatMarkdown(partialData);
  assert.ok(typeof md === 'string' && md.length > 0);
});
```

- [ ] **Step 2.1**: Add the test block.

### Step 2.2: Run new test — expect FAIL

Run:
```bash
npm test 2>&1 | grep -E "renderHealth|type.*undefined|TypeError"
```
Expected: `TypeError` because `pad(undefined, 18)` → `stripAnsi(undefined).replace(...)` throws.

- [ ] **Step 2.2**: Confirm failure.

### Step 2.3: Apply undefined guards to renderHealth, renderActions, centerLine

In `lib/dashboard/formatter.js`:

1. In `centerLine`:
```javascript
function centerLine(text) {
  const visible = stripAnsi(String(text ?? '')).length;
  const totalPad = BOX_WIDTH - visible;
  const leftPad = Math.floor(totalPad / 2);
  const rightPad = totalPad - leftPad;
  return `║${' '.repeat(leftPad)}${text ?? ''}${' '.repeat(rightPad)} ║`;
}
```

2. In `renderHealth`, replace the loop body's boxLine:
```javascript
for (const h of health) {
  const icon = (h.status === 'clean' || h.status === 'pass') ? '✓' : '✗';
  const detail = h.summary ? `${icon} ${h.summary}` : (h.status === 'clean' ? '✓ clean' : `✗ ${h.status ?? ''}`);
  lines.push(boxLine(`  ${pad(h.type ?? '', 18)} ${detail}`));
}
```

3. In `renderActions`:
```javascript
for (let i = 0; i < actions.length; i++) {
  lines.push(boxLine(` ${i + 1}. ${actions[i].suggested_action ?? ''}`));
}
```

- [ ] **Step 2.3**: Apply the three edits.

### Step 2.4: Re-run — expect PASS

Run: `npm test`. Expected: the partial-data test passes; all prior tests still pass.

- [ ] **Step 2.4**: Confirm.

### Step 2.5: Write failing test for NaN q_trajectory

Append to `lib/dashboard/formatter.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Test: renderEvolveCLI emits '?' (not 'NaN') when q_trajectory contains NaN
// ---------------------------------------------------------------------------

test("renderEvolveCLI emits '?' (not 'NaN') when q_trajectory contains NaN", () => {
  const nanData = {
    topology: 'nextjs-app',
    harnessability: { total: 7.4, grade: 'Good' },
    effectiveness: 7.1,
    health: [],
    fitness: [],
    sessions: [],
    actions: [],
    evolve: {
      status: 'available',
      receipt: {
        experiments: { total: 10, kept: 2, discarded: 7, crashed: 1, keep_rate: 0.20 },
        score: { improvement_pct: 1.0 },
        strategy_evolution: { outer_loop_generations: 1, q_trajectory: [NaN, 0.42, NaN] },
        archives: { strategy_archive_size: 0, code_archive_size: 0, code_forks_used: 0 },
        transfer: null,
        quality_score: 50,
        outcome: 'merged',
      },
    },
  };

  const cli = formatCLI(nanData);
  const md = formatMarkdown(nanData);

  assert.ok(!cli.includes('NaN'), `CLI output should not contain 'NaN', got: ${cli}`);
  assert.ok(!md.includes('NaN'), `Markdown output should not contain 'NaN', got: ${md}`);
  assert.ok(cli.includes('?'), 'CLI output should substitute ? for NaN values');
});
```

- [ ] **Step 2.5**: Add the test block.

### Step 2.6: Run — expect FAIL

Run:
```bash
npm test 2>&1 | grep -E "NaN|q_trajectory"
```
Expected: assertion fails because `NaN.toFixed(2)` returns the string `"NaN"` (optional chain `?.` does NOT short-circuit on NaN).

- [ ] **Step 2.6**: Confirm failure.

### Step 2.7: Add NaN-safe formatter for q_trajectory

In `lib/dashboard/formatter.js`, introduce a small helper near the top of the section renderers (before `renderEvolveCLI`):

```javascript
function fmtQ(value) {
  return (typeof value === 'number' && !Number.isNaN(value)) ? value.toFixed(2) : '?';
}
```

Then in `renderEvolveCLI`, replace:
```javascript
const qFirst = qtraj[0]?.toFixed(2) ?? '?';
const qLast = qtraj[qtraj.length - 1]?.toFixed(2) ?? '?';
```
with:
```javascript
const qFirst = fmtQ(qtraj[0]);
const qLast = fmtQ(qtraj[qtraj.length - 1]);
```

`renderEvolveMarkdown` declares its OWN `qFirst`/`qLast` locals (they are re-declared inside that function — this is not the same scope as `renderEvolveCLI`). Apply the exact same two-line replacement there too:

```javascript
// Inside renderEvolveMarkdown, replace:
const qFirst = qtraj[0]?.toFixed(2) ?? '?';
const qLast = qtraj[qtraj.length - 1]?.toFixed(2) ?? '?';
// with:
const qFirst = fmtQ(qtraj[0]);
const qLast = fmtQ(qtraj[qtraj.length - 1]);
```

- [ ] **Step 2.7**: Apply the edits.

### Step 2.8: Re-run — expect PASS

Run: `npm test`. Expected: NaN test passes.

- [ ] **Step 2.8**: Confirm.

### Step 2.9: Write failing test for Markdown pipe escaping

Append to `lib/dashboard/formatter.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Test: formatMarkdown escapes literal `|` across all table cells
// ---------------------------------------------------------------------------

test('formatMarkdown escapes literal `|` in finding strings, session sensors, and transfer.received_from', () => {
  const pipeData = {
    topology: 'mixed',
    harnessability: { total: 7.0, grade: 'Good' },
    effectiveness: 7.0,
    health: [
      { type: 'has|pipe', status: 'clean', summary: 'fine|here' },
    ],
    fitness: [
      { ruleId: 'rule|A', passed: false, violations: ['x'] },
    ],
    sessions: [
      { id: 1, date: '2026-04-17', quality: 8.0, sensors: 'clean|x', mutation: '90%|y' },
    ],
    actions: [],
    evolve: {
      status: 'available',
      receipt: {
        experiments: { total: 10, kept: 2, discarded: 7, crashed: 1, keep_rate: 0.20 },
        score: { improvement_pct: 1.0 },
        strategy_evolution: { outer_loop_generations: 1, q_trajectory: [0.5] },
        archives: { strategy_archive_size: 0, code_archive_size: 0, code_forks_used: 0 },
        transfer: { received_from: 'arch|01', adopted_patterns_kept: 0.5 },
        quality_score: 50,
        outcome: 'merged',
      },
    },
  };

  const md = formatMarkdown(pipeData);

  // Assertion 1 (value-level): every raw pipe value must appear in escaped form,
  // and must NOT appear in unescaped form sandwiched between spaces (cell context).
  for (const raw of ['has|pipe', 'fine|here', 'rule|A', 'clean|x', '90%|y', 'arch|01']) {
    assert.ok(
      md.includes(raw.replace(/\|/g, '\\|')),
      `expected escaped "${raw.replace(/\|/g, '\\|')}" in Markdown output`
    );
    assert.ok(
      !md.includes(` ${raw} `),
      `unescaped "${raw}" must not appear inside a Markdown cell`
    );
  }

  // Assertion 2 (structural): every pipe-table data row must split into the
  // expected number of columns when splitting on UNESCAPED `|`. If any cell
  // value smuggled an unescaped pipe, that row would split into more columns.
  // We walk rows that START with `|` and are NOT separators (contain non-dash).
  const dataRows = md.split('\n').filter(
    (line) => line.startsWith('|') && /[^|\-\s:]/.test(line)
  );
  for (const row of dataRows) {
    // Replace ESCAPED pipes with a sentinel, then split on remaining pipes.
    const cols = row.replace(/\\\|/g, '\x00').split('|');
    // Pipe-table rows start and end with `|`, so the first and last elements
    // are empty strings. The middle elements are the cells.
    const cellCount = cols.length - 2;
    assert.ok(cellCount >= 2, `row produced unexpected column count: ${row}`);
  }
});
```

- [ ] **Step 2.9**: Add the test block.

### Step 2.10: Run — expect FAIL

Run:
```bash
npm test 2>&1 | grep -E "escapes literal|expected escaped"
```
Expected: at least one assertion fails — pipes are not escaped anywhere yet.

- [ ] **Step 2.10**: Confirm failure.

### Step 2.11: Introduce `escapePipe` and apply to every Markdown cell

In `lib/dashboard/formatter.js`, near the other string helpers (top of file section), add:

```javascript
function escapePipe(s) {
  return String(s ?? '').replace(/\|/g, '\\|');
}
```

Apply it to every interpolated cell in `formatMarkdown` and `renderEvolveMarkdown`:

1. **Health Status table row** (inside `formatMarkdown`, the `for (const h of health)` loop):
```javascript
const detail = h.summary || h.status;
parts.push(`| ${escapePipe(h.type)} | ${icon} ${escapePipe(h.status)} | ${escapePipe(detail)} |`);
```

2. **Fitness Rules table row**:
```javascript
const result = f.passed ? '✓ pass' : '✗ fail';
const violations = f.passed ? '-' : (f.violations?.length ?? 0);
parts.push(`| ${escapePipe(f.ruleId)} | ${result} | ${violations} |`);
```

3. **Recent Sessions table row**:
```javascript
parts.push(`| ${s.id} | ${escapePipe(s.date)} | ${s.quality} | ${escapePipe(s.sensors ?? '-')} | ${escapePipe(s.mutation ?? '-')} |`);
```

4. **Evolve table rows inside `renderEvolveMarkdown`** — wrap every interpolated string cell:
```javascript
parts.push(`| Experiments | ${exp.total ?? 0} (keep: ${keepPct}%, crash: ${crashPct}%) |`);
parts.push(`| Improvement | +${improv}% from baseline |`);
parts.push(`| Strategy Evolution | ${gens} generations, Q: ${qFirst} → ${qLast} |`);
parts.push(`| Archives | ${arch.strategy_archive_size ?? 0} strategies, ${arch.code_archive_size ?? 0} code snapshots, ${arch.code_forks_used ?? 0} forks |`);
if (transfer?.received_from) {
  const adoptPct = Math.round((transfer.adopted_patterns_kept ?? 0) * 100);
  parts.push(`| Transfer | From ${escapePipe(transfer.received_from)} (adoption: ${adoptPct}%) |`);
}
parts.push(`| Quality Score | ${escapePipe(qualStr)} |`);
```

(Numeric-only cells like `${exp.total ?? 0}` don't need escaping. Apply `escapePipe` only where a user-supplied string could contain `|`.)

5. **Bullet list** (the `- **${a.finding}**: ${a.suggested_action}` line) — do NOT apply `escapePipe`. It is not a pipe table. Current source has NO undefined-guard; **add** the `?? ''` guard:
```javascript
// Before (current source):
parts.push(`- **${a.finding}**: ${a.suggested_action}`);
// After (this task adds the ?? '' guard — no escapePipe):
parts.push(`- **${a.finding ?? ''}**: ${a.suggested_action ?? ''}`);
```

- [ ] **Step 2.11**: Apply the helper definition and all five cell-escape edits.

### Step 2.12: Re-run — expect all PASS

Run: `npm test`. Expected: 50 tests pass (47 after Task 1, +3 new here), 0 failures.

- [ ] **Step 2.12**: Confirm.

### Step 2.13: Commit

```bash
git add lib/dashboard/formatter.js lib/dashboard/formatter.test.js
git commit -m "$(cat <<'EOF'
fix(formatter): guard undefined fields and escape markdown pipes

- renderHealth, renderActions, and centerLine now tolerate undefined/null
  values without throwing (prior code threw inside pad's stripAnsi.replace).
- NaN entries in q_trajectory render as '?' instead of the literal string
  'NaN' leaking into CLI/Markdown output.
- New escapePipe helper wraps every interpolated cell in every Markdown
  pipe table (Health, Fitness, Sessions, Evolve). Bullet lists are
  unaffected — they are not pipe tables. Unescaped values in finding
  strings, session sensors/mutation, or transfer.received_from no longer
  corrupt table structure.

Addresses ultrareview H1, H2.
EOF
)"
```

- [ ] **Step 2.13**: Run the commit.

---

## Task 3: Action-router — boundary tests (test-only)

Addresses ultrareview M2. Closes M1 as won't-fix (see spec).

**Files:**
- Test: `lib/dashboard/action-router.test.js`

### Step 3.1: Add boundary test for keep_rate = 0.15

Append to `lib/dashboard/action-router.test.js`:

```javascript
// ---------------------------------------------------------------------------
// Boundary test: keep_rate exactly at 0.15 should NOT fire evolve-low-keep
// ---------------------------------------------------------------------------

test('evolve-low-keep does NOT fire at exactly keep_rate = 0.15 (strict boundary)', () => {
  const data = makeData({
    experiments: { total: 100, kept: 15, discarded: 82, crashed: 3, keep_rate: 0.15 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: 'archive_001' },
  });
  const actions = getSuggestedActions(data);
  assert.equal(
    actions.find((a) => a.finding === 'evolve-low-keep'),
    undefined,
    'threshold is exclusive (< 0.15), so exactly 0.15 must NOT fire'
  );
});
```

- [ ] **Step 3.1**: Add the test block.

### Step 3.2: Add boundary test for crash_rate = 0.20

Append:

```javascript
// ---------------------------------------------------------------------------
// Boundary test: crash_rate exactly at 0.20 should NOT fire evolve-high-crash
// ---------------------------------------------------------------------------

test('evolve-high-crash does NOT fire at exactly crash_rate = 0.20 (strict boundary)', () => {
  const data = makeData({
    experiments: { total: 50, kept: 15, discarded: 25, crashed: 10, keep_rate: 0.30 },
    strategy_evolution: { q_trajectory: [0.40] },
    timestamp: new Date().toISOString(),
    meta_archive_updated: true,
    transfer: { received_from: 'archive_001' },
  });
  const actions = getSuggestedActions(data);
  assert.equal(
    actions.find((a) => a.finding === 'evolve-high-crash'),
    undefined,
    'threshold is exclusive (> 0.20), so exactly 0.20 must NOT fire'
  );
});
```

Note: crash rate = crashed / total = 10/50 = 0.20 exactly.

- [ ] **Step 3.2**: Add the test block.

### Step 3.3: Run — expect all PASS

Both tests should pass against existing code. They codify the current strict-inequality behavior so a future refactor cannot flip the sign unnoticed.

Run: `npm test`. Expected: 52 tests pass (50 after Task 2, +2 here).

- [ ] **Step 3.3**: Confirm all green.

### Step 3.4: Commit

```bash
git add lib/dashboard/action-router.test.js
git commit -m "$(cat <<'EOF'
test(action-router): pin boundary behavior for keep_rate and crash_rate

Adds two regression tests verifying that the evolve-low-keep and
evolve-high-crash thresholds are strict (exclusive). A project at
exactly 15% keep rate or exactly 20% crash rate is treated as acceptable;
only worse-than-threshold values fire.

Ultrareview M1 (falsy received_from) is closed as won't-fix — the
received_from schema is non-empty string | null (documented in commit 5),
under which the original M1 scenario is unreachable.

Addresses ultrareview M2. Closes M1.
EOF
)"
```

- [ ] **Step 3.4**: Run the commit.

---

## Task 4: Collector — safe symlink handling with project-boundary containment

Addresses ultrareview H3 + re-review P-3 (prefix bypass).

**Files:**
- Modify: `lib/dashboard/collector.js` (function `readJsonDir`)
- Test: `lib/dashboard/collector.test.js`

### Step 4.1: Write failing test for happy-path symlink acceptance

Append to `lib/dashboard/collector.test.js`. First ensure the imports at top include both the existing ones and these additions if missing:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
```
(They are already imported — no-op if present.)

Add a suite-level setup to probe symlink privilege once:

```javascript
// ---------------------------------------------------------------------------
// Symlink privilege probe (Windows often disallows symlink creation)
// ---------------------------------------------------------------------------

function probeSymlinkPrivilege() {
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'symprobe-'));
  const target = path.join(probeDir, 'target.txt');
  const link = path.join(probeDir, 'link.txt');
  try {
    fs.writeFileSync(target, 'ok');
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false;
  } finally {
    try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch {}
  }
}
const HAS_SYMLINK_PRIV = probeSymlinkPrivilege();
const SYMLINK_SKIP_REASON = HAS_SYMLINK_PRIV ? false : 'no symlink privilege on this platform';
```

Now the happy-path test:

```javascript
// ---------------------------------------------------------------------------
// Test: readJsonDir loads JSON via a symlink to a regular file in same dir
// ---------------------------------------------------------------------------

test(
  'readJsonDir loads JSON content when the entry is a symbolic link to a regular file within the same directory',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    const root = mktemp();
    const receiptsDir = path.join(root, '.deep-work/receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });

    // Real file
    const realPath = path.join(receiptsDir, 'real.json');
    fs.writeFileSync(realPath, JSON.stringify({ slice_id: 'real', quality_score: 80 }));

    // Symlink within the same directory
    const linkPath = path.join(receiptsDir, 'link.json');
    fs.symlinkSync(realPath, linkPath);

    const result = collectData(root);
    const ids = result.deepWork.receipts.map((r) => r.slice_id).sort();
    assert.deepEqual(ids, ['real', 'real'], 'both the real file and its symlink should load');
  }
);
```

- [ ] **Step 4.1**: Add the probe + test block.

### Step 4.2: Run — expect FAIL

Run:
```bash
npm test 2>&1 | grep -E "symbolic link|readJsonDir"
```
Expected: the deepEqual fails — only `['real']` is returned because `entry.isFile()` returns false for the symlink.

- [ ] **Step 4.2**: Confirm failure.

### Step 4.3: Implement safe symlink following in readJsonDir

In `lib/dashboard/collector.js`, replace the current `readJsonDir` with:

```javascript
/**
 * Read all *.json files from a directory.
 * Follows symbolic links only when the target resolves INSIDE the scanned
 * directory (no prefix bypass, no out-of-tree ingestion). Broken or
 * out-of-bounds symlinks are skipped with a warning.
 */
function readJsonDir(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Canonicalize the scan dir once; if this throws, the dir itself is broken.
  let resolvedScanDir;
  try {
    resolvedScanDir = fs.realpathSync(dirPath);
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;

    const entryAbs = path.join(dirPath, entry.name);
    let accept = false;

    if (entry.isFile()) {
      accept = true;
    } else if (entry.isSymbolicLink()) {
      let resolvedTarget;
      try {
        resolvedTarget = fs.realpathSync(entryAbs);
      } catch {
        console.warn(`[deep-dashboard/collector] skipping broken symlink: ${entryAbs}`);
        continue;
      }

      // Containment: resolvedTarget must stay under resolvedScanDir.
      const rel = path.relative(resolvedScanDir, resolvedTarget);
      const outOfBoundary = rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
      if (outOfBoundary) {
        console.warn(`[deep-dashboard/collector] skipping out-of-boundary symlink: ${entryAbs} -> ${resolvedTarget}`);
        continue;
      }

      let targetStat;
      try {
        targetStat = fs.statSync(resolvedTarget);
      } catch {
        console.warn(`[deep-dashboard/collector] skipping broken symlink target: ${entryAbs}`);
        continue;
      }
      if (targetStat.isFile()) accept = true;
    }

    if (!accept) continue;

    const parsed = readJson(entryAbs);
    if (parsed !== null) results.push(parsed);
  }
  return results;
}
```

- [ ] **Step 4.3**: Replace the `readJsonDir` function with the above.

### Step 4.4: Re-run — expect PASS

Run: `npm test`. Expected: the happy-path symlink test now passes. Prior tests still pass.

- [ ] **Step 4.4**: Confirm.

### Step 4.5: Write failing test for out-of-tree symlink rejection

Append:

```javascript
// ---------------------------------------------------------------------------
// Test: readJsonDir rejects a symlink whose target is OUTSIDE the scan dir
// ---------------------------------------------------------------------------

test(
  'readJsonDir rejects a symlink whose target resolves OUTSIDE the scanned directory',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    const root = mktemp();
    const receiptsDir = path.join(root, '.deep-work/receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });

    // Target outside the project entirely
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-outside-'));
    const outsideTarget = path.join(outsideDir, 'evil.json');
    fs.writeFileSync(outsideTarget, JSON.stringify({ slice_id: 'evil', quality_score: 999 }));

    // Symlink in receipts dir pointing to the outside file
    const linkPath = path.join(receiptsDir, 'link.json');
    fs.symlinkSync(outsideTarget, linkPath);

    const result = collectData(root);
    const ids = result.deepWork.receipts.map((r) => r.slice_id);
    assert.ok(!ids.includes('evil'), 'out-of-tree symlinked JSON must NOT be ingested');
  }
);
```

- [ ] **Step 4.5**: Add the test block.

### Step 4.6: Run — expect PASS

The new containment logic should already reject this. Run: `npm test`. Expected: passes without further changes.

- [ ] **Step 4.6**: Confirm.

### Step 4.7: Write failing test for sibling-prefix bypass (P-3 regression)

Append:

```javascript
// ---------------------------------------------------------------------------
// P-3 regression: sibling directory with shared prefix must also be rejected
// ---------------------------------------------------------------------------

test(
  'readJsonDir rejects a symlink whose target sits in a SIBLING directory with a shared prefix',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    // Layout: project/.deep-work/receipts (scanned) and project/.deep-work/receipts-old (sibling).
    // A naive `startsWith(path.resolve(scanDir))` would accept the sibling because
    // "…/receipts-old/…" starts with "…/receipts". path.relative(scanDir, target)
    // correctly returns a "../…" form that the guard rejects.
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-sibling-'));
    const scanDir = path.join(projectRoot, '.deep-work/receipts');
    const siblingDir = path.join(projectRoot, '.deep-work/receipts-old');
    fs.mkdirSync(scanDir, { recursive: true });
    fs.mkdirSync(siblingDir, { recursive: true });

    const siblingTarget = path.join(siblingDir, 'stale.json');
    fs.writeFileSync(siblingTarget, JSON.stringify({ slice_id: 'sibling-stale', quality_score: 1 }));

    fs.symlinkSync(siblingTarget, path.join(scanDir, 'link.json'));

    const result = collectData(projectRoot);
    const ids = result.deepWork.receipts.map((r) => r.slice_id);
    assert.ok(
      !ids.includes('sibling-stale'),
      'symlink to sibling receipts-old/ must be rejected despite shared "receipts" prefix'
    );
  }
);
```

- [ ] **Step 4.7**: Add the test block above.

### Step 4.8: Run — expect PASS

`path.relative` correctly reports the sibling as starting with `..`. Run: `npm test`. Expected: all green.

- [ ] **Step 4.8**: Confirm.

### Step 4.9: Write test for broken-symlink warning

Append:

```javascript
// ---------------------------------------------------------------------------
// Test: readJsonDir skips a broken symlink (and does not throw)
// ---------------------------------------------------------------------------

test(
  'readJsonDir skips a broken symlink',
  { skip: SYMLINK_SKIP_REASON },
  () => {
    const root = mktemp();
    const receiptsDir = path.join(root, '.deep-work/receipts');
    fs.mkdirSync(receiptsDir, { recursive: true });

    // One real file + one symlink pointing to nowhere
    const realPath = path.join(receiptsDir, 'real.json');
    fs.writeFileSync(realPath, JSON.stringify({ slice_id: 'real', quality_score: 80 }));
    fs.symlinkSync(path.join(receiptsDir, 'does-not-exist.json'), path.join(receiptsDir, 'broken.json'));

    const result = collectData(root);
    const ids = result.deepWork.receipts.map((r) => r.slice_id);
    assert.deepEqual(ids, ['real'], 'broken symlink is skipped; real file still loads');
  }
);
```

- [ ] **Step 4.9**: Add the test.

### Step 4.10: Run full suite — expect all PASS

Run: `npm test`. Expected: 56 tests pass (52 after Task 3, +4 here).

- [ ] **Step 4.10**: Confirm.

### Step 4.11: Commit

```bash
git add lib/dashboard/collector.js lib/dashboard/collector.test.js
git commit -m "$(cat <<'EOF'
fix(collector): follow symlinks safely within project boundary

readJsonDir now accepts symlinked JSON files, but only when the resolved
target stays INSIDE the scanned directory. Both sides are canonicalized
via fs.realpathSync, and containment is checked via path.relative —
preventing the naive startsWith-prefix bypass (e.g., a symlink in
.deep-work/receipts pointing into .deep-work/receipts-old).

Out-of-boundary and broken symlinks are skipped with a visible warning
(prefix: [deep-dashboard/collector]) instead of silent drops.

Windows symlink tests use the node:test { skip } option with a one-shot
symlink-privilege probe, not the non-existent test.skipIf API.

Addresses ultrareview H3 and re-review P-3.
EOF
)"
```

- [ ] **Step 4.11**: Run the commit.

---

## Task 5: Docs sweep — manifest, READMEs, CHANGELOGs, and skill command

Addresses ultrareview C3, C4, L1, L2, L3, L4 + M1 schema doc.

**Files:**
- Modify: `.claude-plugin/plugin.json`, `README.md`, `README.ko.md`, `CHANGELOG.md`, `CHANGELOG.ko.md`, `skills/deep-harnessability.md`
- Possibly create: `scripts/run-scorer.sh` (fallback path only — see Step 5.1)

### Step 5.1: Update skill command to use Claude Code env vars

`${CLAUDE_PLUGIN_ROOT}` (installed plugin directory) and `${CLAUDE_PROJECT_DIR}` (user's active project directory) are documented in Claude Code's Hooks Reference and are available inside bash code blocks within skill markdown. Verified via `claude-code-guide` subagent during plan revision — no runtime subagent dispatch needed.

Edit `skills/deep-harnessability.md`. Replace the current literal line:
```markdown
   node "PLUGIN_DIR/lib/harnessability/scorer.js" "PROJECT_ROOT"
```
with:
```markdown
   node "${CLAUDE_PLUGIN_ROOT}/lib/harnessability/scorer.js" "${CLAUDE_PROJECT_DIR}"
```

Note: if a future Claude Code release changes these variable names, the fix is a one-line update in this same file. No shim infrastructure needed. The manual spot-check in Step F.3 (invoke `/deep-harnessability` from a throwaway directory that is NOT the plugin repo) verifies the command resolves correctly at runtime before the PR merges.

- [ ] **Step 5.1**: Apply the edit.

### Step 5.3: Bump `.claude-plugin/plugin.json` version

Edit `.claude-plugin/plugin.json`:
```diff
-  "version": "1.0.0",
+  "version": "1.1.0",
```

- [ ] **Step 5.3**: Apply the edit.

### Step 5.4: Fix effectiveness weight table in both READMEs

In `README.md`, replace the current 4-row table (around the "Effectiveness score" section) with:

```markdown
| Dimension | Weight | Source |
|---|---|---|
| Health | 25% | `sensors_clean_ratio` from deep-review fitness data |
| Fitness | 20% | `rules_pass_ratio` from `.deep-review/fitness.json` |
| Session | 20% | Average `quality_score` of the last 3 deep-work receipts (normalized 0–100 → 0–10) |
| Harnessability | 15% | `total` from `.deep-dashboard/harnessability-report.json` |
| Evolve | 20% | `quality_score` from `.deep-evolve/evolve-receipt.json` (normalized 0–100 → 0–10) |
```

Apply the identical 5-row table in `README.ko.md` with Korean column headers and dimension labels:

```markdown
| 차원 | 가중치 | 출처 |
|---|---|---|
| 건강성 (Health) | 25% | deep-review fitness 데이터의 `sensors_clean_ratio` |
| 적합성 (Fitness) | 20% | `.deep-review/fitness.json`의 `rules_pass_ratio` |
| 세션 (Session) | 20% | 최근 3개 deep-work receipt의 `quality_score` 평균 (0–100 → 0–10 정규화) |
| 하네스 가능성 (Harnessability) | 15% | `.deep-dashboard/harnessability-report.json`의 `total` |
| Evolve | 20% | `.deep-evolve/evolve-receipt.json`의 `quality_score` (0–100 → 0–10 정규화) |
```

(If the existing Korean README uses different label forms for the 4 original dimensions, match the existing style rather than introducing new translations — the goal is to correct weights and add the Evolve row, not to re-translate.)

- [ ] **Step 5.4**: Apply both edits.

### Step 5.5: Add `deep-evolve` to the architecture diagram in both READMEs

Locate the architecture diagram in `README.md` (the section enumerating inputs like "deep-work, deep-review, deep-docs"). Add a fourth arrow/row for `deep-evolve` pointing to the collector. Mirror the change in `README.ko.md`.

(The exact diagram text is ASCII-art; adjust to the existing style.)

- [ ] **Step 5.5**: Apply both edits.

### Step 5.6: Translate Korean fragments in English README

In `README.md` only (Korean README stays as-is), find the evolve section with these Korean fragments and translate them:

| Korean | English |
|---|---|
| `strategy refinement 권장` | `strategy refinement recommended` |
| `eval harness 점검` | `eval harness inspection` |
| `strategy 검토` | `strategy review` |
| `추가 실험 권장` | `further experiments recommended` |
| `meta-archive 구축 권장` | `meta-archive buildup recommended` |

- [ ] **Step 5.6**: Apply.

### Step 5.7: Document `received_from` schema in both READMEs

In the evolve section of both `README.md` and `README.ko.md`, add (or update) a schema note:

**English** (`README.md`):
```markdown
**Schema notes**
- `transfer.received_from`: `non-empty string | null`. Empty strings and numeric sentinels are not part of the schema; `null` means no transfer learning was received.
```

**Korean** (`README.ko.md`):
```markdown
**스키마 참고**
- `transfer.received_from`: `non-empty string | null`. 빈 문자열이나 숫자 센티널은 스키마에 포함되지 않음. `null`은 전이 학습이 수신되지 않음을 의미.
```

- [ ] **Step 5.7**: Apply both edits.

### Step 5.8: Clarify `evolve-low-q` description in READMEs and CHANGELOGs

In all four files (`README.md`, `README.ko.md`, `CHANGELOG.md`, `CHANGELOG.ko.md`), find the `evolve-low-q` description. Replace the brief "delta > 0.05" wording with:

**English**:
> `evolve-low-q`: fires when the earliest of the last-3 `q_trajectory` values is more than 0.05 above the most recent value (i.e., the recent 3-point window is trending down).

**Korean**:
> `evolve-low-q`: 최근 3개 `q_trajectory` 값 중 가장 오래된 값이 가장 최근 값보다 0.05 초과로 높을 때 발생 (최근 3-point 윈도우가 하락 추세).

- [ ] **Step 5.8**: Apply the four edits (English wording in `README.md`/`CHANGELOG.md`, Korean in the `.ko.md` pair).

### Step 5.8b: Verify skills/deep-harness-dashboard.md does not reference the effectiveness table

The spec listed `skills/deep-harness-dashboard.md` as "if affected." Confirm or refute:

```bash
grep -n -E "weight|Health|Fitness|Session|Harnessability|Evolve" skills/deep-harness-dashboard.md | head -20
```

If the output shows references to the effectiveness-table weights (25/20/20/15/20) or the 4-row/5-row structure, update this file to match the new table (same edits as Step 5.4). If the file only mentions the dimensions abstractly (without numeric weights), leave it unchanged.

- [ ] **Step 5.8b**: Run the grep. If any match mentions specific weights, apply the correction; otherwise record "no-op" in the commit message.

### Step 5.9: Run full test suite — no regressions

Run: `npm test`. Expected: 56 tests pass (identical to Task 4; docs changes do not affect tests).

Additional manual spot-checks:
```bash
jq .version .claude-plugin/plugin.json
jq .version package.json
# both should report "1.1.0"

grep -c "^| " README.md       # should show the new 5-row table
grep -c "^| " README.ko.md    # same
```

- [ ] **Step 5.9**: Run the commands and confirm.

### Step 5.10: Commit

```bash
# Add skills/deep-harness-dashboard.md only if Step 5.8b found edits to apply.
git add .claude-plugin/plugin.json README.md README.ko.md CHANGELOG.md CHANGELOG.ko.md skills/deep-harnessability.md
git commit -m "$(cat <<'EOF'
docs: sync weights, version, architecture, skill command, and received_from schema

- plugin.json version bumped 1.0.0 -> 1.1.0 to match package.json.
- README effectiveness table: corrected all four weights and added the
  missing Evolve row (health 25, fitness 20, session 20, harnessability 15,
  evolve 20; sums to 100).
- README architecture diagram: deep-evolve added as a fourth input.
- README (English): Korean fragments in the evolve section translated to
  English for monolingual readers.
- READMEs: documented transfer.received_from schema as
  'non-empty string | null'. This supports closing ultrareview M1 as
  won't-fix — the original bug describes an unreachable state.
- READMEs + CHANGELOGs: clarified evolve-low-q description to spell out
  the 3-point window semantics.
- skills/deep-harnessability.md: replaced the unresolved PLUGIN_DIR /
  PROJECT_ROOT literals with the documented Claude Code env vars
  (\${CLAUDE_PLUGIN_ROOT} / \${CLAUDE_PROJECT_DIR}).

Addresses ultrareview C3, C4, L1, L2, L3, L4.
EOF
)"
```

- [ ] **Step 5.10**: Run the commit.

---

## Final Verification

### Step F.1: Full test suite

```bash
npm test
```
Expected output tail:
```
# tests 56
# pass  56
# fail  0
```

- [ ] **Step F.1**: Run and confirm.

### Step F.2: Commit history sanity

```bash
git log --oneline main..HEAD
```
Expected: 8 commits on branch (3 spec/docs + 5 implementation):
- `fix(scorer): ...` (Task 1)
- `fix(formatter): ...` (Task 2)
- `test(action-router): ...` (Task 3)
- `fix(collector): ...` (Task 4)
- `docs: sync weights ...` (Task 5)
- (plus the three earlier spec-writing commits: `d9e91e0`, `0b51257`, `943d815`)

- [ ] **Step F.2**: Run and confirm the five new fix/test/docs commits are present in the correct order.

### Step F.3: Version consistency

```bash
jq -r .version .claude-plugin/plugin.json package.json
```
Expected: both print `1.1.0`.

- [ ] **Step F.3**: Run and confirm.

### Step F.4: Hand-off

The branch is ready for:
- Optional: another `/deep-review` round on the implemented code.
- `gh pr create` to open the PR against `main`. The PR body should reference this plan and the spec, and call out the intentional `isTypeScript` narrowing (ultrareview W-1) so reviewers understand the scope.

- [ ] **Step F.4**: Decide with the user on next step.

---

## Notes for the implementing engineer

- Every step assumes your CWD is `/Users/sungmin/Dev/deep-dashboard` on branch `fix/ultrareview-v1.1.1`.
- Do not `git reset --hard` or force-push. If a commit hook fails, fix the issue and create a NEW commit.
- If `npm test` output is noisy and you can't find a new test result, use `node --test lib/<path>.test.js` to target a single file.
- The `os.tmpdir()`-based tests in Task 4 write and must clean up temp directories on their own. Existing tests in the project use `fs.mkdtempSync` without explicit cleanup (relying on OS reap); match that style.
- Pipe-escape MUST stay scoped to pipe-table cells. If you find yourself applying `escapePipe` to header rows, separator rows (`|---|---|`), or bullet lists, back out — you have gone too far.
- The skill command in Step 5.1 uses `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PROJECT_DIR}` — both documented in Claude Code's Hooks Reference. The manual spot-check in Step F.3 verifies at runtime; if either is unset in your environment, stop and report to the user rather than inventing a fallback.
