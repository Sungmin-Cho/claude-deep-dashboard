import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildSnapshot,
  appendSnapshot,
  readRecentSnapshots,
  _internal,
} from './aggregator.js';
import { collectSuite } from './suite-collector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aggregator-'));
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
// Test: snapshot shape — all 16 metrics emitted, deferred carry deferred_until
// ---------------------------------------------------------------------------

test('buildSnapshot emits all 16 metrics with required envelope (M5 activation)', async () => {
  const root = mktemp();
  const collected = await collectSuite(root);
  const snap = buildSnapshot(collected, { nowIso: '2026-05-11T13:00:00Z', run_id: 'snap-001' });

  assert.equal(snap.run_id, 'snap-001');
  assert.equal(snap.collected_at, '2026-05-11T13:00:00Z');

  const metricIds = Object.keys(snap.metrics);
  assert.equal(metricIds.length, 16);

  // After M5 activation: 1 M4-deferred (suite.tests.coverage_per_plugin → M5.5)
  // The 3 M5-deferred metrics promoted to M4-core (their values stay null in
  // greenfield but their tier flipped).
  const m55Deferred = snap.metrics['suite.tests.coverage_per_plugin'];
  assert.equal(m55Deferred.tier, 'M4-deferred');
  assert.equal(m55Deferred.value, null);
  assert.equal(m55Deferred.deferred_until, 'M5.5');

  // 15 M4-core
  const coreIds = metricIds.filter((id) => snap.metrics[id].tier === 'M4-core');
  assert.equal(coreIds.length, 15);

  // 3 newly-activated M5 metrics carry tier=M4-core (value may be null in greenfield)
  for (const id of [
    'suite.compaction.frequency',
    'suite.compaction.preserved_artifact_ratio',
    'suite.handoff.roundtrip_success_rate',
  ]) {
    assert.equal(snap.metrics[id].tier, 'M4-core', `${id} should be promoted to M4-core`);
    // No deferred_until on activated metrics
    assert.equal(snap.metrics[id].deferred_until, undefined);
  }
});

// ---------------------------------------------------------------------------
// Test: greenfield → core metrics emit null with non-null source_summary
// ---------------------------------------------------------------------------

test('greenfield: M4-core metrics that depend on absent sources emit null', async () => {
  const root = mktemp();
  const collected = await collectSuite(root);
  const snap = buildSnapshot(collected, { nowIso: '2026-05-11T13:00:00Z' });

  // schema_failures_total + missing_signal_ratio are dashboard-self (not null)
  assert.equal(snap.metrics['suite.artifact.schema_failures_total'].value, 0);
  assert.equal(snap.metrics['suite.dashboard.missing_signal_ratio'].value, 1.0);

  // All other M4-core that need external sources → null
  const expectedNullCore = [
    'suite.hooks.block_rate',
    'suite.hooks.error_rate',
    'suite.artifact.freshness_seconds',
    'suite.integrate.recommendation_accept_rate',
    'suite.review.verdict_mix',
    'suite.review.recurring_finding_count',
    'suite.wiki.auto_ingest_candidates_total',
    'suite.docs.auto_fix_accept_rate',
    'suite.evolve.q_delta_per_epoch',
    'suite.cross_plugin.run_id_chain_completeness',
    // M5-activated metrics (greenfield → null since no handoff/compaction-state files)
    'suite.compaction.frequency',
    'suite.compaction.preserved_artifact_ratio',
    'suite.handoff.roundtrip_success_rate',
  ];
  for (const id of expectedNullCore) {
    assert.equal(snap.metrics[id].value, null, `${id} should be null in greenfield`);
  }
});

// ---------------------------------------------------------------------------
// Per-metric tests
// ---------------------------------------------------------------------------

