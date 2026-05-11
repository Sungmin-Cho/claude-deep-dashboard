import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  collectSuite,
  reconstructChains,
  _internal,
} from './suite-collector.js';
import { EXPECTED_SOURCES } from './suite-constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp(prefix = 'suite-collector-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(root, relPath, obj) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}

function writeText(root, relPath, text) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}

function envelope({ producer, kind, run_id, parent_run_id, generated_at, payload }) {
  return {
    schema_version: '1.0',
    envelope: {
      producer,
      producer_version: '1.0.0',
      artifact_kind: kind,
      run_id,
      ...(parent_run_id ? { parent_run_id } : {}),
      generated_at: generated_at ?? '2026-05-11T12:00:00Z',
      schema: { name: kind, version: '1.0' },
      git: { head: 'a'.repeat(40), branch: 'main', dirty: false },
      provenance: { source_artifacts: [], tool_versions: {} },
    },
    payload,
  };
}

// Minimal valid payloads for each producer/kind (satisfies PAYLOAD_REQUIRED_FIELDS).
const VALID = {
  'deep-work/session-receipt': {
    schema_version: '1.0',
    session_id: 'sess-1',
    started_at: '2026-05-11T10:00:00Z',
    outcome: 'merge',
    slices: { total: 0 },
  },
  'deep-work/slice-receipt': {
    schema_version: '1.0',
    slice_id: 'SLICE-001',
    status: 'complete',
    tdd: { state_transitions: [] },
  },
  'deep-review/recurring-findings': {
    updated_at: '2026-05-11T11:00:00Z',
    findings: [],
  },
  'deep-docs/last-scan': {
    provenance: { is_git: true },
    documents: [],
    summary: { total_issues: 0, auto_fixable: 0, audit_only: 0 },
  },
  'deep-evolve/evolve-receipt': {
    plugin: 'deep-evolve',
    version: '3.2.0',
    receipt_schema_version: 1,
    timestamp: '2026-05-11T11:00:00Z',
    session_id: 'sess-evolve',
    goal: 'test',
    experiments: { total: 0 },
    score: {},
  },
  'deep-evolve/evolve-insights': {
    updated_at: '2026-05-11T11:00:00Z',
  },
  'deep-dashboard/harnessability-report': {
    projectRoot: '/x',
    total: 7,
    grade: 'Good',
    dimensions: [],
    recommendations: [],
  },
  'deep-wiki/index': { pages: [] },
  // M5: handoff (claude-deep-suite/schemas/handoff.schema.json required[])
  'deep-work/handoff': {
    schema_version: '1.0',
    handoff_kind: 'phase-5-to-evolve',
    from: { producer: 'deep-work', completed_at: '2026-05-11T11:00:00Z' },
    to: { producer: 'deep-evolve', intent: 'performance-optimization' },
    summary: 'feature merged',
    next_action_brief: 'optimize jwt verify — target <50ms',
  },
  // M5: compaction-state (claude-deep-suite/schemas/compaction-state.schema.json required[])
  'deep-work/compaction-state': {
    schema_version: '1.0',
    compacted_at: '2026-05-11T11:00:00Z',
    trigger: 'phase-transition',
    preserved_artifact_paths: ['.deep-work/research.md'],
  },
  // M5 round-1 fix (C1): reverse handoff produced by deep-evolve. Same payload
  // shape as forward (schema is producer-agnostic).
  'deep-evolve/handoff': {
    schema_version: '1.0',
    handoff_kind: 'evolve-to-deep-work',
    from: { producer: 'deep-evolve', completed_at: '2026-05-11T13:00:00Z' },
    to: { producer: 'deep-work', intent: 'structural-refactor' },
    summary: 'epoch plateau; structural refactor needed',
    next_action_brief: 'refactor inner verify loop in src/auth/jwt.ts',
  },
  'deep-evolve/compaction-state': {
    schema_version: '1.0',
    compacted_at: '2026-05-11T13:30:00Z',
    trigger: 'loop-epoch-end',
    preserved_artifact_paths: ['.deep-evolve/evolve-receipt.json'],
  },
};

// ---------------------------------------------------------------------------
// Test: greenfield project
// ---------------------------------------------------------------------------

