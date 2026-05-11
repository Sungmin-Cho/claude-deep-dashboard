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
 *   3. deep-wiki/index                  (envelope, optional external <wiki_root>/.wiki-meta/index.json)
 *   4. hook event logs                  (NDJSON, legacy not envelope-wrapped)
 *
 * Additionally:
 *   - Performs parent_run_id chain reconstruction across all envelopes,
 *     feeding `suite.cross_plugin.run_id_chain_completeness`.
 *   - Tracks per-source validation failures, feeding
 *     `suite.artifact.schema_failures_total` and `suite.dashboard.missing_signal_ratio`.
 *
 * Schema-fidelity policy (M3 Phase 3 lesson + Round 1 review): the collector
 * performs three layers of validation per envelope:
 *   a) envelope-shape (schema_version, envelope object, payload key)
 *   b) identity-triple match (producer, artifact_kind, schema.name)
 *   c) payload top-level non-null, non-array, object (round-4/5 lesson)
 *   d) payload minimal required-field check (per PAYLOAD_REQUIRED_FIELDS,
 *      mirrors authoritative schema `required` keyword). Zero-dep — matches
 *      scripts/validate-envelope-emit.js precedent. Full schema-runtime
 *      validation (ajv) is a candidate for M5.
 *
 * Producer-side emit-validators remain the source of truth for full schema
 * conformance. This collector's job is to reject obviously-broken envelopes
 * before they corrupt downstream aggregation.
 *
 * TODO(M5): consolidate envelope unwrap helpers into lib/envelope-unwrap.js
 * shared with lib/dashboard/collector.js. The intentional duplication here
 * keeps PR 1 from touching the legacy collector's public API; entropy will
 * compound across collector additions in future milestones if not addressed.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {
  ADOPTION_LEDGER,
  EXPECTED_SOURCES,
  PAYLOAD_REQUIRED_FIELDS,
} from './suite-constants.js';

// ---------------------------------------------------------------------------
// Envelope unwrap (mirror of dashboard/collector.js)
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
 *         { failure: 'reason', source } on validation failure (caller increments counter).
 *
 * Validation layers (Round 1 review):
 *   1. envelope-shape       → failure='not-envelope-shape'
 *   2. identity-triple      → failure='identity-mismatch'
 *   3. payload-object-shape → failure='payload-shape-violation'
 *   4. payload-required-fields → failure='missing-required-fields:<csv>'
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
  // Round 1 review (Codex adv HIGH): empty {} payload silently passes (a)–(c).
  // Add minimal required-field check per producer schema (zero-dep, mirrors
  // claude-deep-suite/schemas/payload-registry/<producer>/<kind>/v1.0.schema.json
  // `required` arrays).
  const kindKey = `${expectedProducer}/${expectedKind}`;
  const required = PAYLOAD_REQUIRED_FIELDS[kindKey];
  if (required !== undefined) {
    const missing = required.filter((k) => !(k in pl));
    if (missing.length > 0) {
      return {
        failure: `missing-required-fields:${missing.join(',')}`,
        source: sourceLabel,
      };
    }
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
 * Read all *.json files in a directory non-recursively.
 *
 * Round 1 review (3-way agreement): parse failures must propagate so the
 * caller can feed `suite.artifact.schema_failures_total`. Returns
 *   { entries: [{path, parsed}], failures: [{path, reason}] }
 * instead of silently dropping unparseable / unreadable files.
 *
 * Skips symlinks pointing outside the directory (containment check).
 */
function readJsonDir(dirPath) {
  const failures = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    // ENOENT is normal (directory just doesn't exist yet); other codes are
    // unusual and should surface as a single dir-level failure.
    if (err && err.code !== 'ENOENT') {
      failures.push({ path: dirPath, reason: 'directory-unreadable' });
    }
    return { entries: [], failures };
  }
  let resolvedScanDir;
  try {
    resolvedScanDir = fs.realpathSync(dirPath);
  } catch {
    failures.push({ path: dirPath, reason: 'directory-realpath-failed' });
    return { entries: [], failures };
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
        failures.push({ path: entryAbs, reason: 'broken-symlink' });
        continue;
      }
      const rel = path.relative(resolvedScanDir, resolvedTarget);
      const outOfBoundary = rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
      if (outOfBoundary) {
        failures.push({ path: entryAbs, reason: 'out-of-boundary-symlink' });
        continue;
      }
      let targetStat;
      try {
        targetStat = fs.statSync(resolvedTarget);
      } catch {
        failures.push({ path: entryAbs, reason: 'symlink-target-stat-failed' });
        continue;
      }
      if (targetStat.isFile()) accept = true;
    }
    if (!accept) continue;
    const parsed = readJsonSafe(entryAbs);
    if (parsed === null) {
      failures.push({ path: entryAbs, reason: 'unparseable-json' });
      continue;
    }
    results.push({ path: entryAbs, parsed });
  }
  return { entries: results, failures };
}

