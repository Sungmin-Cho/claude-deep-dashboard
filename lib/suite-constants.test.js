import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVELOPE_ROLLOUT,
  ADOPTION_LEDGER,
  AGGREGATOR_KINDS,
  EXPECTED_SOURCES,
  PAYLOAD_REQUIRED_FIELDS,
  legacyFallbackExpired,
} from './suite-constants.js';

test('ENVELOPE_ROLLOUT timer dates are immutable constants', () => {
  assert.equal(ENVELOPE_ROLLOUT.t0_date, '2026-05-07');
  assert.equal(ENVELOPE_ROLLOUT.t0_plus_6mo_date, '2026-11-07');
  assert.throws(
    () => {
      'use strict';
      ENVELOPE_ROLLOUT.t0_date = 'tampered';
    },
    /read.only|Cannot assign/i
  );
});

test('legacyFallbackExpired cutoff = 2026-11-07T00:00:00Z exclusive (Round 1: Opus W3)', () => {
  // Before cutoff
  assert.equal(legacyFallbackExpired('2026-05-11T00:00:00Z'), false);
  assert.equal(legacyFallbackExpired('2026-11-06T23:59:59Z'), false);
  // Exactly at cutoff — exclusive, so false
  assert.equal(legacyFallbackExpired('2026-11-07T00:00:00Z'), false);
  // One second past — true
  assert.equal(legacyFallbackExpired('2026-11-07T00:00:01Z'), true);
  assert.equal(legacyFallbackExpired('2027-01-01T00:00:00Z'), true);
});

test('legacyFallbackExpired returns false on unparseable input (fail-safe)', () => {
  assert.equal(legacyFallbackExpired('not-a-date'), false);
});

