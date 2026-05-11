/**
 * Null-signal redistribution test — M5.5 #6.
 *
 * Source spec: `claude-deep-suite/docs/deep-suite-harness-roadmap.md` §M5.5
 * → "Null-signal redistribution test" (item 6 of 8 in the standard test
 * catalog; deep-dashboard-owned).
 *
 * Purpose: pin the harnessability scorer's behavior when 1+ checks (or an
 * entire dimension's checks) resolve to `not_applicable`. The current scorer
 * (`lib/harnessability/scorer.js`) deliberately does NOT renormalize weights
 * across applicable dimensions — a wholly-not-applicable dimension
 * contributes `score = 0` × `weight`, which means the project's `total`
 * shrinks proportionally to the lost weight.
 *
 * Design choice rationale (this test pins the choice):
 *
 *   The "weight redistribution" alternative (renormalize remaining weights
 *   to sum to 1.0 when some dims are wholly N/A) was considered and rejected
 *   for v1.3.x because:
 *
 *   1. `harnessability-report.json#payload.total` is a stable contract
 *      consumed by the dashboard's grade(...) banding + by external scripts
 *      that compare snapshots over time. Changing the math would silently
 *      shift historical scores upward for projects that "ducked" a dim by
 *      being a different ecosystem (e.g., Go projects with type_safety = 0
 *      would suddenly improve from 7.5 to 10.0 with no real change).
 *   2. Penalizing ecosystem-mismatch is intentional — the scorer's job is to
 *      reward projects that hit ALL 6 harness dimensions, not "the ones
 *      that happen to be applicable". A Go project that adds a JSDoc-based
 *      type system would correctly score lower on type_safety than a
 *      TypeScript project with `strict: true`.
 *   3. `not_applicable` IS already used to suppress check-level
 *      recommendations (see `scorer.test.js` test "not_applicable checks do
 *      not generate recommendations in low-scoring dimensions"), which is
 *      the actionable use of the marker. Score-level redistribution would be
 *      a separate semantic decision worth its own PR + version bump.
 *
 *   This test exists so that a future PR that changes the scorer's math
 *   must also explicitly update these assertions — making the decision
 *   visible rather than silent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { scoreHarnessability } from './scorer.js';

// ---------------------------------------------------------------------------
// Helpers (mirror scorer.test.js style — keep independent for portability)
// ---------------------------------------------------------------------------

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'missing-signal-'));
}

function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function writeJson(dir, relPath, obj) {
  writeFile(dir, relPath, JSON.stringify(obj, null, 2));
}

/**
 * The static weight table from checklist.json. If checklist.json changes,
 * update here too — the alignment test below catches drift.
 */
const WEIGHTS = {
  type_safety: 0.25,
  module_boundaries: 0.20,
  test_infra: 0.20,
  sensor_readiness: 0.15,
  linter_formatter: 0.10,
  ci_cd: 0.10,
};

// ---------------------------------------------------------------------------
// Test 1 — wholly-NA dimension contributes 0; total scales accordingly
// ---------------------------------------------------------------------------