test('block_rate ignores non-hook NDJSON sources (Round 1: 3-way HIGH)', () => {
  // Codex review P2 + Codex adversarial HIGH: previously the denominator
  // included deep-wiki vault log events (kind === 'log'), so a busy wiki
  // log diluted hook block_rate to near-zero. The filter must be kind === 'hook-log'.
  const ndjsonLogs = [
    {
      producer: 'deep-work',
      kind: 'hook-log',
      events: [{ event: 'hook-allow' }, { event: 'hook-block' }],
      missing: false,
    },
    // Wiki vault log — many events, NONE should enter denominator
    {
      producer: 'deep-wiki',
      kind: 'log',
      events: Array.from({ length: 200 }, () => ({ event: 'auto-ingest-candidate' })),
      missing: false,
    },
  ];
  const r = _internal.computeBlockRate(ndjsonLogs);
  // 1 block of 2 hook events → 0.5; wiki events excluded
  assert.equal(r.value, 0.5);
  // source_summary should NOT mention deep-wiki/log
  assert.ok(!Object.keys(r.source_summary).includes('deep-wiki/log'));
});

test('error_rate ignores non-hook NDJSON sources (Round 1: 3-way HIGH)', () => {
  const ndjsonLogs = [
    {
      producer: 'deep-work',
      kind: 'hook-log',
      events: [{ event: 'hook-allow' }, { event: 'hook-error' }],
      missing: false,
    },
    {
      producer: 'deep-wiki',
      kind: 'log',
      events: Array.from({ length: 100 }, () => ({ event: 'unrelated' })),
      missing: false,
    },
  ];
  const r = _internal.computeErrorRate(ndjsonLogs);
  // 1 error of 2 hook events → 0.5
  assert.equal(r.value, 0.5);
});

test('block_rate: 2 blocked of 10 events → 0.2', () => {
  const ndjsonLogs = [
    {
      producer: 'deep-work',
      kind: 'hook-log',
      events: [
        { event: 'hook-allow' },
        { event: 'hook-block' },
        { event: 'hook-allow' },
        { event: 'hook-allow' },
        { event: 'hook-deny' },
      ],
      missing: false,
    },
    {
      producer: 'deep-evolve',
      kind: 'hook-log',
      events: [
        { event: 'hook-allow' },
        { event: 'hook-allow' },
        { event: 'hook-allow' },
        { event: 'hook-allow' },
        { event: 'hook-allow' },
      ],
      missing: false,
    },
  ];
  const r = _internal.computeBlockRate(ndjsonLogs);
  assert.equal(r.value, 0.2);
});

test('error_rate counts hook-error + non-zero exit_code', () => {
  const ndjsonLogs = [
    {
      producer: 'deep-work',
      kind: 'hook-log',
      events: [
        { event: 'hook-allow', exit_code: 0 },
        { event: 'hook-error' },
        { event: 'hook-allow', exit_code: 2 }, // non-zero → counts
        { event: 'hook-exception' },
        { event: 'hook-allow' }, // missing exit_code → not counted
      ],
      missing: false,
    },
  ];
  const r = _internal.computeErrorRate(ndjsonLogs);
  assert.equal(r.value, 3 / 5);
});

