/**
 * Suite Telemetry Collector — M4
 *
 * Envelope-aware reader for cross-plugin artifacts feeding the M4 metric catalog
 * (lib/metrics-catalog.yaml). Builds on the same identity-guarded unwrap pattern
 * as lib/dashboard/collector.js but covers four additional sources the legacy
 * dashboard collector does not consume:
 *
 *   1. deep-review/recurring-findings   (envelope)
 *   2. deep-evolve/evolve-insights      (envelope, aggregator pattern — no parent_run_id)
 *   3. deep-wiki/index                  (envelope, optional external <wiki_root>/index.json)
 *   4. hook event logs                  (NDJSON, legacy not envelope-wrapped)
 *
 * Additionally:
 *   - Performs parent_run_id chain reconstruction across all envelopes,
 *     feeding `suite.cross_plugin.run_id_chain_completeness`.
 *   - Tracks per-source validation failures, feeding
 *     `suite.artifact.schema_failures_total` and `suite.dashboard.missing_signal_ratio`.
 *
 * Schema-fidelity policy (M3 Phase 3 lesson): the collector strict-validates the
 * envelope shape (producer / artifact_kind / schema.name triple) but does NOT
 * pull in a full JSON Schema validator runtime here. Producer-side validation
 * is the source of truth (scripts/validate-envelope-emit.js + suite repo schemas).
 * Dashboard-side rejection is limited to:
 *   a) envelope-shape (schema_version, envelope object presence, payload key)
 *   b) identity-triple match against the expected (producer, kind) tuple
 *   c) payload top-level non-null, non-array, object — handoff round-4/5 lesson
 * Anything past (c) is up to downstream metric aggregation to handle defensively.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ADOPTION_LEDGER, EXPECTED_SOURCES } from './suite-constants.js';

// ---------------------------------------------------------------------------
// Envelope unwrap (mirror of dashboard/collector.js — kept duplicated rather
// than imported because the legacy collector intentionally only exposes
// `collectData`. Keeping the unwrap function here lets PR1 ship without
// touching the legacy interface.)
// ---------------------------------------------------------------------------

function isEnvelopeShape(obj) {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    !Array.isArray(obj) &&
    obj.schema_version === '1.0' &&
    obj.envelope !== null &&
    typeof obj.envelope === 'object' &&
    !Array.isArray(obj.envelope) &&
    'payload' in obj
  );
}

/**
 * Returns { envelope, payload, source } on successful unwrap;
 *         { failure: 'reason' } on validation failure (caller increments counter).
 */