test('M5.5 #6: wholly_not_applicable dimension contributes 0 × weight to total (no redistribution)', async () => {
  // Go-only project — type_safety dim has all 4 checks resolve to not_applicable
  // (tsconfig_* gated on isTypeScript; mypy/python_type_hints gated on isPython
  // via detector). So type_safety.score === 0 BUT total is computed against
  // a weight basis that still includes type_safety's 0.25 share.
  const root = mktemp();
  writeFile(root, 'main.go', 'package main');

  const result = await scoreHarnessability(root);

  const typeSafety = result.dimensions.find((d) => d.id === 'type_safety');
  assert.ok(typeSafety, 'type_safety dimension must be present in output');
  assert.equal(typeSafety.score, 0, 'wholly-NA dim must score 0 (not "absent")');
  // All four type_safety checks should carry not_applicable=true
  assert.equal(
    typeSafety.checks.filter((c) => c.not_applicable).length,
    typeSafety.checks.length,
    'all type_safety checks must be not_applicable in a Go-only project'
  );

  // Reconstruct expected total using the NO-REDISTRIBUTION formula:
  //   total = Σ(dim.score × WEIGHTS[dim.id])
  // The wholly-NA dim contributes 0 × 0.25 = 0, but the total denominator
  // is still effectively 1.0 (max-10 scale).
  let expected = 0;
  for (const dim of result.dimensions) {
    expected += dim.score * WEIGHTS[dim.id];
  }
  expected = Math.round(expected * 10) / 10;

  assert.equal(
    result.total,
    expected,
    `expected total ${expected} (no-redistribution math), got ${result.total}`
  );

  // Sanity: if redistribution WERE applied, total would be higher (because
  // type_safety's 0 × 0.25 = 0 drag would be removed and remaining weights
  // would renormalize). Assert that we're NOT seeing the renormalized value.
  const otherDims = result.dimensions.filter((d) => d.id !== 'type_safety');
  const totalOtherWeight = otherDims.reduce((s, d) => s + WEIGHTS[d.id], 0);
  let renormalizedTotal = 0;
  for (const dim of otherDims) {
    renormalizedTotal += (dim.score * WEIGHTS[dim.id]) / totalOtherWeight;
  }
  renormalizedTotal = Math.round(renormalizedTotal * 10) / 10;

  if (renormalizedTotal !== expected) {
    // The two formulas would diverge — confirm we picked no-redistribution.
    assert.notEqual(
      result.total,
      renormalizedTotal,
      `scorer must NOT be using weight-redistribution math (would yield ${renormalizedTotal})`
    );
  }
});

// ---------------------------------------------------------------------------
// Test 2 — partially-NA dimension keeps its full weight; checks count
// only `applicable` ones
// ---------------------------------------------------------------------------

test('M5.5 #6: partially_not_applicable dimension keeps full weight, score = passed/applicable × 10', async () => {
  // TypeScript project (tsconfig.json present, mypy/Python not):
  //   type_safety checks:
  //     tsconfig_strict      — TS-gated, TS project → applies, fails (no strict)
  //     tsconfig_exists      — TS-gated, TS project → applies, passes
  //     mypy_strict          — Python-gated, not Python → not_applicable
  //     python_type_hints    — Python-gated, not Python → not_applicable
  //   applicable = 2, passed = 1 → score = 1/2 × 10 = 5
  //   dimension weight remains 0.25 (partial-NA does NOT trigger redistribution
  //   either way — that's deliberate).
  const root = mktemp();
  writeJson(root, 'tsconfig.json', {});  // no `strict: true`

  const result = await scoreHarnessability(root);

  const typeSafety = result.dimensions.find((d) => d.id === 'type_safety');
  assert.equal(typeSafety.score, 5, `partial-NA dim score should be 5 (1/2 passed × 10); got ${typeSafety.score}`);
  assert.equal(typeSafety.weight, 0.25, 'partial-NA dim must keep full weight');

  // 2 of 4 checks should be NA (the Python ones)
  const naChecks = typeSafety.checks.filter((c) => c.not_applicable);
  assert.equal(naChecks.length, 2);
  const naIds = naChecks.map((c) => c.id).sort();
  assert.deepEqual(naIds, ['mypy_strict', 'python_type_hints']);
});

// ---------------------------------------------------------------------------
// Test 3 — weights from checklist.json align with the static table this
// test uses; catches drift if checklist.json is edited without test update
// ---------------------------------------------------------------------------

test('M5.5 #6: WEIGHTS table matches checklist.json (drift guard)', async () => {
  // Use a wholly-passing-or-failing scaffold to read back the runtime weights.
  const root = mktemp();
  writeFile(root, 'main.go', 'package main');
  const result = await scoreHarnessability(root);

  for (const dim of result.dimensions) {
    assert.equal(
      dim.weight,
      WEIGHTS[dim.id],
      `WEIGHTS[${dim.id}] = ${WEIGHTS[dim.id]} drifted from checklist.json (${dim.weight}). ` +
      `Update this test's WEIGHTS table when changing checklist.json.`
    );
  }
  // And the dimension set itself
  const dimIds = result.dimensions.map((d) => d.id).sort();
  const expectedIds = Object.keys(WEIGHTS).sort();
  assert.deepEqual(
    dimIds,
    expectedIds,
    'checklist.json dimension set drifted from WEIGHTS table'
  );
  // Weights must sum to 1.0 (modulo floating-point) — this is what makes the
  // no-redistribution math result in a stable 0-10 scale.
  const totalWeight = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(
    Math.abs(totalWeight - 1.0) < 1e-9,
    `WEIGHTS must sum to 1.0 (got ${totalWeight})`
  );
});

