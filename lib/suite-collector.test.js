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

// ---------------------------------------------------------------------------
// Test: greenfield project (all sources missing)
// ---------------------------------------------------------------------------

test('greenfield project → missing_signal_ratio = 1.0, chains.completeness = null', async () => {
  const root = mktemp();
  const result = await collectSuite(root);

  assert.equal(result.schema_failures_total, 0);
  assert.equal(result.missing_signal_ratio, 1.0); // every expected source missing
  assert.equal(result.chains.total, 0);
  assert.equal(result.chains.completeness, null);
  assert.ok(Array.isArray(result.sources.envelopes));
  assert.ok(Array.isArray(result.sources.hook_logs));
});

// ---------------------------------------------------------------------------
// Test: envelope unwrap for session-receipt and recurring-findings
// ---------------------------------------------------------------------------

test('envelope unwrap surfaces payload + envelope for valid sources', async () => {
  const root = mktemp();

  const sessionEnv = envelope({
    producer: 'deep-work',
    kind: 'session-receipt',
    run_id: 'run-session-1',
    payload: {
      schema_version: '1.0',
      session_id: 'sess-1',
      started_at: '2026-05-11T10:00:00Z',
      outcome: 'merge',
      slices: { total: 3, completed: 3 },
    },
  });
  writeJson(root, '.deep-work/session-receipt.json', sessionEnv);

  const findingsEnv = envelope({
    producer: 'deep-review',
    kind: 'recurring-findings',
    run_id: 'run-findings-1',
    parent_run_id: 'run-session-1', // chain link
    payload: {
      updated_at: '2026-05-11T11:00:00Z',
      findings: [
        { severity: 'medium', occurrences: 3, category: 'cosmetic', description: 'foo' },
      ],
    },
  });
  writeJson(root, '.deep-review/recurring-findings.json', findingsEnv);

  const result = await collectSuite(root);

  const session = result.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'session-receipt'
  );
  assert.ok(session);
  assert.equal(session.envelopes.length, 1);
  assert.equal(session.envelopes[0].payload.session_id, 'sess-1');

  const findings = result.sources.envelopes.find(
    (s) => s.producer === 'deep-review' && s.kind === 'recurring-findings'
  );
  assert.ok(findings);
  assert.equal(findings.envelopes.length, 1);
  assert.equal(findings.envelopes[0].envelope.parent_run_id, 'run-session-1');

  assert.equal(result.chains.total, 1);
  assert.equal(result.chains.resolved, 1);
  assert.equal(result.chains.completeness, 1.0);
});

// ---------------------------------------------------------------------------
// Test: identity mismatch counts as schema failure, not envelope
// ---------------------------------------------------------------------------

test('identity-mismatched envelope is rejected and counted', async () => {
  const root = mktemp();
  // Wrong producer at session-receipt path: deep-evolve emitting under deep-work read path.
  const wrong = envelope({
    producer: 'deep-evolve',
    kind: 'session-receipt',
    run_id: 'r-x',
    payload: { schema_version: '1.0', session_id: 's-1', started_at: '2026-05-11T10:00:00Z', outcome: 'merge', slices: { total: 0 } },
  });
  writeJson(root, '.deep-work/session-receipt.json', wrong);

  const result = await collectSuite(root);
  const session = result.sources.envelopes.find(
    (s) => s.producer === 'deep-work' && s.kind === 'session-receipt'
  );
  assert.equal(session.envelopes.length, 0);
  assert.equal(session.failures.length, 1);
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
    payload: ['not', 'an', 'object'], // hostile/malformed
  });
  const result = await collectSuite(root);
  const src = result.sources.envelopes.find((s) => s.kind === 'session-receipt');
  assert.equal(src.envelopes.length, 0);
  assert.equal(src.failures[0].reason, 'payload-shape-violation');
});

// ---------------------------------------------------------------------------
// Test: chain reconstruction with unresolved parent
// ---------------------------------------------------------------------------

test('unresolved parent_run_id reduces chain completeness', () => {
  const envelopes = [
    {
      envelope: { producer: 'deep-work', artifact_kind: 'session-receipt', run_id: 'A', parent_run_id: undefined },
      payload: {},
      source: 'a',
    },
    {
      envelope: { producer: 'deep-review', artifact_kind: 'recurring-findings', run_id: 'B', parent_run_id: 'A' },
      payload: {},
      source: 'b',
    },
    {
      envelope: { producer: 'deep-evolve', artifact_kind: 'evolve-receipt', run_id: 'C', parent_run_id: 'MISSING' },
      payload: {},
      source: 'c',
    },
  ];
  const r = reconstructChains(envelopes);
  assert.equal(r.total, 2);
  assert.equal(r.resolved, 1);
  assert.equal(r.completeness, 0.5);
});

// ---------------------------------------------------------------------------
// Test: aggregator-pattern envelopes (no parent_run_id) excluded from denominator
// ---------------------------------------------------------------------------