test('ADOPTION_LEDGER lists all 6 plugins with version + since + sha', () => {
  const expected = ['deep-docs', 'deep-dashboard', 'deep-work', 'deep-evolve', 'deep-review', 'deep-wiki'];
  for (const p of expected) {
    const entry = ADOPTION_LEDGER[p];
    assert.ok(entry, `missing ${p}`);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
    assert.match(entry.since, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(entry.sha, /^[a-f0-9]{40}$/);
  }
});

test('EXPECTED_SOURCES has 15 entries (12 envelope + 3 ndjson) after M5 activation + Round 1 review fix', () => {
  // History:
  //   - Pre-Round-1: 8 (envelope-only).
  //   - Round 1 (Codex adv HIGH): added 3 NDJSON sources (deep-work/hook-log,
  //     deep-evolve/hook-log, deep-wiki/log) → 11.
  //   - M5 activation: + (deep-work, handoff), (deep-work, compaction-state) → 13.
  //   - Round 1 review fix (C1, 3-way agreement): + (deep-evolve, handoff),
  //     (deep-evolve, compaction-state) → 15. Reverse handoffs are produced
  //     by deep-evolve (long-run-handoff.md §4.3) and compaction-state is
  //     also a deep-evolve emit per context-management.md §6.
  // The deep-review review-report markdown source remains deferred to PR 2's
  // verdict_mix formatter.
  assert.equal(EXPECTED_SOURCES.length, 15);
  const envelopeEntries = EXPECTED_SOURCES.filter((s) => s.type === 'envelope');
  const ndjsonEntries = EXPECTED_SOURCES.filter((s) => s.type === 'ndjson');
  assert.equal(envelopeEntries.length, 12);
  assert.equal(ndjsonEntries.length, 3);
});

test('EXPECTED_SOURCES includes M5 envelope sources for both producers', () => {
  const expected = [
    ['deep-work', 'handoff'],
    ['deep-work', 'compaction-state'],
    ['deep-evolve', 'handoff'],
    ['deep-evolve', 'compaction-state'],
  ];
  for (const [producer, kind] of expected) {
    const entry = EXPECTED_SOURCES.find(
      (s) => s.producer === producer && s.kind === kind
    );
    assert.ok(entry, `${producer}/${kind} missing from EXPECTED_SOURCES`);
    assert.equal(entry.type, 'envelope');
  }
});

test('EXPECTED_SOURCES every entry has producer + kind + type', () => {
  for (const s of EXPECTED_SOURCES) {
    assert.ok(s.producer && typeof s.producer === 'string');
    assert.ok(s.kind && typeof s.kind === 'string');
    assert.ok(s.type === 'envelope' || s.type === 'ndjson', `bad type ${s.type}`);
  }
});

test('PAYLOAD_REQUIRED_FIELDS covers all 12 envelope-typed sources', () => {
  // 8 baseline + 4 M5 activations (handoff/compaction-state for both producers
  // after Round 1 review fix C1).
  const keys = Object.keys(PAYLOAD_REQUIRED_FIELDS);
  assert.equal(keys.length, 12);
  // Each entry is an array of non-empty strings
  for (const [kindKey, required] of Object.entries(PAYLOAD_REQUIRED_FIELDS)) {
    assert.match(kindKey, /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/);
    assert.ok(Array.isArray(required) && required.length > 0);
    for (const f of required) assert.ok(typeof f === 'string' && f.length > 0);
  }
});

test('PAYLOAD_REQUIRED_FIELDS: handoff schema applies to both producers (deep-work + deep-evolve)', () => {
  // The handoff payload schema is producer-agnostic — same required[] for
  // forward (deep-work) and reverse (deep-evolve) handoffs.
  assert.deepEqual(
    PAYLOAD_REQUIRED_FIELDS['deep-work/handoff'],
    PAYLOAD_REQUIRED_FIELDS['deep-evolve/handoff']
  );
});

test('PAYLOAD_REQUIRED_FIELDS: compaction-state schema applies to both producers', () => {
  assert.deepEqual(
    PAYLOAD_REQUIRED_FIELDS['deep-work/compaction-state'],
    PAYLOAD_REQUIRED_FIELDS['deep-evolve/compaction-state']
  );
});

test('PAYLOAD_REQUIRED_FIELDS for handoff mirrors schemas/handoff.schema.json required[]', () => {
  // Source: claude-deep-suite/schemas/handoff.schema.json (M5, schema_version 1.0).
  // required: [schema_version, handoff_kind, from, to, summary, next_action_brief]
  const handoff = PAYLOAD_REQUIRED_FIELDS['deep-work/handoff'];
  assert.ok(handoff, 'deep-work/handoff missing');
  const required = new Set(handoff);
  for (const f of ['schema_version', 'handoff_kind', 'from', 'to', 'summary', 'next_action_brief']) {
    assert.ok(required.has(f), `handoff required missing field ${f}`);
  }
});

test('PAYLOAD_REQUIRED_FIELDS for compaction-state mirrors schemas/compaction-state.schema.json required[]', () => {
  // Source: claude-deep-suite/schemas/compaction-state.schema.json (M5, schema_version 1.0).
  // required: [schema_version, compacted_at, trigger, preserved_artifact_paths]
  const c = PAYLOAD_REQUIRED_FIELDS['deep-work/compaction-state'];
  assert.ok(c, 'deep-work/compaction-state missing');
  const required = new Set(c);
  for (const f of ['schema_version', 'compacted_at', 'trigger', 'preserved_artifact_paths']) {
    assert.ok(required.has(f), `compaction-state required missing field ${f}`);
  }
});

test('PAYLOAD_REQUIRED_FIELDS keys align with EXPECTED_SOURCES envelope entries', () => {
  const envelopeKindKeys = EXPECTED_SOURCES.filter((s) => s.type === 'envelope').map(
    (s) => `${s.producer}/${s.kind}`
  );
  for (const k of envelopeKindKeys) {
    assert.ok(
      PAYLOAD_REQUIRED_FIELDS[k],
      `PAYLOAD_REQUIRED_FIELDS missing entry for ${k}`
    );
  }
});

test('AGGREGATOR_KINDS lists the 3 non-chain-eligible artifact kinds (Round 1: W1)', () => {
  // Moved from suite-collector.js#_internal to suite-constants.js so both
  // collector and aggregator import the same Set.
  assert.ok(AGGREGATOR_KINDS instanceof Set);
  assert.equal(AGGREGATOR_KINDS.size, 3);
  for (const kind of ['harnessability-report', 'evolve-insights', 'index']) {
    assert.ok(AGGREGATOR_KINDS.has(kind), `${kind} should be an aggregator kind`);
  }
});