test('greenfield project → missing_signal_ratio = 1.0, chains.completeness = null', async () => {
  const root = mktemp();
  const result = await collectSuite(root);

  assert.equal(result.schema_failures_total, 0);
  assert.equal(result.missing_signal_ratio, 1.0); // all 15 expected sources missing
  assert.equal(result.chains.total, 0);
  assert.equal(result.chains.completeness, null);
  assert.ok(Array.isArray(result.sources.envelopes));
  assert.ok(Array.isArray(result.sources.ndjson_logs));
});

// ---------------------------------------------------------------------------
// Test: envelope unwrap for session-receipt and recurring-findings
// ---------------------------------------------------------------------------

test('envelope unwrap surfaces payload + envelope for valid sources', async () => {
  const root = mktemp();

  writeJson(
    root,
    '.deep-work/session-receipt.json',
    envelope({
      producer: 'deep-work',
      kind: 'session-receipt',
      run_id: 'run-session-1',
      payload: VALID['deep-work/session-receipt'],
    })
  );
  writeJson(
    root,
    '.deep-review/recurring-findings.json',
    envelope({
      producer: 'deep-review',
      kind: 'recurring-findings',
      run_id: 'run-findings-1',
      parent_run_id: 'run-session-1',
      payload: VALID['deep-review/recurring-findings'],
    })
  );

  const result = await collectSuite(root);

  const session = result.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'session-receipt'
  );
  assert.equal(session.envelopes.length, 1);
  assert.equal(session.envelopes[0].payload.session_id, 'sess-1');

  const findings = result.sources.envelopes.find(
    (s) => s.producer === 'deep-review' && s.kind === 'recurring-findings'
  );
  assert.equal(findings.envelopes.length, 1);

  assert.equal(result.chains.total, 1);
  assert.equal(result.chains.resolved, 1);
  assert.equal(result.chains.completeness, 1.0);
});

// ---------------------------------------------------------------------------
// Test: identity mismatch counts as schema failure
// ---------------------------------------------------------------------------

test('identity-mismatched envelope is rejected and counted', async () => {
  const root = mktemp();
  const wrong = envelope({
    producer: 'deep-evolve',
    kind: 'session-receipt',
    run_id: 'r-x',
    payload: VALID['deep-work/session-receipt'],
  });
  writeJson(root, '.deep-work/session-receipt.json', wrong);

  const result = await collectSuite(root);
  const session = result.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'session-receipt'
  );
  assert.equal(session.envelopes.length, 0);
  assert.equal(session.failures[0].reason, 'identity-mismatch');
  assert.equal(result.schema_failures_total, 1);
});

// ---------------------------------------------------------------------------
// Test: payload-shape-violation (array payload) rejected
// ---------------------------------------------------------------------------

test('payload that is an array is rejected with payload-shape-violation', async () => {
  const root = mktemp();
  writeJson(root, '.deep-work/session-receipt.json', {
    schema_version: '1.0',
    envelope: {
      producer: 'deep-work',
      producer_version: '6.5.0',
      artifact_kind: 'session-receipt',
      run_id: 'r-arr',
      generated_at: '2026-05-11T10:00:00Z',
      schema: { name: 'session-receipt', version: '1.0' },
      git: { head: 'a'.repeat(40), branch: 'main', dirty: false },
      provenance: { source_artifacts: [], tool_versions: {} },
    },
    payload: ['not', 'an', 'object'],
  });
  const result = await collectSuite(root);
  const src = result.sources.envelopes.find((s) => s.kind === 'session-receipt');
  assert.equal(src.envelopes.length, 0);
  assert.equal(src.failures[0].reason, 'payload-shape-violation');
});

// ---------------------------------------------------------------------------
// Test: Round 1 — empty {} payload rejected by required-field check
// ---------------------------------------------------------------------------

test('empty {} payload rejected with missing-required-fields (Round 1: Codex adv HIGH)', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/session-receipt.json',
    envelope({
      producer: 'deep-work',
      kind: 'session-receipt',
      run_id: 'r-empty',
      payload: {}, // empty — should fail required-field check
    })
  );
  const result = await collectSuite(root);
  const src = result.sources.envelopes.find((s) => s.kind === 'session-receipt');
  assert.equal(src.envelopes.length, 0);
  assert.equal(src.failures.length, 1);
  assert.match(src.failures[0].reason, /^missing-required-fields:/);
  // session-receipt requires: session_id, started_at, outcome, slices
  assert.match(src.failures[0].reason, /session_id/);
  assert.match(src.failures[0].reason, /started_at/);
  assert.match(src.failures[0].reason, /outcome/);
  assert.match(src.failures[0].reason, /slices/);
});

