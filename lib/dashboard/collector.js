/**
 * Dashboard Data Collector — deep-dashboard
 *
 * Reads data from plugin output directories defensively.
 * Returns null for missing fields rather than crashing.
 *
 * Supported plugins (v1): deep-work, deep-review, deep-docs
 * Unsupported (v1):       deep-wiki, deep-research → [no data contract]
 *
 * M3 envelope-awareness:
 *   For artifacts that producers emit in the claude-deep-suite cross-plugin
 *   envelope (cf. claude-deep-suite/docs/envelope-migration.md), this collector
 *   detects the envelope wrapper and returns the inner `payload` so downstream
 *   consumers (effectiveness scorer, formatter) read domain data uniformly
 *   regardless of envelope adoption status. Legacy (un-wrapped) artifacts
 *   pass through unchanged.
 *
 *   Identity guards (defense-in-depth, handoff §4 round-4 lesson) reject
 *   envelopes whose `producer` / `artifact_kind` / `schema.name` do not match
 *   the expected triple — preventing one plugin's envelope from being trusted
 *   under another plugin's read path.
 */

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Envelope unwrap helper
// ---------------------------------------------------------------------------
//
// Returns the inner `payload` when the input is a valid M3 envelope whose
// identity matches the (producer, kind) triple. Otherwise returns the input
// unchanged (legacy artifact pass-through).
//
// Detection criteria (suite envelope schema mirror, MUST stay strict):
//   - `schema_version === '1.0'` (string literal — legacy 1.1.0 deep-docs
//     used numeric `2`, so strict equality keeps legacy/envelope distinguishable)
//   - `envelope` is a non-null, non-array object
//   - `payload` key is present
//
// Identity guards (round-4 lesson — without these, another producer's envelope
// in the same path would be silently trusted):
//   - `envelope.producer === expectedProducer`
//   - `envelope.artifact_kind === expectedKind`
//   - `envelope.schema?.name === expectedKind`  (Phase 1 round-4 strict check)
//
// On envelope-shaped-but-identity-mismatched input, returns null and warns —
// the artifact is deliberately untrustworthy under this read path.

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

function unwrapEnvelope(obj, expectedProducer, expectedKind, sourceLabel) {
  if (!isEnvelopeShape(obj)) {
    return obj; // legacy or null pass-through
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
    console.warn(
      `[deep-dashboard/collector] rejecting envelope at ${sourceLabel}: ` +
        `expected (producer=${expectedProducer}, artifact_kind=${expectedKind}, schema.name=${expectedKind}) ` +
        `but got (producer=${JSON.stringify(env.producer)}, ` +
        `artifact_kind=${JSON.stringify(env.artifact_kind)}, ` +
        `schema.name=${JSON.stringify(env.schema?.name)})`
    );
    return null;
  }
  // Round-5/7 corrupt-payload defense extension: well-behaved producers always
  // emit object payloads. A non-null, non-object (or array) payload is either a
  // buggy producer or hostile input; reject at the seam so downstream consumers
  // (effectiveness scorer, formatter) never see undefined-keyed primitives or
  // arrays. Legacy consumers reading status === 'no_data' degrade gracefully.
  const pl = obj.payload;
  if (pl === null || typeof pl !== 'object' || Array.isArray(pl)) {
    console.warn(
      `[deep-dashboard/collector] rejecting envelope at ${sourceLabel}: ` +
        `payload must be a non-null, non-array object (got ${
          Array.isArray(pl) ? 'array' : pl === null ? 'null' : typeof pl
        })`
    );
    return null;
  }
  return pl;
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

/** Read & parse a JSON file, or null on failure. */
function readJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Read all *.json files from a directory.
 * Follows symbolic links only when the target resolves INSIDE the scanned
 * directory (no prefix bypass, no out-of-tree ingestion). Broken or
 * out-of-bounds symlinks are skipped with a warning.
 */
function readJsonDir(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Canonicalize the scan dir once; if this throws, the dir itself is broken.
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
        console.warn(`[deep-dashboard/collector] skipping broken symlink: ${entryAbs}`);
        continue;
      }

      // Containment: resolvedTarget must stay under resolvedScanDir.
      const rel = path.relative(resolvedScanDir, resolvedTarget);
      const outOfBoundary = rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
      if (outOfBoundary) {
        console.warn(`[deep-dashboard/collector] skipping out-of-boundary symlink: ${entryAbs} -> ${resolvedTarget}`);
        continue;
      }

      // TOCTOU guard: target could be removed between realpathSync above and statSync here.
      let targetStat;
      try {
        targetStat = fs.statSync(resolvedTarget);
      } catch {
        console.warn(`[deep-dashboard/collector] skipping broken symlink target: ${entryAbs}`);
        continue;
      }
      if (targetStat.isFile()) accept = true;
    }

    if (!accept) continue;

    const parsed = readJson(entryAbs);
    if (parsed !== null) results.push(parsed);
  }
  return results;
}