// ---------------------------------------------------------------------------
// Test 4 — 1 of 6 dim wholly-NA (the canonical "1 missing" case from roadmap)
// ---------------------------------------------------------------------------

test('M5.5 #6: 1 of 6 dim wholly-NA — total is bounded by [0, 10 × (1 - 0.25)]', async () => {
  // A Go project's type_safety dim is wholly NA (weight 0.25). The max
  // achievable total under no-redistribution is therefore 10 × (1 - 0.25) = 7.5
  // (when every OTHER dim scores 10).
  //
  // This test pins the upper bound without claiming the project actually hits
  // it — the assertion is about what's MATHEMATICALLY possible under the
  // current math, not about whether this specific minimal project hits it.
  const root = mktemp();
  writeFile(root, 'main.go', 'package main');

  const result = await scoreHarnessability(root);

  const typeSafety = result.dimensions.find((d) => d.id === 'type_safety');
  assert.equal(typeSafety.score, 0, 'type_safety should be 0 in Go-only project');

  // Per no-redistribution math, the maximum total achievable when type_safety
  // is wholly NA is 7.5. The minimal Go project should score WELL UNDER that
  // ceiling (it has no test infra, no CI, no linter).
  assert.ok(
    result.total <= 7.5,
    `total ${result.total} must respect the 7.5 ceiling implied by no-redistribution + wholly-NA type_safety (0.25 weight)`
  );
  // And specifically, a bare main.go should be very low — pin the lower bound
  // too so we catch accidental score inflation.
  assert.ok(
    result.total <= 3,
    `bare Go project (no test/lint/CI) total ${result.total} should be <= 3 (grade Poor band)`
  );
});

// ---------------------------------------------------------------------------
// Test 5 — multiple dimensions wholly-NA — total stays valid (no NaN, no negative)
// ---------------------------------------------------------------------------

test('M5.5 #6: multiple wholly-NA dimensions → total is non-negative finite (defensive)', async () => {
  // Realistically only the type_safety dimension can be wholly-NA today (the
  // ecosystem-gating only applies there). But we exercise the path that
  // _every_ dim has applicable=0 by passing a fully-empty root. Other dims
  // (module_boundaries, test_infra, ...) don't have NA-gates today, so they
  // score 0 from "all checks failed", NOT from "all NA". This is a defensive
  // smoke test that the scorer never returns NaN, -∞, or > 10.
  const root = mktemp();
  // No files at all — every check fails or is NA.

  const result = await scoreHarnessability(root);

  assert.ok(Number.isFinite(result.total), `total must be finite; got ${result.total}`);
  assert.ok(result.total >= 0, `total must be ≥ 0; got ${result.total}`);
  assert.ok(result.total <= 10, `total must be ≤ 10; got ${result.total}`);
});

// ---------------------------------------------------------------------------
// Test 6 — full Python project (Python-gated checks apply, TS-gated NA)
// — mirror of the TS partial-NA case for symmetry
// ---------------------------------------------------------------------------

test('M5.5 #6: Python project (py.typed) — TS-gated NA, Python-gated apply', async () => {
  const root = mktemp();
  writeFile(root, 'pyproject.toml', '[tool.mypy]\nstrict = true\n');
  writeFile(root, 'src/mypackage/py.typed', '');

  const result = await scoreHarnessability(root);

  const typeSafety = result.dimensions.find((d) => d.id === 'type_safety');
  const naIds = typeSafety.checks.filter((c) => c.not_applicable).map((c) => c.id).sort();
  // TS-gated should be NA
  assert.deepEqual(naIds, ['tsconfig_exists', 'tsconfig_strict']);
  // Python-gated should apply (and pass via mypy_strict + py.typed)
  const pyChecks = typeSafety.checks.filter((c) => c.id === 'mypy_strict' || c.id === 'python_type_hints');
  for (const chk of pyChecks) {
    assert.equal(chk.not_applicable, undefined, `${chk.id} should not be NA in a Python project`);
    assert.equal(chk.passed, true, `${chk.id} should pass given mypy strict + py.typed`);
  }
  // applicable=2, passed=2 → score=10. Dim weight unchanged at 0.25.
  assert.equal(typeSafety.score, 10);
  assert.equal(typeSafety.weight, 0.25);
});
