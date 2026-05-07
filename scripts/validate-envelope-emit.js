#!/usr/bin/env node
// validate-envelope-emit.js — deep-dashboard M3 envelope contract self-test.
//
// Inline check (no suite dependency, no ajv). Verifies that a deep-dashboard
// harnessability-report emit conforms to the M3 envelope contract documented
// in claude-deep-suite/docs/envelope-migration.md §1 and the
// deep-dashboard/harnessability-report payload-registry seed.
//
// Usage:
//   node scripts/validate-envelope-emit.js [path/to/harnessability-report.json]
//
// Default path: tests/fixtures/sample-harnessability-report.json (positive fixture).
// Exit: 0 = pass, 1 = fail (errors printed to stderr, prefix "validate-envelope-emit:").

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/sample-harnessability-report.json');

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const GIT_HEAD_RE = /^[a-f0-9]{7,40}$/;
const SCHEMA_VERSION_RE = /^\d+\.\d+$/;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// Suite envelope schema declares `additionalProperties: false` at root,
// `envelope`, `git`, `provenance`, and each `source_artifacts[]` item, with
// `^x-` patternProperties allowed for forward-compat at root + envelope.
// Mirroring those allow-lists here closes the contract gap that lets a stray
// legacy field silently pass the local self-test while failing the suite
// validator (deep-docs round-2 adversarial finding).
const ALLOWED_ROOT_KEYS = new Set(['$schema', 'schema_version', 'envelope', 'payload']);
const ALLOWED_ENVELOPE_KEYS = new Set([
  'producer', 'producer_version', 'artifact_kind', 'run_id', 'session_id',
  'parent_run_id', 'generated_at', 'schema', 'git', 'provenance',
]);
const ALLOWED_GIT_KEYS = new Set(['head', 'branch', 'worktree', 'dirty']);
const ALLOWED_PROVENANCE_KEYS = new Set(['source_artifacts', 'tool_versions']);
const ALLOWED_SOURCE_ARTIFACT_KEYS = new Set(['path', 'run_id']);
const ALLOWED_SCHEMA_KEYS = new Set(['name', 'version']);

const errors = [];
function fail(msg) { errors.push(msg); }

function reportUnknownKeys(obj, allowed, label, allowXExt) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
  const extra = Object.keys(obj).filter((k) => !allowed.has(k) && !(allowXExt && k.startsWith('x-')));
  if (extra.length > 0) {
    fail(`${label}: unknown ${allowXExt ? 'non-x- ' : ''}keys [${extra.join(', ')}]`);
  }
}

function loadPlugin() {
  const raw = readFileSync(resolve(REPO_ROOT, '.claude-plugin/plugin.json'), 'utf8');
  return JSON.parse(raw);
}

