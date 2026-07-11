/**
 * Cross-platform dashboard CLI.
 *
 * The target project is always explicit. Plugin-owned modules resolve from
 * this file; target artifacts resolve only from --project-root.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreHarnessability, saveReport } from '../lib/harnessability/scorer.js';
import { collectData } from '../lib/dashboard/collector.js';
import { calculateEffectiveness } from '../lib/dashboard/effectiveness.js';
import { getSuggestedActions } from '../lib/dashboard/action-router.js';
import { formatCLI } from '../lib/dashboard/formatter.js';
import { collectSuite } from '../lib/suite-collector.js';
import { appendSnapshot, buildSnapshot, readRecentSnapshots } from '../lib/aggregator.js';
import { writeSuiteReportFile } from '../lib/suite-formatter.js';
import { exportSnapshot } from '../lib/otel.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function usageError(message) {
  const error = new Error(message);
  error.code = 'USAGE';
  return error;
}

function parseArgs(argv) {
  let projectRoot = null;
  let json = false;
  let suite = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      if (json) throw usageError('--json may be supplied only once');
      json = true;
      continue;
    }
    if (arg === '--suite') {
      if (suite) throw usageError('--suite may be supplied only once');
      suite = true;
      continue;
    }
    if (arg === '--project-root') {
      if (projectRoot !== null) throw usageError('--project-root must be supplied exactly once');
      const value = argv[index + 1];
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw usageError('--project-root requires a path');
      }
      projectRoot = value;
      index += 1;
      continue;
    }
    throw usageError(`unknown argument: ${arg}`);
  }

  if (projectRoot === null) {
    throw usageError('--project-root PATH is required');
  }

  return { projectRoot: path.resolve(projectRoot), json, suite };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isFreshHarnessabilityReport(report, now) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return false;
  const envelope = report.envelope;
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) return false;
  if (envelope.schema === null || typeof envelope.schema !== 'object' || Array.isArray(envelope.schema)) return false;
  if (
    report.schema_version !== '1.0' ||
    envelope.producer !== 'deep-dashboard' ||
    envelope.artifact_kind !== 'harnessability-report' ||
    envelope.schema.name !== 'harnessability-report' ||
    envelope.schema.version !== '1.0'
  ) {
    return false;
  }
  if (typeof envelope.generated_at !== 'string') return false;
  const generatedAt = Date.parse(envelope.generated_at);
  if (!Number.isFinite(generatedAt)) return false;
  const age = now - generatedAt;
  return age >= 0 && age < DAY_MS;
}

/**
 * Refresh the report only when the M3 identity and 24-hour freshness contract
 * do not permit direct reuse. The scorer writes before collectData observes it.
 */
export async function ensureFreshHarnessability(projectRoot, now = Date.now()) {
  const report = readJson(path.join(projectRoot, '.deep-dashboard', 'harnessability-report.json'));
  if (isFreshHarnessabilityReport(report, now)) return false;

  const scored = await scoreHarnessability(projectRoot);
  saveReport(projectRoot, scored);
  return true;
}

async function runLegacy(projectRoot) {
  await ensureFreshHarnessability(projectRoot);
  const data = collectData(projectRoot);
  const { effectiveness } = calculateEffectiveness(data);
  const actions = getSuggestedActions(data);
  return { data, effectiveness, actions };
}

function legacyPresentationView({ data, effectiveness, actions }) {
  return {
    harnessability: {
      total: data.harnessability.data?.total ?? 0,
      grade: data.harnessability.data?.grade ?? 'Unknown',
    },
    effectiveness,
    actions,
  };
}

async function runSuite(projectRoot) {
  const collected = await collectSuite(projectRoot);
  const previous = (await readRecentSnapshots(projectRoot, 1))[0] ?? null;
  const snapshot = buildSnapshot(collected);
  appendSnapshot(snapshot, projectRoot);
  writeSuiteReportFile(snapshot, previous, projectRoot);
  await exportSnapshot(snapshot);
  return snapshot;
}

function printUsage(error) {
  console.error(`dashboard-cli: ${error.message}`);
  console.error('Usage: node dashboard-cli.js [--suite] [--json] --project-root PATH');
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.suite) {
    const snapshot = await runSuite(options.projectRoot);
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  const result = await runLegacy(options.projectRoot);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatCLI(legacyPresentationView(result)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    if (error?.code === 'USAGE') {
      printUsage(error);
      process.exitCode = 2;
    } else {
      console.error(`dashboard-cli: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}