/** Check whether a path exists. */
function pathExists(absPath) {
  try {
    fs.accessSync(absPath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Plugin collectors
// ---------------------------------------------------------------------------

/**
 * Collect deep-work data.
 *
 * Paths:
 *   <root>/.deep-work/receipts/*.json   — slice receipts (envelope when migrated)
 *   <root>/.deep-work/session-receipt.json — session summary (envelope when migrated)
 *
 * Envelope identities (when deep-work Phase 2 lands):
 *   slice receipts   = (producer=deep-work, artifact_kind=slice-receipt)
 *   session receipt  = (producer=deep-work, artifact_kind=session-receipt)
 */
function collectDeepWork(root) {
  const receiptsDir = path.join(root, '.deep-work', 'receipts');
  const sessionReceiptPath = path.join(root, '.deep-work', 'session-receipt.json');

  const receipts = readJsonDir(receiptsDir)
    .map((obj) => unwrapEnvelope(obj, 'deep-work', 'slice-receipt', `${receiptsDir}/<entry>`))
    .filter((v) => v !== null);

  // session-receipt is one file
  const sessionReceiptRaw = readJson(sessionReceiptPath);
  const sessionReceipt =
    sessionReceiptRaw === null
      ? null
      : unwrapEnvelope(sessionReceiptRaw, 'deep-work', 'session-receipt', sessionReceiptPath);

  const hasAny = receipts.length > 0 || sessionReceipt !== null;

  return {
    status: hasAny ? 'available' : 'no_data',
    receipts,
    sessionReceipt,
  };
}

/**
 * Collect deep-review data.
 *
 * Paths:
 *   <root>/.deep-review/receipts/*.json — legacy artifacts (NOT in M3 envelope plan)
 *   <root>/.deep-review/fitness.json    — legacy artifact (NOT in M3 envelope plan)
 *
 * deep-review's M3-bound artifact is `recurring-findings.json`, which the
 * dashboard currently does not consume. Reads here remain legacy pass-through.
 */
function collectDeepReview(root) {
  const receiptsDir = path.join(root, '.deep-review', 'receipts');
  const fitnessPath = path.join(root, '.deep-review', 'fitness.json');

  const receipts = readJsonDir(receiptsDir);
  const fitness = readJson(fitnessPath);

  const hasAny = receipts.length > 0 || fitness !== null;

  return {
    status: hasAny ? 'available' : 'no_data',
    receipts,
    fitness,
  };
}

/**
 * Collect deep-docs data.
 *
 * Paths:
 *   <root>/.deep-docs/last-scan.json  (M3 envelope as of deep-docs 1.2.0)
 *
 * Envelope identity:
 *   (producer=deep-docs, artifact_kind=last-scan)
 *
 * `data` is the unwrapped payload (envelope) or the raw artifact (legacy).
 * Identity-mismatched envelopes resolve to null (defense-in-depth).
 */
function collectDeepDocs(root) {
  const scanPath = path.join(root, '.deep-docs', 'last-scan.json');
  const raw = readJson(scanPath);
  const data = raw === null ? null : unwrapEnvelope(raw, 'deep-docs', 'last-scan', scanPath);

  return {
    status: data !== null ? 'available' : 'no_data',
    data,
  };
}

/**
 * Collect harnessability report.
 *
 * Paths:
 *   <root>/.deep-dashboard/harnessability-report.json  (M3 envelope as of 1.2.0)
 *
 * Envelope identity:
 *   (producer=deep-dashboard, artifact_kind=harnessability-report)
 */
function collectHarnessability(root) {
  const reportPath = path.join(root, '.deep-dashboard', 'harnessability-report.json');
  const raw = readJson(reportPath);
  const data =
    raw === null
      ? null
      : unwrapEnvelope(raw, 'deep-dashboard', 'harnessability-report', reportPath);

  return {
    status: data !== null ? 'available' : 'no_data',
    data,
  };
}

// ---------------------------------------------------------------------------
// deep-evolve
// ---------------------------------------------------------------------------

/**
 * Collect deep-evolve data.
 *
 * Paths:
 *   <root>/.deep-evolve/evolve-receipt.json (envelope when deep-evolve Phase 2 lands)
 *   <root>/.deep-evolve/session.yaml (status check)
 *
 * Envelope identity (forward-compat):
 *   (producer=deep-evolve, artifact_kind=evolve-receipt)
 */
function collectDeepEvolve(root) {
  const receiptPath = path.join(root, '.deep-evolve', 'evolve-receipt.json');
  const sessionPath = path.join(root, '.deep-evolve', 'session.yaml');

  const raw = readJson(receiptPath);
  const receipt =
    raw === null
      ? null
      : unwrapEnvelope(raw, 'deep-evolve', 'evolve-receipt', receiptPath);
  const hasSession = pathExists(sessionPath);

  return {
    status: receipt !== null ? 'available' : (hasSession ? 'active_session' : 'no_data'),
    receipt,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Collect data from all supported plugin output directories.
 *
 * @param {string} projectRoot  — absolute (or relative) path to the project root
 * @returns {{
 *   deepWork: { status: string, receipts: object[], sessionReceipt: object|null },
 *   deepReview: { status: string, receipts: object[], fitness: object|null },
 *   deepDocs: { status: string, data: object|null },
 *   harnessability: { status: string, data: object|null },
 *   deepEvolve: { status: string, receipt: object|null },
 * }}
 */
export function collectData(projectRoot) {
  const root = path.resolve(projectRoot);

  return {
    deepWork: collectDeepWork(root),
    deepReview: collectDeepReview(root),
    deepDocs: collectDeepDocs(root),
    harnessability: collectHarnessability(root),
    deepEvolve: collectDeepEvolve(root),
  };
}