test('aggregator-pattern envelopes (harnessability-report, evolve-insights, index) excluded from chains', () => {
  const envelopes = [
    {
      envelope: { producer: 'deep-dashboard', artifact_kind: 'harnessability-report', run_id: 'H', parent_run_id: 'NOT-SET' },
      payload: {},
      source: 'h',
    },
    {
      envelope: { producer: 'deep-evolve', artifact_kind: 'evolve-insights', run_id: 'I', parent_run_id: 'NOT-SET' },
      payload: {},
      source: 'i',
    },
    {
      envelope: { producer: 'deep-wiki', artifact_kind: 'index', run_id: 'X', parent_run_id: 'NOT-SET' },
      payload: {},
      source: 'x',
    },
  ];
  // Even though all three set parent_run_id, they are aggregator pattern → not chained.
  const r = reconstructChains(envelopes);
  assert.equal(r.total, 0);
  assert.equal(r.completeness, null);
});

// ---------------------------------------------------------------------------
// Test: hook log NDJSON parsing
// ---------------------------------------------------------------------------

test('hook log NDJSON is parsed line-by-line, malformed lines skipped', async () => {
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
  const hookSrc = result.sources.hook_logs.find((h) => h.producer === 'deep-work');
  assert.ok(hookSrc);
  assert.equal(hookSrc.missing, false);
  assert.equal(hookSrc.events.length, 3); // 2 valid + malformed skipped + empty skipped
});

// ---------------------------------------------------------------------------
// Test: missing_signal_ratio reflects partial coverage
// ---------------------------------------------------------------------------

test('missing_signal_ratio reflects how many EXPECTED_SOURCES resolved', async () => {
  const root = mktemp();
  // Provide only 1 of 8 expected sources.
  writeJson(
    root,
    '.deep-work/session-receipt.json',
    envelope({
      producer: 'deep-work',
      kind: 'session-receipt',
      run_id: 'r1',
      payload: {
        schema_version: '1.0',
        session_id: 's1',
        started_at: '2026-05-11T10:00:00Z',
        outcome: 'merge',
        slices: { total: 0 },
      },
    })
  );
  const r = await collectSuite(root);
  // 7 of 8 expected sources missing.
  assert.ok(r.missing_signal_ratio > 0.85 && r.missing_signal_ratio < 0.9);
});

// ---------------------------------------------------------------------------
// Test: wiki_root option overrides project-local path
// ---------------------------------------------------------------------------

test('wiki_root option locates external <wiki_root>/index.json', async () => {
  const projectRoot = mktemp('project-');
  const wikiRoot = mktemp('wiki-');

  writeJson(
    wikiRoot,
    'index.json',
    envelope({
      producer: 'deep-wiki',
      kind: 'index',
      run_id: 'r-wiki',
      payload: { pages: [{ file: 'home.md' }] },
    })
  );

  const r = await collectSuite(projectRoot, { wikiRoot });
  const wikiSrc = r.sources.envelopes.find((s) => s.kind === 'index');
  assert.ok(wikiSrc);
  assert.equal(wikiSrc.envelopes.length, 1);
  assert.equal(wikiSrc.envelopes[0].payload.pages[0].file, 'home.md');
});

// ---------------------------------------------------------------------------
// Test: DEEP_WIKI_ROOT env var
// ---------------------------------------------------------------------------

test('DEEP_WIKI_ROOT env var used when options.wikiRoot absent', async () => {
  const projectRoot = mktemp('project-');
  const wikiRoot = mktemp('wiki-env-');

  writeJson(
    wikiRoot,
    'index.json',
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
// Test: legacy non-envelope JSON at envelope path is treated as schema failure
// ---------------------------------------------------------------------------

test('legacy (non-envelope) JSON at envelope path counts as not-envelope-shape failure', async () => {
  const root = mktemp();
  writeJson(root, '.deep-docs/last-scan.json', {
    // Pre-envelope shape (deep-docs 1.1.0 legacy)
    schema_version: 2,
    documents: [],
    summary: { total_issues: 0, auto_fixable: 0, audit_only: 0 },
  });
  const r = await collectSuite(root);
  const src = r.sources.envelopes.find((s) => s.kind === 'last-scan');
  assert.equal(src.envelopes.length, 0);
  assert.equal(src.failures.length, 1);
  assert.equal(src.failures[0].reason, 'not-envelope-shape');
});

// ---------------------------------------------------------------------------
// Test: SOURCE_SPECS catalog matches EXPECTED_SOURCES (sanity)
// ---------------------------------------------------------------------------

test('SOURCE_SPECS covers all EXPECTED_SOURCES tuples (excluding deep-wiki/index which is handled separately)', async () => {
  // suite-collector calls collectWikiIndex separately, so SOURCE_SPECS lacks wiki/index.
  // EXPECTED_SOURCES has all 8; SOURCE_SPECS has 7 + wiki handled = 8 total.
  const fromSpecs = new Set(_internal.SOURCE_SPECS.map((s) => `${s.producer}/${s.kind}`));
  fromSpecs.add('deep-wiki/index'); // handled separately
  for (const exp of (await import('./suite-constants.js')).EXPECTED_SOURCES) {
    assert.ok(
      fromSpecs.has(`${exp.producer}/${exp.kind}`),
      `missing source spec for ${exp.producer}/${exp.kind}`
    );
  }
});