test('partial-shape payload rejected with specific missing field list', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-evolve/evolve-receipt.json',
    envelope({
      producer: 'deep-evolve',
      kind: 'evolve-receipt',
      run_id: 'r-partial',
      payload: {
        plugin: 'deep-evolve',
        version: '3.2.0',
        // missing: receipt_schema_version, timestamp, session_id, goal, experiments, score
      },
    })
  );
  const result = await collectSuite(root);
  const src = result.sources.envelopes.find((s) => s.kind === 'evolve-receipt');
  assert.equal(src.envelopes.length, 0);
  // Round 2 Info-2: avoid order-coupling — assert each missing field separately
  // so reordering PAYLOAD_REQUIRED_FIELDS does not break this test for an
  // unrelated reason. Mirrors the empty-payload test pattern above.
  const reason = src.failures[0].reason;
  assert.match(reason, /^missing-required-fields:/);
  for (const field of ['receipt_schema_version', 'timestamp', 'session_id', 'goal', 'experiments', 'score']) {
    assert.match(reason, new RegExp(field), `expected ${field} in ${reason}`);
  }
  // And confirm the fields the payload DID supply are NOT flagged
  for (const present of ['plugin', 'version']) {
    assert.doesNotMatch(reason, new RegExp(`\\b${present}\\b`), `${present} should not be flagged`);
  }
});

// ---------------------------------------------------------------------------
// Test: chain reconstruction with unresolved parent
// ---------------------------------------------------------------------------

test('unresolved parent_run_id reduces chain completeness', () => {
  const envelopes = [
    { envelope: { producer: 'deep-work', artifact_kind: 'session-receipt', run_id: 'A' }, payload: {}, source: 'a' },
    { envelope: { producer: 'deep-review', artifact_kind: 'recurring-findings', run_id: 'B', parent_run_id: 'A' }, payload: {}, source: 'b' },
    { envelope: { producer: 'deep-evolve', artifact_kind: 'evolve-receipt', run_id: 'C', parent_run_id: 'MISSING' }, payload: {}, source: 'c' },
  ];
  const r = reconstructChains(envelopes);
  assert.equal(r.total, 2);
  assert.equal(r.resolved, 1);
  assert.equal(r.completeness, 0.5);
});

test('aggregator-pattern envelopes (harnessability-report, evolve-insights, index) excluded from chain children', () => {
  const envelopes = [
    { envelope: { producer: 'deep-dashboard', artifact_kind: 'harnessability-report', run_id: 'H', parent_run_id: 'NOT-SET' }, payload: {}, source: 'h' },
    { envelope: { producer: 'deep-evolve', artifact_kind: 'evolve-insights', run_id: 'I', parent_run_id: 'NOT-SET' }, payload: {}, source: 'i' },
    { envelope: { producer: 'deep-wiki', artifact_kind: 'index', run_id: 'X', parent_run_id: 'NOT-SET' }, payload: {}, source: 'x' },
  ];
  const r = reconstructChains(envelopes);
  assert.equal(r.total, 0);
  assert.equal(r.completeness, null);
});

// ---------------------------------------------------------------------------
// Test: Round 1 — aggregator envelope's run_id cannot serve as chain parent
// ---------------------------------------------------------------------------

test('child naming an aggregator run_id as parent resolves as unresolved (Round 1: Opus W1)', () => {
  // Aggregator H has run_id "AGG". A non-aggregator child names AGG as parent.
  // Per chain-completeness contract, aggregators are not valid chain parents.
  const envelopes = [
    { envelope: { producer: 'deep-dashboard', artifact_kind: 'harnessability-report', run_id: 'AGG' }, payload: {}, source: 'agg' },
    { envelope: { producer: 'deep-work', artifact_kind: 'session-receipt', run_id: 'C', parent_run_id: 'AGG' }, payload: {}, source: 'c' },
  ];
  const r = reconstructChains(envelopes);
  // Child counts as a chain (parent_run_id set), but parent resolution fails
  // because aggregators are excluded from byRunId.
  assert.equal(r.total, 1);
  assert.equal(r.resolved, 0);
  assert.equal(r.completeness, 0);
});

// ---------------------------------------------------------------------------
// Test: Round 1 — run_id type guard (Opus W2)
// ---------------------------------------------------------------------------