function unwrapStrict(obj, expectedProducer, expectedKind, sourceLabel) {
  if (!isEnvelopeShape(obj)) {
    return { failure: 'not-envelope-shape', source: sourceLabel };
  }
  const env = obj.envelope;
  const identityOk =
    env.producer === expectedProducer &&
    env.artifact_kind === expectedKind &&
    env.schema !== null &&
    typeof env.schema === 'object' &&
    !Array.isArray(env.schema) &&
    env.schema.name === expectedKind;
  if (!identityOk) {
    return { failure: 'identity-mismatch', source: sourceLabel };
  }
  const pl = obj.payload;
  if (pl === null || typeof pl !== 'object' || Array.isArray(pl)) {
    return { failure: 'payload-shape-violation', source: sourceLabel };
  }
  return { envelope: env, payload: pl, source: sourceLabel };
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function readJsonSafe(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

function pathExists(absPath) {
  try {
    fs.accessSync(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read all *.json files in a directory non-recursively, returning their parsed
 * contents. Skips symlinks pointing outside the directory (containment check),
 * mirrors lib/dashboard/collector.js #readJsonDir.
 */
function readJsonDir(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  let resolvedScanDir;
  try {
    resolvedScanDir = fs.realpathSync(dirPath);
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.json')) continue;
    const entryAbs = path.join(dirPath, entry.name);
    let accept = false;
    if (entry.isFile()) {
      accept = true;
    } else if (entry.isSymbolicLink()) {
      let resolvedTarget;
      try {
        resolvedTarget = fs.realpathSync(entryAbs);
      } catch {
        continue;
      }
      const rel = path.relative(resolvedScanDir, resolvedTarget);
      const outOfBoundary = rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
      if (outOfBoundary) continue;
      let targetStat;
      try {
        targetStat = fs.statSync(resolvedTarget);
      } catch {
        continue;
      }
      if (targetStat.isFile()) accept = true;
    }
    if (!accept) continue;
    const parsed = readJsonSafe(entryAbs);
    if (parsed !== null) results.push({ path: entryAbs, parsed });
  }
  return results;
}

/**
 * Read NDJSON file (one JSON object per line). Skips unparseable lines.
 * Returns [] when file missing.
 */
async function readNdjson(absPath) {
  if (!pathExists(absPath)) return [];
  const out = [];
  const stream = fs.createReadStream(absPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // skip malformed line — log_parse failures are not envelope failures
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-source envelope collectors
// ---------------------------------------------------------------------------

const SOURCE_SPECS = [
  {
    producer: 'deep-work',
    kind: 'session-receipt',
    relPath: '.deep-work/session-receipt.json',
    cardinality: 'single',
  },
  {
    producer: 'deep-work',
    kind: 'slice-receipt',
    relPath: '.deep-work/receipts',
    cardinality: 'dir',
  },
  {
    producer: 'deep-review',
    kind: 'recurring-findings',
    relPath: '.deep-review/recurring-findings.json',
    cardinality: 'single',
  },
  {
    producer: 'deep-docs',
    kind: 'last-scan',
    relPath: '.deep-docs/last-scan.json',
    cardinality: 'single',
  },
  {
    producer: 'deep-evolve',
    kind: 'evolve-receipt',
    relPath: '.deep-evolve/evolve-receipt.json',
    cardinality: 'single',
  },
  {
    producer: 'deep-evolve',
    kind: 'evolve-insights',
    relPath: '.deep-evolve/evolve-insights.json',
    cardinality: 'single',
  },
  {
    producer: 'deep-dashboard',
    kind: 'harnessability-report',
    relPath: '.deep-dashboard/harnessability-report.json',
    cardinality: 'single',
  },
  // deep-wiki/index is handled separately so wiki_root (external) is resolvable
];

function collectEnvelopeSource(spec, projectRoot) {
  const out = {
    producer: spec.producer,
    kind: spec.kind,
    envelopes: [],
    failures: [],     // { reason, source }
    missing: false,
  };
  if (spec.cardinality === 'single') {
    const abs = path.join(projectRoot, spec.relPath);
    if (!pathExists(abs)) {
      out.missing = true;
      return out;
    }
    const raw = readJsonSafe(abs);
    if (raw === null) {
      out.failures.push({ reason: 'unparseable-json', source: abs });
      return out;
    }
    const r = unwrapStrict(raw, spec.producer, spec.kind, abs);
    if (r.failure) out.failures.push({ reason: r.failure, source: r.source });
    else out.envelopes.push(r);
    return out;
  }
  if (spec.cardinality === 'dir') {
    const dir = path.join(projectRoot, spec.relPath);
    const entries = readJsonDir(dir);
    if (entries.length === 0) {
      out.missing = true;
      return out;
    }
    for (const { path: p, parsed } of entries) {
      const r = unwrapStrict(parsed, spec.producer, spec.kind, p);
      if (r.failure) out.failures.push({ reason: r.failure, source: r.source });
      else out.envelopes.push(r);
    }
    return out;
  }
  return out;
}

/**
 * Resolve the deep-wiki index.json path. Order of precedence:
 *   1. options.wikiRoot (explicit argument)
 *   2. process.env.DEEP_WIKI_ROOT (or DEEP_WIKI_VAULT_ROOT)
 *   3. <projectRoot>/.deep-wiki/index.json  (project-local fallback)
 */
function resolveWikiIndexPath(projectRoot, options = {}) {
  const explicit = options.wikiRoot;
  if (explicit) {
    return path.join(explicit, 'index.json');
  }
  const envRoot = process.env.DEEP_WIKI_ROOT || process.env.DEEP_WIKI_VAULT_ROOT;
  if (envRoot) {
    return path.join(envRoot, 'index.json');
  }
  return path.join(projectRoot, '.deep-wiki', 'index.json');
}

function collectWikiIndex(projectRoot, options) {
  const out = {
    producer: 'deep-wiki',
    kind: 'index',
    envelopes: [],
    failures: [],
    missing: false,
  };
  const abs = resolveWikiIndexPath(projectRoot, options);
  if (!pathExists(abs)) {
    out.missing = true;
    return out;
  }
  const raw = readJsonSafe(abs);
  if (raw === null) {
    out.failures.push({ reason: 'unparseable-json', source: abs });
    return out;
  }
  const r = unwrapStrict(raw, 'deep-wiki', 'index', abs);
  if (r.failure) out.failures.push({ reason: r.failure, source: r.source });
  else out.envelopes.push(r);
  return out;
}

// ---------------------------------------------------------------------------
// Hook log collectors (NDJSON, not envelope-wrapped)
// ---------------------------------------------------------------------------

/** Resolve hook-log paths. Tolerates both `hooks.log.jsonl` and legacy `log.jsonl`. */
async function collectHookLogs(projectRoot, options = {}) {
  const candidates = [
    { producer: 'deep-work',   abs: path.join(projectRoot, '.deep-work/hooks.log.jsonl') },
    { producer: 'deep-evolve', abs: path.join(projectRoot, '.deep-evolve/hooks.log.jsonl') },
    // deep-wiki: per wiki-schema, `<wiki_root>/.wiki-meta/log.jsonl` is canonical.
    // We accept project-local `.deep-wiki/log.jsonl` as a fallback shim.
    { producer: 'deep-wiki',   abs: resolveWikiLogPath(projectRoot, options) },
  ];
  const result = [];
  for (const { producer, abs } of candidates) {
    if (!pathExists(abs)) {
      result.push({ producer, abs, events: [], missing: true });
      continue;
    }
    const events = await readNdjson(abs);
    result.push({ producer, abs, events, missing: false });
  }
  return result;
}

function resolveWikiLogPath(projectRoot, options = {}) {
  const explicit = options.wikiRoot;
  if (explicit) return path.join(explicit, '.wiki-meta', 'log.jsonl');
  const envRoot = process.env.DEEP_WIKI_ROOT || process.env.DEEP_WIKI_VAULT_ROOT;
  if (envRoot) return path.join(envRoot, '.wiki-meta', 'log.jsonl');
  return path.join(projectRoot, '.deep-wiki', 'log.jsonl');
}

// ---------------------------------------------------------------------------
// parent_run_id chain reconstruction
// ---------------------------------------------------------------------------

/**
 * Given a flat array of unwrapped { envelope, payload, source } entries,
 * reconstructs cross-plugin chains.
 *
 *   - A "chain" is rooted at any envelope where `envelope.parent_run_id` is set.
 *   - Chain completeness = (chains whose parent_run_id resolves to another
 *     envelope's run_id in this set) / (chains total).
 *   - Aggregator-pattern envelopes (no parent_run_id by design) are excluded
 *     from both numerator and denominator. Identification: harnessability-report,
 *     evolve-insights, wiki/index, all multi-source aggregators per their schema
 *     descriptions.
 *
 * Returns { total, resolved, completeness, links }.
 */
const AGGREGATOR_KINDS = new Set([
  'harnessability-report',
  'evolve-insights',
  'index',
]);

export function reconstructChains(envelopes) {
  const byRunId = new Map();
  for (const e of envelopes) {
    if (e.envelope?.run_id) byRunId.set(e.envelope.run_id, e);
  }
  const links = [];
  for (const e of envelopes) {
    const env = e.envelope;
    if (!env) continue;
    if (AGGREGATOR_KINDS.has(env.artifact_kind)) continue;
    if (typeof env.parent_run_id !== 'string' || env.parent_run_id.length === 0) continue;
    const parentMatch = byRunId.get(env.parent_run_id) ?? null;
    links.push({
      child: {
        producer: env.producer,
        kind: env.artifact_kind,
        run_id: env.run_id,
        source: e.source,
      },
      parent_run_id: env.parent_run_id,
      resolved: parentMatch !== null,
      parent: parentMatch
        ? {
            producer: parentMatch.envelope.producer,
            kind: parentMatch.envelope.artifact_kind,
          }
        : null,
    });
  }
  const total = links.length;
  const resolved = links.filter((l) => l.resolved).length;
  const completeness = total === 0 ? null : resolved / total;
  return { total, resolved, completeness, links };
}

// ---------------------------------------------------------------------------
// Top-level suite collection
// ---------------------------------------------------------------------------

/**
 * Collect all suite-level telemetry sources.
 *
 * @param {string} projectRoot — absolute or relative project root path
 * @param {object} [options]
 * @param {string} [options.wikiRoot] — external wiki_root (overrides env vars).
 *                                       When unset, falls back to DEEP_WIKI_ROOT
 *                                       env var, then `<projectRoot>/.deep-wiki/`.
 * @returns {Promise<{
 *   project_root: string,
 *   collected_at: string,
 *   sources: object,
 *   chains: { total: number, resolved: number, completeness: number|null, links: Array },
 *   schema_failures_total: number,
 *   missing_signal_ratio: number,
 *   adoption_ledger: object,
 * }>}
 */
export async function collectSuite(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);

  const envelopeSources = SOURCE_SPECS.map((spec) =>
    collectEnvelopeSource(spec, root)
  );
  const wikiSource = collectWikiIndex(root, options);
  envelopeSources.push(wikiSource);

  const hookLogs = await collectHookLogs(root, options);

  // Flatten envelopes for chain reconstruction
  const flatEnvelopes = [];
  let schemaFailures = 0;
  for (const src of envelopeSources) {
    schemaFailures += src.failures.length;
    for (const env of src.envelopes) {
      flatEnvelopes.push(env);
    }
  }
  const chains = reconstructChains(flatEnvelopes);

  // missing_signal_ratio: how many EXPECTED_SOURCES (producer,kind) tuples had
  // zero valid envelopes? "missing" = no file at all OR all candidates failed.
  let expectedMissing = 0;
  for (const exp of EXPECTED_SOURCES) {
    const matched = envelopeSources.find(
      (s) => s.producer === exp.producer && s.kind === exp.kind
    );
    if (!matched) {
      expectedMissing += 1;
      continue;
    }
    if (matched.envelopes.length === 0) expectedMissing += 1;
  }
  const missingSignalRatio =
    EXPECTED_SOURCES.length === 0 ? 0 : expectedMissing / EXPECTED_SOURCES.length;

  return {
    project_root: root,
    collected_at: new Date().toISOString(),
    sources: {
      envelopes: envelopeSources,
      hook_logs: hookLogs,
    },
    chains,
    schema_failures_total: schemaFailures,
    missing_signal_ratio: missingSignalRatio,
    adoption_ledger: ADOPTION_LEDGER,
  };
}

// ---------------------------------------------------------------------------
// Public re-exports for tests
// ---------------------------------------------------------------------------

export const _internal = {
  isEnvelopeShape,
  unwrapStrict,
  resolveWikiIndexPath,
  resolveWikiLogPath,
  SOURCE_SPECS,
  AGGREGATOR_KINDS,
};
