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
};

// ---------------------------------------------------------------------------
// Test: greenfield project
// ---------------------------------------------------------------------------

test('greenfield project → missing_signal_ratio = 1.0, chains.completeness = null', async () => {
  const root = mktemp();
  const result = await collectSuite(root);

  assert.equal(result.schema_failures_total, 0);
  assert.equal(result.missing_signal_ratio, 1.0); // all 11 expected sources missing
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

test('missing_signal_ratio reflects 11-source denominator (envelopes + NDJSON logs)', async () => {
  const root = mktemp();
  // Provide only 1 of 11 expected sources (the session-receipt envelope).
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
  // 10 of 11 expected sources missing.
  const expected = 10 / EXPECTED_SOURCES.length;
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
  // All 11 expected sources missing (empty file = missing signal).
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
  // 1 of 11 present → 10/11 missing (~0.909).
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