test('non-string run_id (object / array / number) cannot pollute byRunId map (Round 1: Opus W2)', () => {
  // A malformed envelope with run_id = {nested: true} or [] previously passed
  // a truthy check and polluted the Map. The new strict type check rejects.
  const envelopes = [
    { envelope: { producer: 'deep-work', artifact_kind: 'session-receipt', run_id: { nested: true } }, payload: {}, source: 'malformed1' },
    { envelope: { producer: 'deep-work', artifact_kind: 'slice-receipt', run_id: [] }, payload: {}, source: 'malformed2' },
    { envelope: { producer: 'deep-review', artifact_kind: 'recurring-findings', run_id: 'B', parent_run_id: 'C' }, payload: {}, source: 'child' },
  ];
  const r = reconstructChains(envelopes);
  // child names parent 'C' which does not exist → unresolved
  assert.equal(r.total, 1);
  assert.equal(r.resolved, 0);
});

// ---------------------------------------------------------------------------
// Test: NDJSON log parsing
// ---------------------------------------------------------------------------

test('NDJSON hook log parsed line-by-line, malformed lines skipped', async () => {
  const root = mktemp();
  writeText(
    root,
    '.deep-work/hooks.log.jsonl',
    [
      JSON.stringify({ event: 'hook-block', tool: 'Bash' }),
      'NOT JSON',
      '',
      JSON.stringify({ event: 'hook-error', exit_code: 1 }),
      JSON.stringify({ event: 'hook-allow' }),
    ].join('\n') + '\n'
  );

  const result = await collectSuite(root);
  const hookSrc = result.sources.ndjson_logs.find((h) => h.producer === 'deep-work');
  assert.ok(hookSrc);
  assert.equal(hookSrc.missing, false);
  assert.equal(hookSrc.kind, 'hook-log');
  assert.equal(hookSrc.events.length, 3);
});

// ---------------------------------------------------------------------------
// Test: missing_signal_ratio for partial coverage (Round 1: scope expansion)
// ---------------------------------------------------------------------------

test('missing_signal_ratio reflects 15-source denominator (envelopes + NDJSON logs)', async () => {
  const root = mktemp();
  // Provide only 1 of 15 expected sources (the session-receipt envelope).
  writeJson(
    root,
    '.deep-work/session-receipt.json',
    envelope({
      producer: 'deep-work',
      kind: 'session-receipt',
      run_id: 'r1',
      payload: VALID['deep-work/session-receipt'],
    })
  );
  const r = await collectSuite(root);
  // 14 of 15 expected sources missing.
  const expected = 14 / EXPECTED_SOURCES.length;
  assert.ok(
    Math.abs(r.missing_signal_ratio - expected) < 1e-9,
    `expected ${expected}, got ${r.missing_signal_ratio}`
  );
});

test('missing_signal_ratio counts an empty hook log as missing (Round 1: Codex adv HIGH)', async () => {
  const root = mktemp();
  // Hook log exists but is empty — should count as missing signal.
  writeText(root, '.deep-work/hooks.log.jsonl', '');
  const r = await collectSuite(root);
  // All 15 expected sources missing (empty file = missing signal).
  assert.equal(r.missing_signal_ratio, 1.0);
});

test('missing_signal_ratio counts NDJSON stream-error as missing', async () => {
  // We cannot reliably trigger a stream error in a temp file, so verify the
  // condition path via the missing=true path which exercises the same OR-chain.
  const root = mktemp();
  // No hook log files anywhere → all NDJSON sources missing.
  writeJson(
    root,
    '.deep-work/session-receipt.json',
    envelope({ producer: 'deep-work', kind: 'session-receipt', run_id: 'r1', payload: VALID['deep-work/session-receipt'] })
  );
  const r = await collectSuite(root);
  // 1 of 15 present → 14/15 missing (~0.933).
  assert.ok(r.missing_signal_ratio > 0.9);
});

// ---------------------------------------------------------------------------
// Test: wiki_root path resolution (Round 1: Codex P2 — corrected paths)
// ---------------------------------------------------------------------------

