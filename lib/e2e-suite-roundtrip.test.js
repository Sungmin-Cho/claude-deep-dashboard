// M5.7.B consumer-side end-to-end test for cross-plugin handoff/compaction
// metrics. Pairs with the suite-side regression guard
// (`claude-deep-suite/tests/handoff-roundtrip-fixtures.test.js`,
//  `docs/test-catalog.md` §9). This file is the **consumer side**: feeds
// the same 4-artifact canonical set into aggregator.js's three compute
// functions and asserts the dashboard emits the expected numeric values.
//
// Together (suite §9 provider + this consumer e2e) they form the round-trip
// regression guard for:
//   1. envelope.parent_run_id chain integrity (drift breaks
//      computeHandoffRoundtripSuccessRate's child-by-parent index)
//   2. payload field-name stability (drift breaks the ratio numerator)
//   3. cardinality drift (extra/missing artifact silently shifts metrics)
//
// Suite source: claude-deep-suite/tests/fixtures/handoff-roundtrip/
//               (PR #24 merge `0ca870e`, byte-identical mirror under
//                test/fixtures/handoff-roundtrip/)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { _internal } from './aggregator.js';

const {
  computeCompactionFrequency,
  computeCompactionPreservedArtifactRatio,
  computeHandoffRoundtripSuccessRate,
} = _internal;

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const fixtureDir = resolve(repoRoot, 'test/fixtures/handoff-roundtrip');

function loadFixtures() {
  return readdirSync(fixtureDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = resolve(fixtureDir, f);
      const data = JSON.parse(readFileSync(path, 'utf8'));
      return { file: f, path, ...data };
    });
}

function buildEnvelopeSources(fixtures) {
  // Group by (producer, artifact_kind) to mirror the shape that
  // suite-collector emits. Each `envelopes[]` entry uses the same
  // `{ envelope, payload, source }` shape consumed by aggregator.js.
  const byKey = new Map();
  for (const fx of fixtures) {
    const producer = fx.envelope.producer;
    const kind = fx.envelope.artifact_kind;
    const key = `${producer}::${kind}`;
    if (!byKey.has(key)) {
      byKey.set(key, { producer, kind, envelopes: [], failures: [] });
    }
    byKey.get(key).envelopes.push({
      envelope: fx.envelope,
      payload: fx.payload,
      source: fx.file,
    });
  }
  return [...byKey.values()];
}

describe('M5.7.B suite §9 consumer e2e — aggregator emits expected metric values', () => {
  test('fixture set mirror is the expected 4-artifact canonical scenario', () => {
    const fixtures = loadFixtures();
    assert.equal(fixtures.length, 4, `expected 4 fixture files, got ${fixtures.length}`);
    const kinds = fixtures.map((f) => f.envelope.artifact_kind).sort();
    assert.deepEqual(kinds, ['compaction-state', 'compaction-state', 'handoff', 'handoff']);
    const producers = [...new Set(fixtures.map((f) => f.envelope.producer))].sort();
    assert.deepEqual(producers, ['deep-evolve', 'deep-work']);
  });

  test('envelopeSources grouping has 4 (producer, kind) buckets (one per fixture)', () => {
    const sources = buildEnvelopeSources(loadFixtures());
    assert.equal(sources.length, 4);
    for (const s of sources) {
      assert.equal(s.envelopes.length, 1, `${s.producer}/${s.kind} expected single envelope`);
    }
  });

  test('aggregator emits compaction.frequency = 2', () => {
    const sources = buildEnvelopeSources(loadFixtures());
    const result = computeCompactionFrequency(sources);
    assert.equal(result.value, 2, `expected frequency=2, got ${result.value}`);
    assert.equal(result.source_summary.total_events, 2);
    assert.equal(result.source_summary.unique_sessions, 2, 'each compaction-state has a distinct session_id');
    assert.deepEqual(
      result.source_summary.compaction_producers,
      ['deep-evolve', 'deep-work'],
      'both producers must appear in drill-down',
    );
  });

  test('aggregator emits compaction.preserved_artifact_ratio mean = 0.4', () => {
    // Pinned to the suite §9 fixture math:
    //   02-deep-work-compaction:   preserved=2 / (2+3) = 0.4
    //   03-deep-evolve-compaction: preserved=2 / (2+3) = 0.4
    //   mean = 0.4 (exact)
    // Any drift in preserved/discarded counts (either fixture) or in the
    // aggregator's mean-of-ratios formula trips this assertion.
    const sources = buildEnvelopeSources(loadFixtures());
    const result = computeCompactionPreservedArtifactRatio(sources);
    assert.ok(result.value !== null, 'expected numeric ratio, got null');
    assert.equal(
      result.value.toFixed(4),
      '0.4000',
      `expected preserved_artifact_ratio mean=0.4000, got ${result.value}`,
    );
    assert.equal(result.source_summary.envelopes_with_ratio, 2);
    assert.equal(result.source_summary.envelopes_without_ratio, 0);
  });

  test('aggregator emits handoff.roundtrip_success_rate = 1.0 (chain closed)', () => {
    const sources = buildEnvelopeSources(loadFixtures());
    const result = computeHandoffRoundtripSuccessRate(sources);
    assert.equal(result.value, 1.0, `expected roundtrip_success_rate=1.0, got ${result.value}`);
  });

  test('all three M5-activated metrics emit numeric (no null fallback)', () => {
    const sources = buildEnvelopeSources(loadFixtures());
    const freq = computeCompactionFrequency(sources);
    const ratio = computeCompactionPreservedArtifactRatio(sources);
    const rt = computeHandoffRoundtripSuccessRate(sources);
    assert.ok(typeof freq.value === 'number' && Number.isFinite(freq.value));
    assert.ok(typeof ratio.value === 'number' && Number.isFinite(ratio.value));
    assert.ok(typeof rt.value === 'number' && Number.isFinite(rt.value));
  });

  test('round-trip is broken if forward handoff is removed (consumer detects)', () => {
    // Drop the deep-work forward handoff; expect the reverse handoff to
    // become an "orphan continuation" (parent_run_id points to nothing
    // among handoffs). Per aggregator's initiating-handoff logic, the
    // reverse handoff IS treated as initiating in that degenerate case
    // (parent_run_id chains to a non-handoff or nothing) and there's no
    // child closing it → success_rate = 0.
    const fixtures = loadFixtures().filter(
      (f) => !(f.envelope.artifact_kind === 'handoff' && f.payload.handoff_kind === 'phase-5-to-evolve'),
    );
    const sources = buildEnvelopeSources(fixtures);
    const rt = computeHandoffRoundtripSuccessRate(sources);
    assert.equal(rt.value, 0, 'orphan reverse handoff must drop success rate to 0');
  });

  test('round-trip is broken if reverse handoff parent_run_id is corrupted', () => {
    const fixtures = loadFixtures();
    // Mutate the reverse handoff's parent_run_id to a non-existent value
    const corrupted = fixtures.map((f) => {
      if (f.envelope.artifact_kind === 'handoff' && f.payload.handoff_kind === 'evolve-to-deep-work') {
        return {
          ...f,
          envelope: { ...f.envelope, parent_run_id: '01ZZZZ_NONEXISTENT_PARENT_001' },
        };
      }
      return f;
    });
    const sources = buildEnvelopeSources(corrupted);
    const rt = computeHandoffRoundtripSuccessRate(sources);
    assert.equal(rt.value, 0, 'broken parent_run_id chain must drop success rate to 0');
  });
});