function check(target) {
  const path = resolve(target);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`);
    return;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`invalid JSON in ${path}: ${e.message}`);
    return;
  }

  // 1. top-level envelope wrapper version (locked).
  if (data.schema_version !== '1.0') {
    fail(`schema_version must be "1.0" (got ${JSON.stringify(data.schema_version)})`);
  }
  if (typeof data.envelope !== 'object' || data.envelope === null || Array.isArray(data.envelope)) {
    fail('envelope block missing or not a non-array object');
    return;
  }
  if (!('payload' in data)) fail('payload field missing');

  // additionalProperties: false enforcement (suite-spec mirror; allows ^x- at root + envelope).
  reportUnknownKeys(data, ALLOWED_ROOT_KEYS, 'root', true);
  reportUnknownKeys(data.envelope, ALLOWED_ENVELOPE_KEYS, 'envelope', true);

  const env = data.envelope;

  // 2. producer / artifact_kind / schema identity (Phase 1 round-4 lesson).
  if (env.producer !== 'deep-dashboard') {
    fail(`envelope.producer must be "deep-dashboard" (got ${JSON.stringify(env.producer)})`);
  }
  if (env.artifact_kind !== 'harnessability-report') {
    fail(`envelope.artifact_kind must be "harnessability-report" (got ${JSON.stringify(env.artifact_kind)})`);
  }
  if (!env.producer || !KEBAB_RE.test(env.producer)) {
    fail(`envelope.producer must be kebab-case (got ${JSON.stringify(env.producer)})`);
  }
  if (!env.artifact_kind || !KEBAB_RE.test(env.artifact_kind)) {
    fail(`envelope.artifact_kind must be kebab-case (got ${JSON.stringify(env.artifact_kind)})`);
  }
  if (!env.schema || env.schema.name !== env.artifact_kind) {
    fail(`envelope.schema.name (${JSON.stringify(env.schema?.name)}) must equal envelope.artifact_kind (${JSON.stringify(env.artifact_kind)})`);
  }
  if (!env.schema || !SCHEMA_VERSION_RE.test(env.schema.version || '')) {
    fail(`envelope.schema.version must match \\d+\\.\\d+ (got ${JSON.stringify(env.schema?.version)})`);
  }
  if (env.schema?.version !== '1.0') {
    fail(`envelope.schema.version must be "1.0" for this release (got ${JSON.stringify(env.schema?.version)})`);
  }

  // 3. producer_version === plugin.json.version (single source of truth).
  const plugin = loadPlugin();
  if (env.producer_version !== plugin.version) {
    fail(`envelope.producer_version (${JSON.stringify(env.producer_version)}) must match plugin.json.version (${JSON.stringify(plugin.version)})`);
  }
  if (!SEMVER_RE.test(env.producer_version || '')) {
    fail(`envelope.producer_version must be SemVer 2.0.0 strict (got ${JSON.stringify(env.producer_version)})`);
  }

  // 4. run_id ULID (Crockford Base32, 26 chars, MSB-first time).
  if (!ULID_RE.test(env.run_id || '')) {
    fail(`envelope.run_id must match ULID regex ^[0-9A-HJKMNP-TV-Z]{26}$ (got ${JSON.stringify(env.run_id)})`);
  }

  // 5. generated_at RFC 3339.
  if (!RFC3339_RE.test(env.generated_at || '')) {
    fail(`envelope.generated_at must be RFC 3339 (got ${JSON.stringify(env.generated_at)})`);
  }

  // 6. git block.
  if (!env.git || typeof env.git !== 'object' || Array.isArray(env.git)) {
    fail('envelope.git missing or not a non-array object');
  } else {
    reportUnknownKeys(env.git, ALLOWED_GIT_KEYS, 'envelope.git', false);
    if (!GIT_HEAD_RE.test(env.git.head || '')) {
      fail(`envelope.git.head must match ^[a-f0-9]{7,40}$ (got ${JSON.stringify(env.git.head)})`);
    }
    if (typeof env.git.branch !== 'string' || env.git.branch.length === 0) {
      fail(`envelope.git.branch must be non-empty string (got ${JSON.stringify(env.git.branch)})`);
    }
    if (env.git.dirty !== true && env.git.dirty !== false && env.git.dirty !== 'unknown') {
      fail(`envelope.git.dirty must be true|false|"unknown" (got ${JSON.stringify(env.git.dirty)})`);
    }
  }

  // 7. provenance block.
  if (!env.provenance || typeof env.provenance !== 'object' || Array.isArray(env.provenance)) {
    fail('envelope.provenance missing or not a non-array object');
  } else {
    reportUnknownKeys(env.provenance, ALLOWED_PROVENANCE_KEYS, 'envelope.provenance', false);
    if (!Array.isArray(env.provenance.source_artifacts)) {
      fail('envelope.provenance.source_artifacts must be an array');
    } else {
      env.provenance.source_artifacts.forEach((sa, idx) => {
        if (!sa || typeof sa !== 'object' || Array.isArray(sa) || typeof sa.path !== 'string' || sa.path.length === 0) {
          fail(`envelope.provenance.source_artifacts[${idx}].path must be non-empty string`);
        } else {
          reportUnknownKeys(sa, ALLOWED_SOURCE_ARTIFACT_KEYS, `envelope.provenance.source_artifacts[${idx}]`, false);
        }
      });
    }
    // tool_versions: must be a non-array object whose values are string|object (suite schema mirror).
    // typeof [] === 'object' in JS, so Array.isArray() guard is required (deep-docs round-3 lesson).
    const tv = env.provenance.tool_versions;
    if (!tv || typeof tv !== 'object' || Array.isArray(tv)) {
      fail(`envelope.provenance.tool_versions must be a non-array object (got ${Array.isArray(tv) ? 'array' : typeof tv})`);
    } else {
      for (const [k, v] of Object.entries(tv)) {
        if (typeof v === 'string') continue;
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) continue;
        fail(`envelope.provenance.tool_versions.${k} must be string or non-array object (got ${Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v)})`);
      }
    }
  }

  // schema block additionalProperties (already verified .name/.version present).
  if (env.schema && typeof env.schema === 'object' && !Array.isArray(env.schema)) {
    reportUnknownKeys(env.schema, ALLOWED_SCHEMA_KEYS, 'envelope.schema', false);
  }

  // 8. payload structure (deep-dashboard/harnessability-report v1.0 shape).
  // Minimal per-shape check (full schema deferred to suite-side payload-registry
  // per handoff §3.4). Shape mirrors `scoreHarnessability()` result minus
  // `generated_at` (which migrates into envelope).
  const pl = data.payload;
  if (!pl || typeof pl !== 'object' || Array.isArray(pl)) {
    fail('payload must be a non-null, non-array object');
    return;
  }
  if (typeof pl.total !== 'number' || !Number.isFinite(pl.total)) {
    fail(`payload.total must be a finite number (got ${JSON.stringify(pl.total)})`);
  }
  if (typeof pl.grade !== 'string' || pl.grade.length === 0) {
    fail(`payload.grade must be non-empty string (got ${JSON.stringify(pl.grade)})`);
  }
  if (!Array.isArray(pl.dimensions)) {
    fail('payload.dimensions must be an array');
  } else {
    // Mirror the producer-side invariant (lib/harnessability/scorer.js + checklist.json):
    // exactly 6 dimensions are emitted (type_safety / module_boundaries / test_infra /
    // sensor_readiness / linter_formatter / ci_cd). The validator is the only zero-dep
    // contract maintainers run against arbitrary fixtures, so without this length check
    // a malformed emit (e.g., dimensions: []) would silent-pass.
    if (pl.dimensions.length !== 6) {
      fail(`payload.dimensions must have exactly 6 entries (got ${pl.dimensions.length})`);
    }
    pl.dimensions.forEach((d, idx) => {
      if (!d || typeof d !== 'object' || Array.isArray(d)) {
        fail(`payload.dimensions[${idx}] must be a non-null, non-array object`);
        return;
      }
      if (typeof d.id !== 'string' || d.id.length === 0) {
        fail(`payload.dimensions[${idx}].id must be non-empty string`);
      }
      if (typeof d.score !== 'number' || !Number.isFinite(d.score)) {
        fail(`payload.dimensions[${idx}].score must be a finite number`);
      }
      if (typeof d.weight !== 'number' || !Number.isFinite(d.weight)) {
        fail(`payload.dimensions[${idx}].weight must be a finite number`);
      }
      if (!Array.isArray(d.checks)) {
        fail(`payload.dimensions[${idx}].checks must be an array`);
      }
    });
  }
  if (!Array.isArray(pl.recommendations)) {
    fail('payload.recommendations must be an array');
  }
  // `projectRoot`, `topology`, `topology_hints` are optional payload fields;
  // we don't enforce their presence here (caller-controlled).
}

const target = process.argv[2] || DEFAULT_FIXTURE;
check(target);

if (errors.length > 0) {
  for (const e of errors) {
    process.stderr.write(`validate-envelope-emit: ${e}\n`);
  }
  process.exit(1);
}

process.stdout.write(`✓ ${target} matches deep-dashboard M3 envelope contract\n`);
