import test from 'node:test';
import assert from 'node:assert/strict';
import {
  exportSnapshot,
  snapshotToOtlpPayload,
  _internal,
} from './otel.js';
import { buildSnapshot } from './aggregator.js';
import { collectSuite } from './suite-collector.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'otel-'));
}

async function freshSnapshot() {
  const root = mktemp();
  const collected = await collectSuite(root);
  return buildSnapshot(collected, {
    nowIso: '2026-05-11T13:00:00Z',
    run_id: 'snap-otel-test',
  });
}

// ---------------------------------------------------------------------------
// Endpoint + header parsing
// ---------------------------------------------------------------------------

test('parseHeaders parses comma-separated key=value pairs', () => {
  assert.deepEqual(
    _internal.parseHeaders('api-key=secret,x-tenant=acme'),
    { 'api-key': 'secret', 'x-tenant': 'acme' }
  );
});

test('parseHeaders preserves embedded `=` in values (e.g., base64 tokens)', () => {
  // Round 1 review (Opus W3): indexOf-based split intentionally only splits
  // on the FIRST `=`, so values like base64 tokens ending in `==` survive.
  assert.deepEqual(
    _internal.parseHeaders('auth=Bearer xyz==,api=abc=='),
    { auth: 'Bearer xyz==', api: 'abc==' }
  );
});

test('parseHeaders ignores malformed pairs', () => {
  assert.deepEqual(
    _internal.parseHeaders('no-equals,=empty-key,valid=ok,trailing-eq='),
    { valid: 'ok', 'trailing-eq': '' }
  );
});

test('parseHeaders returns {} for empty/undefined', () => {
  assert.deepEqual(_internal.parseHeaders(''), {});
  assert.deepEqual(_internal.parseHeaders(undefined), {});
});

test('resolveEndpoint appends /v1/metrics when absent', () => {
  assert.equal(_internal.resolveEndpoint('http://localhost:4318'), 'http://localhost:4318/v1/metrics');
  assert.equal(_internal.resolveEndpoint('http://localhost:4318/'), 'http://localhost:4318/v1/metrics');
});

test('resolveEndpoint preserves /v1/metrics when already present', () => {
  assert.equal(
    _internal.resolveEndpoint('https://collector.example.com/v1/metrics'),
    'https://collector.example.com/v1/metrics'
  );
});

// ---------------------------------------------------------------------------
// OTLP payload shape
// ---------------------------------------------------------------------------

test('snapshotToOtlpPayload emits one gauge per non-null M4-core numeric metric', async () => {
  const snap = await freshSnapshot();
  // Mutate metrics: set two M4-core to numeric values
  snap.metrics['suite.dashboard.missing_signal_ratio'].value = 0.5;
  snap.metrics['suite.artifact.schema_failures_total'].value = 3;
  // Other metrics keep their null/null values from greenfield collection
  const payload = snapshotToOtlpPayload(snap);

  assert.equal(payload.resourceMetrics.length, 1);
  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  const names = metrics.map((m) => m.name);
  assert.ok(names.includes('suite.dashboard.missing_signal_ratio'));
  assert.ok(names.includes('suite.artifact.schema_failures_total'));
  // M4-deferred (compaction.frequency etc.) MUST be skipped
  assert.ok(!names.includes('suite.compaction.frequency'));
  // M4-core null-valued metric (block_rate in greenfield) MUST be skipped
  assert.ok(!names.includes('suite.hooks.block_rate'));
});

test('snapshotToOtlpPayload fans out distribution metric (verdict_mix)', async () => {
  const snap = await freshSnapshot();
  snap.metrics['suite.review.verdict_mix'].value = {
    APPROVE: 5,
    CONCERN: 2,
    REQUEST_CHANGES: 1,
  };
  const payload = snapshotToOtlpPayload(snap);
  const names = payload.resourceMetrics[0].scopeMetrics[0].metrics.map((m) => m.name);
  assert.ok(names.includes('suite.review.verdict_mix.approve'));
  assert.ok(names.includes('suite.review.verdict_mix.concern'));
  assert.ok(names.includes('suite.review.verdict_mix.request_changes'));
});

test('snapshotToOtlpPayload skips deferred + null metrics', async () => {
  // After M5 activation: only suite.tests.coverage_per_plugin remains
  // M4-deferred (M5.5). The other 3 M5-deferred IDs were promoted to M4-core
  // but their values stay null in greenfield (no fixtures present) — so they
  // are also skipped, just via the `value === null` rule rather than the
  // tier rule.
  const snap = await freshSnapshot();
  const payload = snapshotToOtlpPayload(snap);
  const names = payload.resourceMetrics[0].scopeMetrics[0].metrics.map((m) => m.name);
  for (const id of [
    'suite.compaction.frequency',
    'suite.compaction.preserved_artifact_ratio',
    'suite.handoff.roundtrip_success_rate',
    'suite.tests.coverage_per_plugin',
  ]) {
    assert.ok(!names.includes(id), `${id} should be skipped`);
  }
});

test('snapshotToOtlpPayload encodes timeUnixNano from collected_at', async () => {
  const snap = await freshSnapshot();
  snap.metrics['suite.dashboard.missing_signal_ratio'].value = 0.25;
  const payload = snapshotToOtlpPayload(snap);
  // Look up the specific metric by name rather than index — iteration order
  // depends on Object.entries which is insertion order but iteration order
  // shouldn't be load-bearing for the test.
  const ratioMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics.find(
    (m) => m.name === 'suite.dashboard.missing_signal_ratio'
  );
  const dp = ratioMetric.gauge.dataPoints[0];
  // 2026-05-11T13:00:00Z = 1778504400000 ms = 1778504400000000000 ns
  assert.equal(dp.timeUnixNano, '1778504400000000000');
  assert.equal(dp.asDouble, 0.25);
});

