import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEffectiveness } from './effectiveness.js';

// ---------------------------------------------------------------------------
// Test 1: Returns null when no data available
// ---------------------------------------------------------------------------

test('returns null effectiveness when no data available', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'no_data', receipt: null },
    harnessability: { status: 'no_data', data: null },
  };

  const result = calculateEffectiveness(data);

  assert.equal(result.effectiveness, null);
  assert.ok(typeof result.scores === 'object');
});

// ---------------------------------------------------------------------------
// Test 2: Calculates with partial data (not_applicable redistribution)
// ---------------------------------------------------------------------------

test('redistributes weight when some dimensions are not_applicable', () => {
  // Only harnessability is available (score=7), everything else is missing
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'no_data', receipt: null },
    harnessability: {
      status: 'available',
      data: { total: 7 },
    },
  };

  const result = calculateEffectiveness(data);

  // With only harnessability available, effectiveness should equal 7 (full weight on it)
  assert.ok(result.effectiveness !== null, 'effectiveness should not be null when harnessability is available');
  assert.equal(result.effectiveness, 7);
  assert.equal(result.scores.harnessability, 7);
  assert.equal(result.scores.health, null);
  assert.equal(result.scores.fitness, null);
  assert.equal(result.scores.session, null);
});

// ---------------------------------------------------------------------------
// Test 3: Normalizes session quality_score from 0-100 to 0-10
// ---------------------------------------------------------------------------
//
// Real-shape fixture: quality_score lives ONLY on session-receipts
// (schema payload-registry/deep-work/session-receipt/v1.0 — session-level
// aggregate). Slice receipts (additionalProperties: false) can never carry
// it, so `receipts` here is deliberately slice-shaped without quality_score.

test('normalizes session quality_score from 0-100 to 0-10', () => {
  const data = {
    deepWork: {
      status: 'available',
      receipts: [
        { slice_id: 'SLICE-001', status: 'completed', tdd: 'red-green-refactor' },
        { slice_id: 'SLICE-002', status: 'completed', tdd: 'red-green-refactor' },
      ],
      sessionReceipts: [
        { session_id: 's3', started_at: '2026-05-03T10:00:00Z', quality_score: 80 },
        { session_id: 's2', started_at: '2026-05-02T10:00:00Z', quality_score: 60 },
        { session_id: 's1', started_at: '2026-05-01T10:00:00Z', quality_score: 70 },
      ],
    },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'no_data', receipt: null },
    harnessability: { status: 'no_data', data: null },
  };

  const result = calculateEffectiveness(data);

  // Average quality_score = (80+60+70)/3 = 70, normalized to 7.0
  assert.ok(result.effectiveness !== null);
  assert.equal(result.scores.session, 7.0);
});

test('session score is null when slice receipts exist but no session-receipts (real slice shape)', () => {
  // Regression for the P0 audit finding: slice receipts never carry
  // quality_score, so they must not feed the session dimension.
  const data = {
    deepWork: {
      status: 'available',
      receipts: [
        { slice_id: 'SLICE-001', status: 'completed', tdd: 'red-green-refactor' },
      ],
      sessionReceipts: [],
    },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'no_data', receipt: null },
    harnessability: { status: 'no_data', data: null },
  };

  const result = calculateEffectiveness(data);

  assert.equal(result.scores.session, null);
});

test('session score averages the receipts that exist when fewer than 3', () => {
  const data = {
    deepWork: {
      status: 'available',
      receipts: [],
      sessionReceipts: [
        { session_id: 's2', started_at: '2026-05-02T10:00:00Z', quality_score: 90 },
        { session_id: 's1', started_at: '2026-05-01T10:00:00Z', quality_score: 70 },
      ],
    },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'no_data', receipt: null },
    harnessability: { status: 'no_data', data: null },
  };

  const result = calculateEffectiveness(data);

  // Average of the 2 that exist = 80 → 8.0 ("last 3" is an upper bound)
  assert.equal(result.scores.session, 8.0);
});

test('session score ignores non-numeric quality_score values', () => {
  const data = {
    deepWork: {
      status: 'available',
      receipts: [],
      sessionReceipts: [
        { session_id: 's3', started_at: '2026-05-03T10:00:00Z', quality_score: 'high' },
        { session_id: 's2', started_at: '2026-05-02T10:00:00Z' },
        { session_id: 's1', started_at: '2026-05-01T10:00:00Z', quality_score: 60 },
      ],
    },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'no_data', receipt: null },
    harnessability: { status: 'no_data', data: null },
  };

  const result = calculateEffectiveness(data);

  assert.equal(result.scores.session, 6.0);
});

// ---------------------------------------------------------------------------
// Test 4: extractEvolveScore normalizes quality_score 0-100 to 0-10
// ---------------------------------------------------------------------------

test('evolve score normalizes quality_score 78 to 7.8', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'available', receipt: { quality_score: 78 } },
    harnessability: { status: 'no_data', data: null },
  };

  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, 7.8);
  assert.ok(result.effectiveness !== null);
});

test('evolve null redistributes weight to available dimensions', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'no_data', receipt: null },
    harnessability: { status: 'available', data: { total: 8 } },
  };

  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, null);
  assert.equal(result.scores.harnessability, 8);
  assert.equal(result.effectiveness, 8);
});

test('evolve score boundary: quality_score 0 returns 0', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'available', receipt: { quality_score: 0 } },
    harnessability: { status: 'no_data', data: null },
  };
  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, 0);
});

test('evolve score boundary: quality_score 100 returns 10', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'available', receipt: { quality_score: 100 } },
    harnessability: { status: 'no_data', data: null },
  };
  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, 10);
});

test('evolve score boundary: receipt null returns null', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'available', receipt: null },
    harnessability: { status: 'no_data', data: null },
  };
  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, null);
});

test('evolve score boundary: quality_score NaN returns null', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'available', receipt: { quality_score: NaN } },
    harnessability: { status: 'no_data', data: null },
  };
  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, null);
});

test('evolve score boundary: quality_score -1 returns 0', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'available', receipt: { quality_score: -1 } },
    harnessability: { status: 'no_data', data: null },
  };
  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, 0);
});

test('evolve score decimal: quality_score 78.5 returns 7.9', () => {
  const data = {
    deepWork: { status: 'no_data', receipts: [] },
    deepReview: { status: 'no_data', receipts: [], fitness: null },
    deepDocs: { status: 'no_data', data: null },
    deepEvolve: { status: 'available', receipt: { quality_score: 78.5 } },
    harnessability: { status: 'no_data', data: null },
  };
  const result = calculateEffectiveness(data);
  assert.equal(result.scores.evolve, 7.9);
});