test('freshness_seconds picks oldest envelope', () => {
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'session-receipt',
      envelopes: [
        { envelope: { generated_at: '2026-05-11T11:00:00Z' }, payload: {}, source: 'a' },
        { envelope: { generated_at: '2026-05-11T10:00:00Z' }, payload: {}, source: 'b' },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeFreshnessSeconds(envelopeSources, '2026-05-11T12:00:00Z');
  // oldest = 10:00:00 → age = 2h = 7200s
  assert.equal(r.value, 7200);
});

test('integrate_recommendation_accept_rate sums across receipts', () => {
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'session-receipt',
      envelopes: [
        { envelope: {}, payload: { integrate: { accepted: 3, proposed: 5 } }, source: 's1' },
        { envelope: {}, payload: { integrate: { accepted: 1, proposed: 1 } }, source: 's2' },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeIntegrateAcceptRate(envelopeSources);
  assert.equal(r.value, 4 / 6);
});

test('verdict_mix parses **Verdict**: line + severity precedence', () => {
  const root = mktemp();
  fs.mkdirSync(path.join(root, '.deep-review/reports'), { recursive: true });
  fs.writeFileSync(path.join(root, '.deep-review/reports/r1-review.md'),
    '# review 1\n\n**Verdict**: APPROVE\n');
  fs.writeFileSync(path.join(root, '.deep-review/reports/r2-review.md'),
    '# review 2\n\n**Verdict**: REQUEST_CHANGES — must fix\n');
  fs.writeFileSync(path.join(root, '.deep-review/reports/r3-review.md'),
    '# review 3\n\n**Verdict**: CONCERN\n');
  const r = _internal.computeVerdictMix(root);
  assert.deepEqual(r.value, { APPROVE: 1, CONCERN: 1, REQUEST_CHANGES: 1 });
  assert.equal(r.source_summary.parsed, 3);
});

test('verdict parser severity precedence: REQUEST_CHANGES wins on multiline ambiguity', () => {
  const txt = `
| Reviewer | Verdict |
|---|---|
| Opus | APPROVE |
| Codex | REQUEST_CHANGES |

**Verdict**: REQUEST_CHANGES — codex wins
`;
  assert.equal(_internal.parseVerdictFromMarkdown(txt), 'REQUEST_CHANGES');
});

test('verdict parser anchors leading token — prose distractors do not poison (Round 1: Opus W1)', () => {
  // Previously, **Verdict**: APPROVE — no CONCERN raised matched CONCERN
  // (substring poisoning). New leading-anchored regex must return APPROVE.
  const t1 = '**Verdict**: APPROVE — no CONCERN raised';
  assert.equal(_internal.parseVerdictFromMarkdown(t1), 'APPROVE');

  const t2 = '**Verdict**: APPROVE despite REQUEST_CHANGES from reviewer X';
  assert.equal(_internal.parseVerdictFromMarkdown(t2), 'APPROVE');

  const t3 = '**Verdict**: CONCERN — discussed REQUEST_CHANGES alternative';
  assert.equal(_internal.parseVerdictFromMarkdown(t3), 'CONCERN');
});

test('verdict parser handles markdown emphasis on leading token', () => {
  const t1 = '**Verdict**: **APPROVE** — clean';
  assert.equal(_internal.parseVerdictFromMarkdown(t1), 'APPROVE');
  const t2 = '**Verdict**: *REQUEST_CHANGES* — italics';
  assert.equal(_internal.parseVerdictFromMarkdown(t2), 'REQUEST_CHANGES');
  const t3 = '**Verdict**: `CONCERN`';
  assert.equal(_internal.parseVerdictFromMarkdown(t3), 'CONCERN');
});

test('verdict parser: emoji/status prefix + prose distractors — first-token-by-position wins (Round 2: NEW-1)', () => {
  // The pattern used by Codex review reports: ✅ APPROVE prefix.
  // Tier-2 must compare by position, not iterator order — otherwise
  // CONCERN (later in the line) would falsely beat APPROVE (earlier).
  const t1 = '**Verdict**: ✅ APPROVE — no CONCERN raised';
  assert.equal(_internal.parseVerdictFromMarkdown(t1), 'APPROVE');

  const t2 = '**Verdict**: 🔴 REQUEST_CHANGES — APPROVE not reached';
  assert.equal(_internal.parseVerdictFromMarkdown(t2), 'REQUEST_CHANGES');

  const t3 = '**Verdict**: Status: CONCERN — discussed APPROVE alternative';
  assert.equal(_internal.parseVerdictFromMarkdown(t3), 'CONCERN');

  // Table-cell case (no leading prose) — tier-2 still picks the only token.
  const t4 = '**Verdict**: | ✅ | APPROVE |';
  assert.equal(_internal.parseVerdictFromMarkdown(t4), 'APPROVE');
});

test('verdict parser: whole-doc fallback also uses first-token-by-position', () => {
  // No **Verdict**: line at all. The first verdict token in the document wins.
  const t1 = 'Some intro mentioning APPROVE, then later we discuss REQUEST_CHANGES.';
  assert.equal(_internal.parseVerdictFromMarkdown(t1), 'APPROVE');

  const t2 = 'Open question REQUEST_CHANGES raised; later resolved to APPROVE.';
  assert.equal(_internal.parseVerdictFromMarkdown(t2), 'REQUEST_CHANGES');
});

test('verdict_mix returns null when no reports', async () => {
  const root = mktemp();
  const r = _internal.computeVerdictMix(root);
  assert.equal(r.value, null);
});

test('recurring_finding_count: only occurrences >= 2 counted', () => {
  const envelopeSources = [
    {
      producer: 'deep-review',
      kind: 'recurring-findings',
      envelopes: [
        {
          envelope: {},
          payload: {
            findings: [
              { occurrences: 1, severity: 'low' },
              { occurrences: 2, severity: 'medium' },
              { occurrences: 5, severity: 'high' },
              { occurrences: 3, severity: 'low' },
            ],
          },
          source: 'a',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeRecurringFindingCount(envelopeSources);
  assert.equal(r.value, 3); // 2, 5, 3 — all >= 2
});

test('wiki_auto_ingest_total counts auto-ingest-candidate + session-start-detect', () => {
  const ndjsonLogs = [
    {
      producer: 'deep-wiki',
      kind: 'log',
      events: [
        { event: 'auto-ingest-candidate' },
        { event: 'auto-ingest-candidate' },
        { event: 'unrelated' },
        { event: 'session-start-detect' },
      ],
      missing: false,
    },
  ];
  const r = _internal.computeWikiIngestTotal(ndjsonLogs);
  assert.equal(r.value, 3);
});

test('docs_auto_fix_accept_rate: auto_fixable / total_issues', () => {
  const envelopeSources = [
    {
      producer: 'deep-docs',
      kind: 'last-scan',
      envelopes: [
        {
          envelope: {},
          payload: {
            summary: { total_issues: 10, auto_fixable: 7, audit_only: 3 },
          },
          source: 'a',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeDocsAutoFixAcceptRate(envelopeSources);
  assert.equal(r.value, 0.7);
});

test('docs_auto_fix_accept_rate: total_issues = 0 → null', () => {
  const envelopeSources = [
    {
      producer: 'deep-docs',
      kind: 'last-scan',
      envelopes: [
        {
          envelope: {},
          payload: { summary: { total_issues: 0, auto_fixable: 0, audit_only: 0 } },
          source: 'a',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeDocsAutoFixAcceptRate(envelopeSources);
  assert.equal(r.value, null);
});

test('evolve_q_delta_per_epoch: (current - baseline) / epochs', () => {
  const envelopeSources = [
    {
      producer: 'deep-evolve',
      kind: 'evolve-receipt',
      envelopes: [
        {
          envelope: {},
          payload: {
            score: { baseline: 5.0, current: 7.5 },
            evaluation_epochs: 5,
          },
          source: 'a',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeEvolveQDelta(envelopeSources);
  assert.equal(r.value, 0.5);
});

test('evolve_q_delta: epochs = 0 → null (guard against div-by-zero)', () => {
  const envelopeSources = [
    {
      producer: 'deep-evolve',
      kind: 'evolve-receipt',
      envelopes: [
        {
          envelope: {},
          payload: { score: { baseline: 5, current: 6 }, evaluation_epochs: 0 },
          source: 'a',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeEvolveQDelta(envelopeSources);
  assert.equal(r.value, null);
});

// ---------------------------------------------------------------------------
// JSONL append + read round-trip
// ---------------------------------------------------------------------------

test('appendSnapshot creates JSONL file in .deep-dashboard/', async () => {
  const root = mktemp();
  const collected = await collectSuite(root);
  const snap = buildSnapshot(collected, { nowIso: '2026-05-11T13:00:00Z', run_id: 'r-1' });
  const out = appendSnapshot(snap, root);
  assert.ok(out.endsWith('.deep-dashboard/suite-metrics.jsonl'));
  assert.ok(fs.existsSync(out));
  const content = fs.readFileSync(out, 'utf8');
  assert.ok(content.endsWith('\n'));
  const parsed = JSON.parse(content.trim());
  assert.equal(parsed.run_id, 'r-1');
});

test('appendSnapshot is append-only across multiple snapshots', async () => {
  const root = mktemp();
  const collected = await collectSuite(root);
  appendSnapshot(buildSnapshot(collected, { run_id: 'a' }), root);
  appendSnapshot(buildSnapshot(collected, { run_id: 'b' }), root);
  appendSnapshot(buildSnapshot(collected, { run_id: 'c' }), root);
  const last2 = await readRecentSnapshots(root, 2);
  assert.equal(last2.length, 2);
  assert.equal(last2[0].run_id, 'b');
  assert.equal(last2[1].run_id, 'c');
});

test('readRecentSnapshots skips malformed lines', async () => {
  const root = mktemp();
  const collected = await collectSuite(root);
  appendSnapshot(buildSnapshot(collected, { run_id: 'a' }), root);
  // Append a malformed line directly
  fs.appendFileSync(path.join(root, '.deep-dashboard/suite-metrics.jsonl'), '{ NOT VALID }\n');
  appendSnapshot(buildSnapshot(collected, { run_id: 'b' }), root);
  const last3 = await readRecentSnapshots(root, 3);
  // Malformed line dropped → only 2 valid records
  assert.equal(last3.length, 2);
  assert.equal(last3[0].run_id, 'a');
  assert.equal(last3[1].run_id, 'b');
});

test('readRecentSnapshots returns [] when JSONL file absent', async () => {
  const root = mktemp();
  const r = await readRecentSnapshots(root, 5);
  assert.deepEqual(r, []);
});

// ---------------------------------------------------------------------------
// End-to-end: real collected data → snapshot
// ---------------------------------------------------------------------------

test('end-to-end: collectSuite → buildSnapshot produces non-null core metrics when sources present', async () => {
  const root = mktemp();
  // Populate a few envelope sources
  writeJson(root, '.deep-work/session-receipt.json', envelope({
    producer: 'deep-work', kind: 'session-receipt', run_id: 'sess-1',
    generated_at: '2026-05-11T12:30:00Z',
    payload: {
      schema_version: '1.0',
      session_id: 'sess-1',
      started_at: '2026-05-11T10:00:00Z',
      outcome: 'merge',
      slices: { total: 3, completed: 3 },
      integrate: { accepted: 2, proposed: 3 },
    },
  }));
  writeJson(root, '.deep-evolve/evolve-receipt.json', envelope({
    producer: 'deep-evolve', kind: 'evolve-receipt', run_id: 'ev-1',
    generated_at: '2026-05-11T12:00:00Z',
    payload: {
      plugin: 'deep-evolve',
      version: '3.2.0',
      receipt_schema_version: 1,
      timestamp: '2026-05-11T12:00:00Z',
      session_id: 'ev-1',
      goal: 'improve',
      experiments: { total: 5, kept: 3 },
      score: { baseline: 5.0, current: 7.0 },
      evaluation_epochs: 4,
    },
  }));
  writeText(root, '.deep-work/hooks.log.jsonl',
    JSON.stringify({ event: 'hook-allow' }) + '\n' +
    JSON.stringify({ event: 'hook-block' }) + '\n' +
    JSON.stringify({ event: 'hook-error', exit_code: 1 }) + '\n'
  );

  const collected = await collectSuite(root);
  const snap = buildSnapshot(collected, { nowIso: '2026-05-11T13:00:00Z' });

  assert.equal(snap.metrics['suite.integrate.recommendation_accept_rate'].value, 2 / 3);
  assert.equal(snap.metrics['suite.evolve.q_delta_per_epoch'].value, 0.5);
  assert.equal(snap.metrics['suite.hooks.block_rate'].value, 1 / 3);
  // 3 events total; hook-error event (also carries exit_code=1) is one event,
  // not double-counted (OR-clause inside computeErrorRate). Result: 1/3.
  assert.equal(snap.metrics['suite.hooks.error_rate'].value, 1 / 3);
  // freshness = oldest envelope (12:00:00) - now (13:00:00) = 3600s
  assert.equal(snap.metrics['suite.artifact.freshness_seconds'].value, 3600);
});

// ---------------------------------------------------------------------------
// M5-activated metric tests
// ---------------------------------------------------------------------------

test('compaction_frequency: counts compaction-state envelopes', () => {
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'compaction-state',
      envelopes: [
        { envelope: {}, payload: { trigger: 'phase-transition', session_id: 's1' }, source: 'a' },
        { envelope: {}, payload: { trigger: 'slice-green', session_id: 's1' }, source: 'b' },
        { envelope: {}, payload: { trigger: 'phase-transition', session_id: 's2' }, source: 'c' },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeCompactionFrequency(envelopeSources);
  assert.equal(r.value, 3);
  assert.equal(r.source_summary.total_events, 3);
  // Per-session breakdown for dashboard drill-down
  assert.equal(r.source_summary.unique_sessions, 2);
});

test('compaction_frequency: greenfield → null', () => {
  const envelopeSources = [
    { producer: 'deep-work', kind: 'compaction-state', envelopes: [], failures: [] },
  ];
  const r = _internal.computeCompactionFrequency(envelopeSources);
  assert.equal(r.value, null);
});

test('compaction_preserved_artifact_ratio: mean of per-envelope ratios', () => {
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'compaction-state',
      envelopes: [
        // 2 preserved + 2 discarded → 0.5
        {
          envelope: {},
          payload: {
            preserved_artifact_paths: ['a.md', 'b.md'],
            discarded_artifact_paths: ['c.md', 'd.md'],
          },
          source: 'a',
        },
        // 3 preserved + 1 discarded → 0.75
        {
          envelope: {},
          payload: {
            preserved_artifact_paths: ['e.md', 'f.md', 'g.md'],
            discarded_artifact_paths: ['h.md'],
          },
          source: 'b',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeCompactionPreservedArtifactRatio(envelopeSources);
  // mean(0.5, 0.75) = 0.625
  assert.equal(r.value, 0.625);
  assert.equal(r.source_summary.envelopes_with_ratio, 2);
  assert.equal(r.source_summary.envelopes_without_ratio, 0);
});

test('compaction_preserved_artifact_ratio: undefined when discarded_artifact_paths omitted (guide §5)', () => {
  // Per claude-deep-suite/guides/context-management.md §5: when
  // discarded_artifact_paths is omitted, treat ratio as undefined (NOT zero).
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'compaction-state',
      envelopes: [
        {
          envelope: {},
          payload: {
            preserved_artifact_paths: ['a.md', 'b.md'],
            // discarded_artifact_paths omitted
          },
          source: 'a',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeCompactionPreservedArtifactRatio(envelopeSources);
  // No envelope has both fields → metric value is null.
  assert.equal(r.value, null);
  assert.equal(r.source_summary.envelopes_with_ratio, 0);
  assert.equal(r.source_summary.envelopes_without_ratio, 1);
});

test('compaction_preserved_artifact_ratio: full-reset (empty preserved + empty discarded) → undefined', () => {
  // empty preserved + empty discarded → 0/0; undefined.
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'compaction-state',
      envelopes: [
        {
          envelope: {},
          payload: {
            preserved_artifact_paths: [],
            discarded_artifact_paths: [],
          },
          source: 'a',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeCompactionPreservedArtifactRatio(envelopeSources);
  assert.equal(r.value, null);
});

test('handoff_roundtrip_success_rate: 2 handoffs, 1 child envelope → 0.5', () => {
  // long-run-handoff.md §7: roundtrip = a non-aggregator envelope (handoff or
  // receipt) carries parent_run_id pointing at the original handoff's run_id.
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'handoff',
      envelopes: [
        {
          envelope: { producer: 'deep-work', artifact_kind: 'handoff', run_id: 'H1' },
          payload: { handoff_kind: 'phase-5-to-evolve' },
          source: 'h1',
        },
        {
          envelope: { producer: 'deep-work', artifact_kind: 'handoff', run_id: 'H2' },
          payload: { handoff_kind: 'phase-5-to-evolve' },
          source: 'h2',
        },
      ],
      failures: [],
    },
    {
      producer: 'deep-evolve',
      kind: 'evolve-receipt',
      envelopes: [
        // Receipt chains back to H1 — H1 round-tripped.
        {
          envelope: { producer: 'deep-evolve', artifact_kind: 'evolve-receipt', run_id: 'E1', parent_run_id: 'H1' },
          payload: {},
          source: 'e1',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeHandoffRoundtripSuccessRate(envelopeSources);
  assert.equal(r.value, 0.5);
  assert.equal(r.source_summary.handoffs_total, 2);
  assert.equal(r.source_summary.handoffs_roundtripped, 1);
});

test('handoff_roundtrip_success_rate: reverse handoff (deep-evolve producer) also counts (Round 1: C1)', () => {
  // long-run-handoff.md §7: a reverse `evolve-to-deep-work` handoff chained to
  // the original handoff is also a roundtrip signal. After Round 1 fix the
  // implementation aggregates handoffs across BOTH (producer, handoff) sources
  // — forward (deep-work) and reverse (deep-evolve).
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'handoff',
      envelopes: [
        {
          envelope: { producer: 'deep-work', artifact_kind: 'handoff', run_id: 'H1' },
          payload: { handoff_kind: 'phase-5-to-evolve' },
          source: 'h1',
        },
      ],
      failures: [],
    },
    {
      producer: 'deep-evolve',
      kind: 'handoff',
      envelopes: [
        // Reverse handoff in its own (deep-evolve, handoff) source — H2 chains
        // back to H1. H1 round-tripped.
        {
          envelope: { producer: 'deep-evolve', artifact_kind: 'handoff', run_id: 'H2', parent_run_id: 'H1' },
          payload: { handoff_kind: 'evolve-to-deep-work' },
          source: 'h2',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeHandoffRoundtripSuccessRate(envelopeSources);
  // Both H1 and H2 are handoffs. H1 round-tripped (H2 points to it).
  // H2 has no child chaining back → did not round-trip.
  assert.equal(r.source_summary.handoffs_total, 2);
  assert.equal(r.source_summary.handoffs_roundtripped, 1);
  assert.deepEqual(r.source_summary.handoff_producers, ['deep-evolve', 'deep-work']);
  assert.equal(r.value, 0.5);
});

test('handoff_roundtrip_success_rate: aggregator-kind child does NOT count as roundtrip (Round 1: W1)', () => {
  // Catalog contract (metrics-catalog.yaml + computeHandoffRoundtripSuccessRate
  // doc comment): "downstream non-aggregator envelope's parent_run_id chains
  // back". Aggregator envelopes (harnessability-report, evolve-insights,
  // index) are excluded from the child side per long-run-handoff.md §7.
  const envelopeSources = [
    {
      producer: 'deep-work',
      kind: 'handoff',
      envelopes: [
        {
          envelope: { producer: 'deep-work', artifact_kind: 'handoff', run_id: 'H1' },
          payload: { handoff_kind: 'phase-5-to-evolve' },
          source: 'h1',
        },
      ],
      failures: [],
    },
    {
      producer: 'deep-dashboard',
      kind: 'harnessability-report',
      envelopes: [
        // Aggregator envelope with parent_run_id pointing at the handoff —
        // would falsely inflate the metric without the AGGREGATOR_KINDS filter.
        {
          envelope: {
            producer: 'deep-dashboard',
            artifact_kind: 'harnessability-report',
            run_id: 'AGG',
            parent_run_id: 'H1',
          },
          payload: {},
          source: 'agg',
        },
      ],
      failures: [],
    },
  ];
  const r = _internal.computeHandoffRoundtripSuccessRate(envelopeSources);
  // Aggregator envelope is filtered out → no valid child for H1 → 0/1 = 0.
  assert.equal(r.value, 0);
  assert.equal(r.source_summary.handoffs_roundtripped, 0);
});

test('handoff_roundtrip_success_rate: no handoffs → null', () => {
  const envelopeSources = [
    { producer: 'deep-work', kind: 'handoff', envelopes: [], failures: [] },
  ];
  const r = _internal.computeHandoffRoundtripSuccessRate(envelopeSources);
  assert.equal(r.value, null);
});

test('end-to-end: M5 fixtures populate compaction + handoff metrics (no roundtrip)', async () => {
  const root = mktemp();
  // Load canonical fixtures from test/fixtures/ (single source of truth for
  // the M5 envelope shapes — mirror of claude-deep-suite schemas).
  const handoffFixture = JSON.parse(
    fs.readFileSync(new URL('../test/fixtures/handoff.fixture.json', import.meta.url), 'utf8')
  );
  const compactionFixture = JSON.parse(
    fs.readFileSync(new URL('../test/fixtures/compaction-state.fixture.json', import.meta.url), 'utf8')
  );
  writeJson(root, '.deep-work/handoffs/h-001.json', handoffFixture);
  writeJson(root, '.deep-work/compaction-states/c-001.json', compactionFixture);

  const collected = await collectSuite(root);
  const snap = buildSnapshot(collected, { nowIso: '2026-05-11T17:00:00Z' });

  // compaction.frequency = 1 (one compaction-state envelope)
  assert.equal(snap.metrics['suite.compaction.frequency'].value, 1);
  // preserved_ratio: fixture has 2 preserved + 2 discarded → 0.5
  assert.equal(snap.metrics['suite.compaction.preserved_artifact_ratio'].value, 0.5);
  // handoff has no child envelope chaining back → roundtrip_rate = 0
  assert.equal(snap.metrics['suite.handoff.roundtrip_success_rate'].value, 0);
});

test('end-to-end: M5 fixture pair (handoff + chaining evolve-receipt) → roundtrip=1.0 (Round 1: C1+I3)', async () => {
  // Round 1 review fix integration test (C1 + I3):
  //   - C1: handoff metric must discover real producer surface, including
  //         downstream receipts that chain back.
  //   - I3: end-to-end fixture must exercise the happy path, not just zero.
  // The evolve-receipt-roundtrip fixture's parent_run_id intentionally matches
  // the handoff fixture's envelope.run_id (01HX2VR8ABCDEFGHJKMNPQRSTW).
  const root = mktemp();
  const handoffFixture = JSON.parse(
    fs.readFileSync(new URL('../test/fixtures/handoff.fixture.json', import.meta.url), 'utf8')
  );
  const evolveReceiptRoundtrip = JSON.parse(
    fs.readFileSync(new URL('../test/fixtures/evolve-receipt-roundtrip.fixture.json', import.meta.url), 'utf8')
  );
  // Sanity: chain matches.
  assert.equal(
    evolveReceiptRoundtrip.envelope.parent_run_id,
    handoffFixture.envelope.run_id,
    'fixture chain invariant violated'
  );

  writeJson(root, '.deep-work/handoffs/h-001.json', handoffFixture);
  writeJson(root, '.deep-evolve/evolve-receipt.json', evolveReceiptRoundtrip);

  const collected = await collectSuite(root);
  const snap = buildSnapshot(collected, { nowIso: '2026-05-11T17:30:00Z' });

  // 1 handoff, 1 chaining child receipt → 1/1 = 1.0
  assert.equal(snap.metrics['suite.handoff.roundtrip_success_rate'].value, 1.0);
  assert.equal(
    snap.metrics['suite.handoff.roundtrip_success_rate'].source_summary.handoffs_roundtripped,
    1
  );
});

test('end-to-end: reverse handoff fixture (.deep-evolve/handoffs/) discovered + chains back to forward', async () => {
  // Symmetric test for the reverse-handoff producer flow (C1 second half).
  // Forward handoff at deep-work/handoffs/, reverse handoff at
  // .deep-evolve/handoffs/ pointing back via parent_run_id.
  const root = mktemp();
  const forward = JSON.parse(
    fs.readFileSync(new URL('../test/fixtures/handoff.fixture.json', import.meta.url), 'utf8')
  );
  const reverse = {
    schema_version: '1.0',
    envelope: {
      producer: 'deep-evolve',
      producer_version: '3.2.0',
      artifact_kind: 'handoff',
      run_id: '01HX2VREVOLVEHANDOFFXYZAB',
      parent_run_id: forward.envelope.run_id, // chain back to forward
      generated_at: '2026-05-11T18:00:00Z',
      schema: { name: 'handoff', version: '1.0' },
      git: { head: 'd'.repeat(40), branch: 'main', dirty: false },
      provenance: { source_artifacts: [], tool_versions: { node: '20.11.0' } },
    },
    payload: {
      schema_version: '1.0',
      handoff_kind: 'evolve-to-deep-work',
      from: { producer: 'deep-evolve', completed_at: '2026-05-11T18:00:00Z' },
      to: { producer: 'deep-work', intent: 'structural-refactor' },
      summary: 'plateau hit',
      next_action_brief: 'refactor verify loop',
    },
  };
  writeJson(root, '.deep-work/handoffs/forward.json', forward);
  writeJson(root, '.deep-evolve/handoffs/reverse.json', reverse);

  const collected = await collectSuite(root);
  const snap = buildSnapshot(collected, { nowIso: '2026-05-11T18:30:00Z' });

  // 2 handoffs total; only forward roundtripped (reverse chains back to forward
  // but no envelope chains back to reverse) → 1/2 = 0.5
  assert.equal(snap.metrics['suite.handoff.roundtrip_success_rate'].value, 0.5);
  assert.equal(
    snap.metrics['suite.handoff.roundtrip_success_rate'].source_summary.handoffs_total,
    2
  );
});
