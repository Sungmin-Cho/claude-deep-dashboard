import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVELOPE_ROLLOUT,
  ADOPTION_LEDGER,
  EXPECTED_SOURCES,
  legacyFallbackExpired,
} from './suite-constants.js';

test('ENVELOPE_ROLLOUT timer dates are immutable constants', () => {
  assert.equal(ENVELOPE_ROLLOUT.t0_date, '2026-05-07');
  assert.equal(ENVELOPE_ROLLOUT.t0_plus_6mo_date, '2026-11-07');
  // Frozen — attempts to mutate are silently dropped in non-strict mode,
  // but the property must still read the original value.
  assert.throws(
    () => {
      'use strict';
      ENVELOPE_ROLLOUT.t0_date = 'tampered';
    },
    /read.only|Cannot assign/i
  );
});

test('legacyFallbackExpired is false before 2026-11-07', () => {
  assert.equal(legacyFallbackExpired('2026-05-11T00:00:00Z'), false);
  assert.equal(legacyFallbackExpired('2026-11-06T23:59:59Z'), false);
});

test('legacyFallbackExpired flips true after 2026-11-07', () => {
  assert.equal(legacyFallbackExpired('2026-11-07T00:00:01Z'), true);
  assert.equal(legacyFallbackExpired('2027-01-01T00:00:00Z'), true);
});

test('legacyFallbackExpired returns false on unparseable input (fail-safe)', () => {
  assert.equal(legacyFallbackExpired('not-a-date'), false);
});

test('ADOPTION_LEDGER lists all 6 plugins with version + since + sha', () => {
  const expected = [
    'deep-docs',
    'deep-dashboard',
    'deep-work',
    'deep-evolve',
    'deep-review',
    'deep-wiki',
  ];
  for (const p of expected) {
    const entry = ADOPTION_LEDGER[p];
    assert.ok(entry, `missing ${p}`);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.since, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.sha, /^[a-f0-9]{40}$/);
  }
});

test('EXPECTED_SOURCES has 8 tuples (M4-core scope)', () => {
  assert.equal(EXPECTED_SOURCES.length, 8);
});