/**
 * Read NDJSON file (one JSON object per line).
 *
 * Returns { events, missing, error } so the caller can distinguish:
 *   - missing=true:  file does not exist
 *   - error set:     stream/IO failure during read (W5 — Round 1 review)
 *   - otherwise:     events = successfully-parsed lines (malformed lines skipped)
 */
async function readNdjson(absPath) {
  if (!pathExists(absPath)) return { events: [], missing: true };
  const out = [];
  const stream = fs.createReadStream(absPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let streamError = null;
  stream.on('error', (err) => {
    streamError = err;
  });
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch {
        // skip malformed line — log_parse failures are not envelope failures
      }
    }
  } catch (err) {
    return {
      events: out,
      missing: false,
      error: { reason: 'stream-error', message: err.message },
    };
  }
  if (streamError !== null) {
    return {
      events: out,
      missing: false,
      error: { reason: 'stream-error', message: streamError.message },
    };
  }
  return { events: out, missing: false };
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
  // deep-wiki/index is handled separately so external wiki_root resolves
  // to `<wiki_root>/.wiki-meta/index.json` per deep-wiki storage layout
  // (skills/wiki-schema/wiki-schema.yaml: index.json location = .wiki-meta/index.json).
];

function collectEnvelopeSource(spec, projectRoot) {
  const out = {
    producer: spec.producer,
    kind: spec.kind,
    envelopes: [],
    failures: [],
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
    const { entries, failures: parseFailures } = readJsonDir(dir);
    for (const pf of parseFailures) {
      out.failures.push({ reason: pf.reason, source: pf.path });
    }
    if (entries.length === 0 && parseFailures.length === 0) {
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
 * Resolve the deep-wiki index.json path.
 *
 * Per deep-wiki storage layout (`skills/wiki-schema/wiki-schema.yaml`):
 *   - index.json: <wiki_root>/.wiki-meta/index.json   (machine catalog, hidden)
 *   - log.jsonl:  <wiki_root>/log.jsonl               (vault root, visible)
 *
 * Order of precedence:
 *   1. options.wikiRoot (explicit argument)
 *   2. process.env.DEEP_WIKI_ROOT (or DEEP_WIKI_VAULT_ROOT)
 *   3. <projectRoot>/.deep-wiki/index.json  (project-local fallback)
 *
 * Round 1 review (Codex P2): previous implementation read `<wiki_root>/index.json`
 * which never exists in a real deep-wiki vault.
 */
function resolveWikiIndexPath(projectRoot, options = {}) {
  const explicit = options.wikiRoot;
  if (explicit) {
    return path.join(explicit, '.wiki-meta', 'index.json');
  }
  const envRoot = process.env.DEEP_WIKI_ROOT || process.env.DEEP_WIKI_VAULT_ROOT;
  if (envRoot) {
    return path.join(envRoot, '.wiki-meta', 'index.json');
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
// Hook log + wiki log collectors (NDJSON, not envelope-wrapped)
// ---------------------------------------------------------------------------

/**
 * Resolve the deep-wiki vault event log path.
 *
 * Per deep-wiki storage layout: `log.jsonl` lives at the vault root, NOT
 * under `.wiki-meta/`. This is intentional asymmetry — `.wiki-meta/` is hidden
 * from Obsidian's graph view, while `log.jsonl` remains scriptable at root.
 *
 * Round 1 review (Codex P2): previous implementation read
 * `<wiki_root>/.wiki-meta/log.jsonl` which never exists.
 */
function resolveWikiLogPath(projectRoot, options = {}) {
  const explicit = options.wikiRoot;
  if (explicit) return path.join(explicit, 'log.jsonl');
  const envRoot = process.env.DEEP_WIKI_ROOT || process.env.DEEP_WIKI_VAULT_ROOT;
  if (envRoot) return path.join(envRoot, 'log.jsonl');
  return path.join(projectRoot, '.deep-wiki', 'log.jsonl');
}

/**
 * Collect NDJSON event logs:
 *   - .deep-work/hooks.log.jsonl   (kind=hook-log)
 *   - .deep-evolve/hooks.log.jsonl (kind=hook-log)
 *   - <wiki_root>/log.jsonl        (kind=log) — deep-wiki vault event stream
 *
 * Each entry exposes (producer, kind, abs, events, missing, [error]) so
 * EXPECTED_SOURCES `ndjson`-typed entries can compute missing_signal_ratio.
 */
async function collectNdjsonLogs(projectRoot, options = {}) {
  const candidates = [
    { producer: 'deep-work',   kind: 'hook-log', abs: path.join(projectRoot, '.deep-work/hooks.log.jsonl') },
    { producer: 'deep-evolve', kind: 'hook-log', abs: path.join(projectRoot, '.deep-evolve/hooks.log.jsonl') },
    { producer: 'deep-wiki',   kind: 'log',      abs: resolveWikiLogPath(projectRoot, options) },
  ];
  const result = [];
  for (const { producer, kind, abs } of candidates) {
    const { events, missing, error } = await readNdjson(abs);
    result.push({ producer, kind, abs, events, missing, ...(error ? { error } : {}) });
  }
  return result;
}

// ---------------------------------------------------------------------------
// parent_run_id chain reconstruction
// ---------------------------------------------------------------------------
//
// Aggregator-pattern envelopes (per schema descriptions):
//   - deep-dashboard/harnessability-report
//   - deep-evolve/evolve-insights
//   - deep-wiki/index
// These never carry parent_run_id (multi-source aggregation), and per the
// chain-completeness contract their run_ids MUST NOT be valid parent targets
// either — child→aggregator parent resolution would silently inflate the
// metric (Opus W1, Round 1 review). The map below indexes only non-aggregator
// envelopes; child envelopes naming an aggregator run_id as parent will
// correctly resolve to "unresolved".

const AGGREGATOR_KINDS = new Set([
  'harnessability-report',
  'evolve-insights',
  'index',
]);

export function reconstructChains(envelopes) {
  // Index only non-aggregator envelopes with string run_ids (Round 1 review:
  // Opus W2 + W1). truthy-only check accepted `{nested:true}` / `[]` as keys.
  const byRunId = new Map();
  for (const e of envelopes) {
    const env = e.envelope;
    if (!env) continue;
    if (AGGREGATOR_KINDS.has(env.artifact_kind)) continue;
    if (typeof env.run_id !== 'string' || env.run_id.length === 0) continue;
    byRunId.set(env.run_id, e);
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
 * @param {string} [options.wikiRoot] — external wiki_root. Resolves to
 *                                       `<wiki_root>/.wiki-meta/index.json` for
 *                                       the envelope and `<wiki_root>/log.jsonl`
 *                                       for the event log (per deep-wiki layout).
 *                                       When unset, falls back to DEEP_WIKI_ROOT
 *                                       env var, then `<projectRoot>/.deep-wiki/`.
 */
export async function collectSuite(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);

  const envelopeSources = SOURCE_SPECS.map((spec) =>
    collectEnvelopeSource(spec, root)
  );
  envelopeSources.push(collectWikiIndex(root, options));

  const ndjsonLogs = await collectNdjsonLogs(root, options);

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

  // missing_signal_ratio: how many EXPECTED_SOURCES tuples failed to produce a
  // usable signal? Round 1 review (Codex adv HIGH): denominator must include
  // both envelope-typed and ndjson-typed expected sources — previously only
  // envelopes counted, hiding missing hook logs and wiki log behind a healthy
  // ratio.
  let expectedMissing = 0;
  for (const exp of EXPECTED_SOURCES) {
    if (exp.type === 'envelope') {
      const matched = envelopeSources.find(
        (s) => s.producer === exp.producer && s.kind === exp.kind
      );
      if (!matched || matched.envelopes.length === 0) expectedMissing += 1;
    } else if (exp.type === 'ndjson') {
      const matched = ndjsonLogs.find(
        (h) => h.producer === exp.producer && h.kind === exp.kind
      );
      // missing-or-empty-or-error → missing signal
      if (
        !matched ||
        matched.missing === true ||
        matched.error !== undefined ||
        matched.events.length === 0
      ) {
        expectedMissing += 1;
      }
    }
  }
  const missingSignalRatio =
    EXPECTED_SOURCES.length === 0 ? 0 : expectedMissing / EXPECTED_SOURCES.length;

  return {
    project_root: root,
    collected_at: new Date().toISOString(),
    sources: {
      envelopes: envelopeSources,
      ndjson_logs: ndjsonLogs,
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
  readJsonDir,
  readNdjson,
  SOURCE_SPECS,
  AGGREGATOR_KINDS,
};