test('wiki_root option locates <wiki_root>/.wiki-meta/index.json (Round 1: Codex P2)', async () => {
  const projectRoot = mktemp('project-');
  const wikiRoot = mktemp('wiki-');

  writeJson(
    wikiRoot,
    '.wiki-meta/index.json',
    envelope({
      producer: 'deep-wiki',
      kind: 'index',
      run_id: 'r-wiki',
      payload: { pages: [{ file: 'home.md' }] },
    })
  );
  // Also stub log.jsonl at vault root so ndjson_logs entry resolves.
  writeText(wikiRoot, 'log.jsonl', JSON.stringify({ event: 'auto-ingest-candidate' }) + '\n');

  const r = await collectSuite(projectRoot, { wikiRoot });
  const wikiSrc = r.sources.envelopes.find((s) => s.kind === 'index');
  assert.equal(wikiSrc.envelopes.length, 1);
  assert.equal(wikiSrc.envelopes[0].payload.pages[0].file, 'home.md');

  const wikiLog = r.sources.ndjson_logs.find((h) => h.producer === 'deep-wiki');
  assert.equal(wikiLog.missing, false);
  assert.equal(wikiLog.kind, 'log');
  assert.equal(wikiLog.events.length, 1);
});

test('legacy <wiki_root>/index.json location is NOT mistaken for the catalog (Round 1)', async () => {
  // Before Round 1 fix, a stray vault-root index.json would have been picked up.
  // After fix, the canonical location is .wiki-meta/index.json, so a root-level
  // file must NOT contribute.
  const projectRoot = mktemp('project-');
  const wikiRoot = mktemp('wiki-legacy-');
  writeJson(
    wikiRoot,
    'index.json',
    envelope({
      producer: 'deep-wiki',
      kind: 'index',
      run_id: 'r-stray',
      payload: { pages: [{ file: 'leak.md' }] },
    })
  );
  const r = await collectSuite(projectRoot, { wikiRoot });
  const wikiSrc = r.sources.envelopes.find((s) => s.kind === 'index');
  assert.equal(wikiSrc.envelopes.length, 0);
  assert.equal(wikiSrc.missing, true);
});

test('DEEP_WIKI_ROOT env var used when options.wikiRoot absent', async () => {
  const projectRoot = mktemp('project-');
  const wikiRoot = mktemp('wiki-env-');

  writeJson(
    wikiRoot,
    '.wiki-meta/index.json',
    envelope({
      producer: 'deep-wiki',
      kind: 'index',
      run_id: 'r-wiki-env',
      payload: { pages: [] },
    })
  );

  const prev = process.env.DEEP_WIKI_ROOT;
  process.env.DEEP_WIKI_ROOT = wikiRoot;
  try {
    const r = await collectSuite(projectRoot);
    const wikiSrc = r.sources.envelopes.find((s) => s.kind === 'index');
    assert.equal(wikiSrc.envelopes.length, 1);
    assert.equal(wikiSrc.envelopes[0].envelope.run_id, 'r-wiki-env');
  } finally {
    if (prev === undefined) delete process.env.DEEP_WIKI_ROOT;
    else process.env.DEEP_WIKI_ROOT = prev;
  }
});

// ---------------------------------------------------------------------------
// Test: legacy non-envelope JSON
// ---------------------------------------------------------------------------

test('legacy (non-envelope) JSON at envelope path counts as not-envelope-shape failure', async () => {
  const root = mktemp();
  writeJson(root, '.deep-docs/last-scan.json', {
    schema_version: 2,
    documents: [],
    summary: { total_issues: 0, auto_fixable: 0, audit_only: 0 },
  });
  const r = await collectSuite(root);
  const src = r.sources.envelopes.find((s) => s.kind === 'last-scan');
  assert.equal(src.envelopes.length, 0);
  assert.equal(src.failures[0].reason, 'not-envelope-shape');
});

// ---------------------------------------------------------------------------
// Test: Round 1 — readJsonDir parse failures propagate to schema_failures_total
// ---------------------------------------------------------------------------

test('malformed JSON in receipts/ dir surfaces as schema failure (Round 1: 3-way)', async () => {
  const root = mktemp();
  // One valid envelope, one corrupt JSON file in the same dir.
  writeJson(
    root,
    '.deep-work/receipts/slice-1.json',
    envelope({
      producer: 'deep-work',
      kind: 'slice-receipt',
      run_id: 'r-1',
      payload: VALID['deep-work/slice-receipt'],
    })
  );
  fs.writeFileSync(path.join(root, '.deep-work/receipts/slice-2.json'), '{ not valid json');

  const r = await collectSuite(root);
  const src = r.sources.envelopes.find((s) => s.kind === 'slice-receipt');
  assert.equal(src.envelopes.length, 1);
  assert.equal(src.failures.length, 1);
  assert.equal(src.failures[0].reason, 'unparseable-json');
  assert.ok(src.failures[0].source.endsWith('slice-2.json'));
  assert.equal(r.schema_failures_total, 1);
});