test('snapshotToOtlpPayload encodes resource attributes', async () => {
  const snap = await freshSnapshot();
  const payload = snapshotToOtlpPayload(snap);
  const attrs = payload.resourceMetrics[0].resource.attributes;
  const findKey = (k) => attrs.find((a) => a.key === k)?.value.stringValue;
  assert.equal(findKey('service.name'), 'deep-dashboard');
  assert.equal(findKey('suite.snapshot.run_id'), 'snap-otel-test');
});

// ---------------------------------------------------------------------------
// exportSnapshot — env-gated, fetcher injectable
// ---------------------------------------------------------------------------

test('exportSnapshot is no-op when OTEL_EXPORTER_OTLP_ENDPOINT unset', async () => {
  const snap = await freshSnapshot();
  const r = await exportSnapshot(snap, { env: {} });
  assert.equal(r.exported, false);
  assert.equal(r.reason, 'no-endpoint');
  assert.equal(r.endpoint, null); // Round 1 review (Opus W5): endpoint field consistent across all return shapes
});

test('exportSnapshot is no-op when endpoint is empty string', async () => {
  const snap = await freshSnapshot();
  const r = await exportSnapshot(snap, { env: { OTEL_EXPORTER_OTLP_ENDPOINT: '' } });
  assert.equal(r.exported, false);
  assert.equal(r.reason, 'no-endpoint');
  assert.equal(r.endpoint, null);
});

test('exportSnapshot rejects scheme-less endpoint with invalid-endpoint-scheme (Round 1: Opus W4)', async () => {
  const snap = await freshSnapshot();
  // Common typo: forgetting http:// prefix
  const r = await exportSnapshot(snap, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'collector.local:4318' },
  });
  assert.equal(r.exported, false);
  assert.equal(r.reason, 'invalid-endpoint-scheme');
  assert.equal(r.endpoint, 'collector.local:4318');
});

test('exportSnapshot accepts both http:// and https:// schemes', async () => {
  const snap = await freshSnapshot();
  const fakeFetch = async () => ({ ok: true, status: 200 });
  const r1 = await exportSnapshot(snap, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://x/v1/metrics' },
    fetcher: fakeFetch,
  });
  assert.equal(r1.exported, true);
  const r2 = await exportSnapshot(snap, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'https://x/v1/metrics' },
    fetcher: fakeFetch,
  });
  assert.equal(r2.exported, true);
});

test('exportSnapshot POSTs to <endpoint>/v1/metrics with OTLP-JSON body', async () => {
  const snap = await freshSnapshot();
  snap.metrics['suite.dashboard.missing_signal_ratio'].value = 0.75;

  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, status: 200 };
  };

  const r = await exportSnapshot(snap, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.local:4318' },
    fetcher: fakeFetch,
  });
  assert.equal(r.exported, true);
  assert.equal(r.status, 200);
  assert.equal(captured.url, 'http://collector.local:4318/v1/metrics');
  assert.equal(captured.init.method, 'POST');
  assert.equal(captured.init.headers['Content-Type'], 'application/json');
  const body = JSON.parse(captured.init.body);
  assert.ok(Array.isArray(body.resourceMetrics));
});

test('exportSnapshot adds OTEL_EXPORTER_OTLP_HEADERS to request headers', async () => {
  const snap = await freshSnapshot();
  let captured;
  const fakeFetch = async (url, init) => {
    captured = init.headers;
    return { ok: true, status: 200 };
  };
  await exportSnapshot(snap, {
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.local:4318',
      OTEL_EXPORTER_OTLP_HEADERS: 'api-key=secret123,x-tenant=acme',
    },
    fetcher: fakeFetch,
  });
  assert.equal(captured['api-key'], 'secret123');
  assert.equal(captured['x-tenant'], 'acme');
  assert.equal(captured['Content-Type'], 'application/json');
});

test('exportSnapshot returns http-NNN reason on non-OK response', async () => {
  const snap = await freshSnapshot();
  const fakeFetch = async () => ({ ok: false, status: 503 });
  const r = await exportSnapshot(snap, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.local:4318' },
    fetcher: fakeFetch,
  });
  assert.equal(r.exported, false);
  assert.equal(r.status, 503);
  assert.equal(r.reason, 'http-503');
});

test('exportSnapshot returns network-error reason on fetch throw', async () => {
  const snap = await freshSnapshot();
  const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
  const r = await exportSnapshot(snap, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.local:4318' },
    fetcher: fakeFetch,
  });
  assert.equal(r.exported, false);
  assert.match(r.reason, /^network-error:ECONNREFUSED/);
});

test('exportSnapshot returns fetch-unavailable when no fetcher provided AND globalThis.fetch missing', async () => {
  const snap = await freshSnapshot();
  // Simulate older Node lacking global fetch by passing null fetcher.
  const r = await exportSnapshot(snap, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector.local:4318' },
    fetcher: null,
  });
  assert.equal(r.exported, false);
  assert.equal(r.reason, 'fetch-unavailable');
  assert.equal(r.endpoint, null); // Round 1 review (Opus W5): endpoint field consistent
});
