/**
 * Dashboard Data Collector — deep-dashboard
 *
 * Reads data from plugin output directories defensively.
 * Returns null for missing fields rather than crashing.
 *
 * Supported plugins (v1): deep-work, deep-review, deep-docs
 * Unsupported (v1):       deep-wiki, deep-research → [no data contract]
 */

import fs from 'node:fs';
import path from 'node:path';

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
 *   <root>/.deep-work/receipts/*.json   — slice receipts
 *   <root>/.deep-work/session-receipt.json — session summary
 */
function collectDeepWork(root) {
  const receiptsDir = path.join(root, '.deep-work', 'receipts');
  const sessionReceiptPath = path.join(root, '.deep-work', 'session-receipt.json');

  const receipts = readJsonDir(receiptsDir);

  // Also include session-receipt.json if it exists and isn't already in receipts
  const sessionReceipt = readJson(sessionReceiptPath);

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
 *   <root>/.deep-review/receipts/*.json
 *   <root>/.deep-review/fitness.json
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
 *   <root>/.deep-docs/last-scan.json
 */
function collectDeepDocs(root) {
  const scanPath = path.join(root, '.deep-docs', 'last-scan.json');
  const data = readJson(scanPath);

  return {
    status: data !== null ? 'available' : 'no_data',
    data,
  };
}

/**
 * Collect harnessability report.
 *
 * Paths:
 *   <root>/.deep-dashboard/harnessability-report.json
 */
function collectHarnessability(root) {
  const reportPath = path.join(root, '.deep-dashboard', 'harnessability-report.json');
  const data = readJson(reportPath);

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
 *   <root>/.deep-evolve/evolve-receipt.json
 *   <root>/.deep-evolve/session.yaml (status check)
 */
function collectDeepEvolve(root) {
  const receiptPath = path.join(root, '.deep-evolve', 'evolve-receipt.json');
  const sessionPath = path.join(root, '.deep-evolve', 'session.yaml');

  const receipt = readJson(receiptPath);
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