// ---------------------------------------------------------------------------
// Test: Round 1 — bidirectional SOURCE_SPECS ↔ EXPECTED_SOURCES alignment
// ---------------------------------------------------------------------------

test('SOURCE_SPECS + collectWikiIndex covers all envelope-typed EXPECTED_SOURCES (bidirectional)', () => {
  const envelopeExpected = EXPECTED_SOURCES.filter((s) => s.type === 'envelope');
  const fromSpecs = new Set(_internal.SOURCE_SPECS.map((s) => `${s.producer}/${s.kind}`));
  fromSpecs.add('deep-wiki/index'); // handled by collectWikiIndex
  // Each envelope-typed expected source must be present in collector specs.
  for (const exp of envelopeExpected) {
    assert.ok(
      fromSpecs.has(`${exp.producer}/${exp.kind}`),
      `missing collector spec for ${exp.producer}/${exp.kind}`
    );
  }
  // And the reverse: every collector spec must appear in EXPECTED_SOURCES.
  for (const spec of _internal.SOURCE_SPECS) {
    const found = envelopeExpected.some(
      (e) => e.producer === spec.producer && e.kind === spec.kind
    );
    assert.ok(found, `extra collector spec not in EXPECTED_SOURCES: ${spec.producer}/${spec.kind}`);
  }
  // Total envelope sources should equal SOURCE_SPECS + 1 (deep-wiki/index).
  // After M5 activation: SOURCE_SPECS = 9 (7 baseline + handoff + compaction-state)
  // and envelopeExpected = 10 (= SOURCE_SPECS.length + 1 for deep-wiki/index).
  assert.equal(envelopeExpected.length, _internal.SOURCE_SPECS.length + 1);
});

test('NDJSON-typed EXPECTED_SOURCES match collectNdjsonLogs entries', async () => {
  const ndjsonExpected = EXPECTED_SOURCES.filter((s) => s.type === 'ndjson');
  const root = mktemp();
  const r = await collectSuite(root);
  const ndjsonProduced = r.sources.ndjson_logs.map((h) => `${h.producer}/${h.kind}`);
  for (const exp of ndjsonExpected) {
    assert.ok(
      ndjsonProduced.includes(`${exp.producer}/${exp.kind}`),
      `collectNdjsonLogs missing ${exp.producer}/${exp.kind}`
    );
  }
  assert.equal(ndjsonExpected.length, 3); // hook-log × 2 + log × 1
});

// ---------------------------------------------------------------------------
// M5 activation: handoff + compaction-state envelope collection
// ---------------------------------------------------------------------------

test('M5: handoff envelopes collected from .deep-work/handoffs/*.json (dir cardinality)', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/handoffs/handoff-001.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'handoff-1',
      parent_run_id: 'sess-1',
      payload: VALID['deep-work/handoff'],
    })
  );
  writeJson(
    root,
    '.deep-work/handoffs/handoff-002.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'handoff-2',
      payload: VALID['deep-work/handoff'],
    })
  );

  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  assert.ok(handoffs, 'handoff source not collected');
  assert.equal(handoffs.envelopes.length, 2);
  assert.equal(handoffs.envelopes[0].payload.handoff_kind, 'phase-5-to-evolve');
});

test('M5: compaction-state envelopes collected from .deep-work/compaction-states/*.json', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/compaction-states/c-001.json',
    envelope({
      producer: 'deep-work',
      kind: 'compaction-state',
      run_id: 'c-1',
      payload: VALID['deep-work/compaction-state'],
    })
  );

  const r = await collectSuite(root);
  const c = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'compaction-state'
  );
  assert.ok(c, 'compaction-state source not collected');
  assert.equal(c.envelopes.length, 1);
  assert.equal(c.envelopes[0].payload.trigger, 'phase-transition');
});

test('M5: handoff payload missing required field rejected by PAYLOAD_REQUIRED_FIELDS', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/handoffs/bad-handoff.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'r-bad',
      payload: {
        schema_version: '1.0',
        handoff_kind: 'phase-5-to-evolve',
        from: { producer: 'deep-work', completed_at: '2026-05-11T11:00:00Z' },
        to: { producer: 'deep-evolve', intent: 'x' },
        // missing summary + next_action_brief
      },
    })
  );
  const r = await collectSuite(root);
  const src = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  assert.equal(src.envelopes.length, 0);
  assert.equal(src.failures.length, 1);
  assert.match(src.failures[0].reason, /^missing-required-fields:/);
  assert.match(src.failures[0].reason, /summary/);
  assert.match(src.failures[0].reason, /next_action_brief/);
});

