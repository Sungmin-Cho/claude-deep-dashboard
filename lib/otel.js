/**
 * Suite Telemetry OTel Exporter — M4 §4.5 (OPTIONAL)
 *
 * Sends a metric snapshot to an OTLP/HTTP-JSON endpoint when activated via
 * `OTEL_EXPORTER_OTLP_ENDPOINT`. When the env var is unset (or set to empty
 * string), this module is a no-op — the default M4 output path remains JSONL
 * + markdown.
 *
 * Why OTLP/HTTP-JSON specifically?
 * - Zero new runtime dependency (we POST a JSON body, no protobuf needed).
 * - OTLP is the standard OpenTelemetry exchange format.
 * - Most collectors (otel-collector, Jaeger, Prometheus-otel-bridge) accept
 *   it out of the box.
 *
 * What is exported?
 * - Each numeric M4-core metric → one OTLP `gauge` data point.
 * - The distribution metric `suite.review.verdict_mix` → three separate
 *   gauges (`suite.review.verdict_mix.approve` / `.concern` / `.request_changes`).
 * - M4-deferred metrics → skipped (null is not representable in OTLP).
 *
 * Endpoint resolution:
 * - `OTEL_EXPORTER_OTLP_ENDPOINT` is required. Optional `OTEL_EXPORTER_OTLP_HEADERS`
 *   (comma-separated `key=value` pairs) for auth.
 * - The exporter POSTs to `${endpoint}/v1/metrics`; if the endpoint already
 *   ends with `/v1/metrics`, no double-suffixing.
 *
 * Failures are non-fatal:
 *   - Endpoint unset → return `{ exported: false, reason: 'no-endpoint' }`.
 *   - HTTP failure → return `{ exported: false, reason: '<http-status-or-error>' }`.
 *   - Caller chooses whether to bubble up.
 */

const OTLP_PATH = '/v1/metrics';

function parseHeaders(raw) {
  if (!raw) return {};
  const out = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function resolveEndpoint(rawEndpoint) {
  const trimmed = rawEndpoint.replace(/\/+$/, '');
  if (trimmed.endsWith(OTLP_PATH)) return trimmed;
  return trimmed + OTLP_PATH;
}

/**
 * Convert one M4 snapshot into the OTLP/HTTP-JSON payload shape.
 *
 *   {
 *     resourceMetrics: [
 *       {
 *         resource: { attributes: [{key, value: {stringValue}}] },
 *         scopeMetrics: [
 *           { scope: { name }, metrics: [{ name, gauge: { dataPoints: [...] } }] }
 *         ]
 *       }
 *     ]
 *   }
 *
 * Each gauge data point carries `asDouble` + `timeUnixNano` (snapshot ts).
 * Skip rules:
 *   - tier !== 'M4-core'  → skip (M4-deferred have null values).
 *   - value === null      → skip.
 *   - distribution        → emit one gauge per key (`<metric_id>.<key>`).
 */
export function snapshotToOtlpPayload(snapshot) {
  const timeUnixNano = String(Date.parse(snapshot.collected_at) * 1_000_000);
  const dataPoints = [];

  for (const [id, m] of Object.entries(snapshot.metrics)) {
    if (m.tier !== 'M4-core') continue;
    if (m.value === null) continue;

    if (typeof m.value === 'number') {
      dataPoints.push({
        name: id,
        unit: m.unit,
        gauge: {
          dataPoints: [{
            asDouble: m.value,
            timeUnixNano,
          }],
        },
      });
      continue;
    }
    if (typeof m.value === 'object' && m.value !== null && !Array.isArray(m.value)) {
      // Distribution — fan out one gauge per key.
      for (const [k, v] of Object.entries(m.value)) {
        if (typeof v !== 'number') continue;
        dataPoints.push({
          name: `${id}.${String(k).toLowerCase()}`,
          unit: 'count',
          gauge: {
            dataPoints: [{
              asDouble: v,
              timeUnixNano,
            }],
          },
        });
      }
    }
  }

  return {
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'deep-dashboard' } },
            { key: 'suite.snapshot.run_id', value: { stringValue: String(snapshot.run_id ?? '') } },
            { key: 'suite.project_root', value: { stringValue: String(snapshot.project_root ?? '') } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'deep-dashboard.suite-telemetry', version: '1.3.0' },
            metrics: dataPoints,
          },
        ],
      },
    ],
  };
}

/**
 * Export a snapshot. Returns `{ exported, status?, reason?, endpoint? }`.
 *
 * @param {object} snapshot — aggregator buildSnapshot() output
 * @param {object} [options]
 * @param {object} [options.env] — env-var bag (default: process.env). Injectable for tests.
 * @param {Function} [options.fetcher] — fetch-shaped function (default: globalThis.fetch). Injectable.
 * @returns {Promise<{ exported: boolean, status?: number, reason?: string, endpoint?: string }>}
 */
export async function exportSnapshot(snapshot, options = {}) {
  const env = options.env ?? process.env;
  // `'fetcher' in options` distinguishes "explicit null/undefined" (caller
  // wants the no-fetch path, e.g., test injection) from "omitted" (use the
  // platform default).  `??` collapses null and undefined, hiding the
  // explicit-null intent — so the check stays property-presence-based.
  const fetcher = 'fetcher' in options ? options.fetcher : globalThis.fetch;

  const rawEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!rawEndpoint || rawEndpoint.trim() === '') {
    return { exported: false, reason: 'no-endpoint', endpoint: null };
  }
  // Round 1 review (Opus W4): catch accidental scheme-less endpoints (e.g.,
  // `collector.local:4318`) before fetch throws an opaque "Invalid URL" error.
  const trimmed = rawEndpoint.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return { exported: false, reason: 'invalid-endpoint-scheme', endpoint: trimmed };
  }
  if (typeof fetcher !== 'function') {
    return { exported: false, reason: 'fetch-unavailable', endpoint: null };
  }

  const endpoint = resolveEndpoint(trimmed);
  const headers = {
    'Content-Type': 'application/json',
    ...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
  };
  const body = JSON.stringify(snapshotToOtlpPayload(snapshot));

  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers,
      body,
    });
  } catch (err) {
    return { exported: false, reason: `network-error:${err.message}`, endpoint };
  }
  if (!response.ok) {
    return { exported: false, status: response.status, reason: `http-${response.status}`, endpoint };
  }
  return { exported: true, status: response.status, endpoint };
}

// ---------------------------------------------------------------------------
// Public exports for tests
// ---------------------------------------------------------------------------

export const _internal = {
  parseHeaders,
  resolveEndpoint,
  OTLP_PATH,
};