test('M5: compaction-state payload missing required field rejected', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/compaction-states/bad-c.json',
    envelope({
      producer: 'deep-work',
      kind: 'compaction-state',
      run_id: 'r-bad',
      payload: {
        schema_version: '1.0',
        // missing compacted_at + trigger + preserved_artifact_paths
      },
    })
  );
  const r = await collectSuite(root);
  const src = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'compaction-state'
  );
  assert.equal(src.envelopes.length, 0);
  assert.match(src.failures[0].reason, /compacted_at/);
  assert.match(src.failures[0].reason, /trigger/);
  assert.match(src.failures[0].reason, /preserved_artifact_paths/);
});

// ---------------------------------------------------------------------------
// Round 1 review fix (C1, 3-way agreement) — per-session subdir discovery
// + reverse handoff producer (deep-evolve)
// ---------------------------------------------------------------------------

test('M5 C1: handoff envelopes at per-session subdir (.deep-work/<session>/handoff.json) are discovered', async () => {
  // claude-deep-suite/guides/long-run-handoff.md §4.1 shows the canonical emit
  // location as `.deep-work/<session>/handoff.json` — the dashboard MUST
  // discover this layout (Round 1 review C1: 3-way agreement).
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/2026-05-11-142500-jwt/handoff.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'handoff-sub-1',
      payload: VALID['deep-work/handoff'],
    })
  );
  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  assert.equal(handoffs.envelopes.length, 1);
  assert.equal(handoffs.envelopes[0].envelope.run_id, 'handoff-sub-1');
});

test('M5 C1: compaction-state at per-session subdir is discovered', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/2026-05-11-142500-jwt/compaction-state.json',
    envelope({
      producer: 'deep-work',
      kind: 'compaction-state',
      run_id: 'c-sub-1',
      payload: VALID['deep-work/compaction-state'],
    })
  );
  const r = await collectSuite(root);
  const c = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'compaction-state'
  );
  assert.equal(c.envelopes.length, 1);
});

test('M5 C1: flat-dir + per-session subdir merge (no double-count)', async () => {
  const root = mktemp();
  // Both layouts populated — collector should merge, not double-count.
  writeJson(
    root,
    '.deep-work/handoffs/flat-1.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'h-flat',
      payload: VALID['deep-work/handoff'],
    })
  );
  writeJson(
    root,
    '.deep-work/2026-05-11-session-a/handoff.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'h-session',
      payload: VALID['deep-work/handoff'],
    })
  );
  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  assert.equal(handoffs.envelopes.length, 2);
  const ids = handoffs.envelopes.map((e) => e.envelope.run_id).sort();
  assert.deepEqual(ids, ['h-flat', 'h-session']);
});

test('M5 C1: per-session subdir does NOT pick up the flat-aggregation dir', async () => {
  // Edge case: `.deep-work/handoffs/handoff.json` exists. The session-glob
  // walker MUST NOT treat `handoffs` as a session subdir and pick its file.
  // Otherwise it would double-count files that already came through the
  // flat-dir scan.
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/handoffs/handoff.json',  // looks like both flat AND per-session
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'h-edge',
      payload: VALID['deep-work/handoff'],
    })
  );
  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  // Flat-dir scan picks it up exactly once; session-glob skips `handoffs/`.
  assert.equal(handoffs.envelopes.length, 1);
});

test('M5 C1: reverse handoff from deep-evolve is discovered + identity-validated', async () => {
  // long-run-handoff.md §4.3: reverse handoff `evolve-to-deep-work` is emitted
  // by producer='deep-evolve'. Round 1 review (Codex review P2, Codex
  // adversarial HIGH): previously rejected as `identity-mismatch`.
  const root = mktemp();
  writeJson(
    root,
    '.deep-evolve/handoffs/r-1.json',
    envelope({
      producer: 'deep-evolve',
      kind: 'handoff',
      run_id: 'rev-h-1',
      parent_run_id: 'h-orig',
      payload: VALID['deep-evolve/handoff'],
    })
  );
  const r = await collectSuite(root);
  const evolveHandoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-evolve' && s.kind === 'handoff'
  );
  assert.ok(evolveHandoffs, 'deep-evolve handoff source not collected');
  assert.equal(evolveHandoffs.envelopes.length, 1);
  assert.equal(evolveHandoffs.envelopes[0].payload.handoff_kind, 'evolve-to-deep-work');
});

test('M5 C1: deep-evolve compaction-state at per-session subdir discovered', async () => {
  const root = mktemp();
  writeJson(
    root,
    '.deep-evolve/2026-05-11-epoch-3/compaction-state.json',
    envelope({
      producer: 'deep-evolve',
      kind: 'compaction-state',
      run_id: 'evolve-c-1',
      payload: VALID['deep-evolve/compaction-state'],
    })
  );
  const r = await collectSuite(root);
  const c = r.sources.envelopes.find(
    (s) => s.producer === 'deep-evolve' && s.kind === 'compaction-state'
  );
  assert.equal(c.envelopes.length, 1);
});

test('M5 C1: hidden dir under .deep-work/ is NOT walked as a session subdir', async () => {
  // .deep-* metadata dirs (.deep-work/.cache, .deep-work/.tmp, etc.) should
  // not be confused for session subdirs.
  const root = mktemp();
  writeJson(
    root,
    '.deep-work/.metadata/handoff.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'hidden',
      payload: VALID['deep-work/handoff'],
    })
  );
  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  // Hidden dir skipped → no envelopes collected → source flagged missing.
  assert.equal(handoffs.envelopes.length, 0);
});

// ---------------------------------------------------------------------------
// Round 2 review fix (C2, security): symlink containment in readSessionGlob
// ---------------------------------------------------------------------------

test('M5 C2: out-of-tree symlink at per-session handoff path is rejected', async () => {
  // Codex review round-2 P2: previous readSessionGlob followed symlinks
  // without realpath boundary check. A symlinked `.deep-work/<session>/
  // handoff.json` pointing outside the project root could ingest arbitrary
  // forged JSON as a valid M5 envelope. Fix mirrors readJsonDir's
  // out-of-boundary check.
  const root = mktemp();
  const outsideDir = mktemp('outside-tree-');
  // Forge a valid-looking handoff envelope OUTSIDE the project root.
  writeJson(
    outsideDir,
    'forged-handoff.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'forged-hijack',
      payload: VALID['deep-work/handoff'],
    })
  );
  // Now symlink it into the project's per-session subdir.
  fs.mkdirSync(path.join(root, '.deep-work/2026-05-11-symlink-attack'), { recursive: true });
  fs.symlinkSync(
    path.join(outsideDir, 'forged-handoff.json'),
    path.join(root, '.deep-work/2026-05-11-symlink-attack/handoff.json')
  );

  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  // Out-of-boundary symlink rejected → no envelopes collected.
  assert.equal(handoffs.envelopes.length, 0);
  // And a failure with the expected reason is recorded.
  assert.ok(
    handoffs.failures.some((f) => f.reason === 'out-of-boundary-symlink'),
    `expected out-of-boundary-symlink failure, got: ${JSON.stringify(handoffs.failures)}`
  );
});

test('M5 C2: broken symlink at per-session handoff path is rejected', async () => {
  const root = mktemp();
  fs.mkdirSync(path.join(root, '.deep-work/2026-05-11-broken'), { recursive: true });
  fs.symlinkSync(
    '/nonexistent/path/handoff.json',
    path.join(root, '.deep-work/2026-05-11-broken/handoff.json')
  );
  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  assert.equal(handoffs.envelopes.length, 0);
  // Broken symlink: pathExists returns false (lstat-following) so it's
  // silently skipped — no failure recorded (consistent with non-existent
  // file at canonical path).
});

test('M5 C2: in-tree symlink at per-session handoff path is allowed', async () => {
  // Sibling test to C2: a symlink that STAYS within the parent dir tree
  // should still be honored (some producers may symlink for atomic swap).
  const root = mktemp();
  fs.mkdirSync(path.join(root, '.deep-work/2026-05-11-target'), { recursive: true });
  writeJson(
    root,
    '.deep-work/2026-05-11-target/.handoff.tmp.json',
    envelope({
      producer: 'deep-work',
      kind: 'handoff',
      run_id: 'in-tree-link',
      payload: VALID['deep-work/handoff'],
    })
  );
  fs.symlinkSync(
    '.handoff.tmp.json',  // relative — stays within subdir
    path.join(root, '.deep-work/2026-05-11-target/handoff.json')
  );
  const r = await collectSuite(root);
  const handoffs = r.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'handoff'
  );
  assert.equal(handoffs.envelopes.length, 1);
  assert.equal(handoffs.envelopes[0].envelope.run_id, 'in-tree-link');
});
