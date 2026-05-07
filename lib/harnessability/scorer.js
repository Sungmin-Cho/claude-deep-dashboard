/**
 * Harnessability Scorer — deep-dashboard
 *
 * 6-dimension scoring engine.  All detectors are purely computational
 * (file / config checks only — no network or subprocess calls).
 *
 * `saveReport()` wraps the score result in the claude-deep-suite M3 cross-plugin
 * envelope (cf. claude-deep-suite/docs/envelope-migration.md §1, §4) so consumers
 * (deep-dashboard collector, suite tooling, future telemetry aggregator) can
 * trace, validate, and compose this artifact uniformly. Identity:
 *   producer       = "deep-dashboard"
 *   artifact_kind  = "harnessability-report"
 *   schema.name    = "harnessability-report"  (Phase 1 round-4 identity check)
 *   schema.version = "1.0"
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Load dimension / check metadata
// ---------------------------------------------------------------------------

const checklist = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'checklist.json'), 'utf8')
);

// ---------------------------------------------------------------------------
// Plugin metadata loader
// ---------------------------------------------------------------------------
//
// `producer_version` MUST match the plugin's own `.claude-plugin/plugin.json`
// `version` field (single source of truth). We resolve plugin.json by walking
// up from this module's directory — NOT by reading from the caller's cwd
// (handoff §4 "literal-cwd-resolve" gotcha: the consumer of this scorer may
// be running from a user project where `.claude-plugin/plugin.json` is some
// unrelated file or absent entirely).

function loadPluginMetadata() {
  // lib/harnessability/scorer.js → ../../.claude-plugin/plugin.json
  const pluginJsonPath = path.resolve(__dirname, '..', '..', '.claude-plugin', 'plugin.json');
  const raw = fs.readFileSync(pluginJsonPath, 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Envelope helpers (zero-dep)
// ---------------------------------------------------------------------------
//
// Mirror of claude-deep-suite/scripts/wrap-artifact.js generateUlid. Implementation
// details documented in docs/envelope-migration.md §4.3:
//   - 48-bit timestamp (MSB-first per ULID spec → lex sort = time sort)
//   - 80-bit randomness
//   - Crockford Base32 26 chars (alphabet excludes I/L/O/U)

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(now = Date.now()) {
  let ts = now;
  const tsChars = new Array(10);
  for (let i = 9; i >= 0; i--) {
    tsChars[i] = CROCKFORD_ALPHABET[ts % 32];
    ts = Math.floor(ts / 32);
  }
  const rb = randomBytes(10);
  let bits = 0n;
  for (const b of rb) bits = (bits << 8n) | BigInt(b);
  const randChars = new Array(16);
  for (let i = 15; i >= 0; i--) {
    randChars[i] = CROCKFORD_ALPHABET[Number(bits & 31n)];
    bits >>= 5n;
  }
  return tsChars.join('') + randChars.join('');
}

// Detect git state from `projectRoot` so the producer's git context is
// recorded — NOT the cwd of the calling process (handoff §4 "literal-cwd-resolve"
// gotcha). Returns the envelope.git block.
//
// Non-git environments use sentinels documented in envelope-migration.md §4.3:
//   head    = "0000000"  (passes regex ^[a-f0-9]{7,40}$)
//   branch  = "HEAD"
//   dirty   = "unknown"  (literal allowed by envelope schema oneOf)
function detectGit(projectRoot) {
  const opts = { cwd: projectRoot, stdio: ['ignore', 'pipe', 'ignore'] };
  try {
    const head = execSync('git rev-parse HEAD', opts).toString().trim();
    if (!/^[a-f0-9]{7,40}$/.test(head)) {
      return { head: '0000000', branch: 'HEAD', dirty: 'unknown' };
    }
    let branch = '';
    try {
      branch = execSync('git rev-parse --abbrev-ref HEAD', opts).toString().trim();
    } catch {
      branch = 'HEAD';
    }
    let dirty;
    try {
      const status = execSync('git status --porcelain', opts).toString();
      dirty = status.length > 0;
    } catch {
      dirty = 'unknown';
    }
    return { head, branch: branch || 'HEAD', dirty };
  } catch {
    return { head: '0000000', branch: 'HEAD', dirty: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function exists(root, ...parts) {
  return fs.existsSync(path.join(root, ...parts));
}

function existsAny(root, candidates) {
  return candidates.some((c) => exists(root, c));
}

/** Read & parse a JSON file, or null on failure. */
function readJson(root, relPath) {
  const abs = path.join(root, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

/** Read a text file, or '' on failure. */
function readText(root, relPath) {
  try {
    return fs.readFileSync(path.join(root, relPath), 'utf8');
  } catch {
    return '';
  }
}

/**
 * Recursively find files whose basename matches a predicate, up to maxDepth.
 */
function findFiles(dir, predicate, maxDepth = 3, _depth = 0) {
  if (_depth > maxDepth) return [];
  let results = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip hidden dirs
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findFiles(full, predicate, maxDepth, _depth + 1));
    } else if (predicate(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Detectors  (return boolean)
// ---------------------------------------------------------------------------

const detectors = {
  // ── type_safety ──────────────────────────────────────────────────────────

  tsconfig_exists(root) {
    return exists(root, 'tsconfig.json');
  },

  tsconfig_strict(root) {
    const cfg = readJson(root, 'tsconfig.json');
    return !!(cfg?.compilerOptions?.strict === true);
  },

  mypy_strict(root) {
    // mypy.ini
    const mypyIni = readText(root, 'mypy.ini');
    if (/strict\s*=\s*[Tt]rue/.test(mypyIni)) return true;
    // pyproject.toml [tool.mypy] strict = true
    const pyproject = readText(root, 'pyproject.toml');
    return /\[tool\.mypy\][\s\S]*?\bstrict\s*=\s*[Tt]rue/.test(pyproject);
  },

  python_type_hints(root) {
    // Must find py.typed marker OR .pyi stub files — NOT just pyproject.toml
    const markerFiles = findFiles(root, (name) => name === 'py.typed', 5);
    if (markerFiles.length > 0) return true;
    const stubs = findFiles(root, (name) => name.endsWith('.pyi'), 5);
    return stubs.length > 0;
  },

  // ── module_boundaries ────────────────────────────────────────────────────

  depcruiser_config(root) {
    return existsAny(root, [
      '.dependency-cruiser.js',
      '.dependency-cruiser.cjs',
      '.dependency-cruiser.json',
    ]);
  },

  src_dir_exists(root) {
    return existsAny(root, ['src', 'lib', 'app']);
  },

  index_files(root) {
    // Look for index.* inside src/ (or project root as fallback)
    const srcDir = ['src', 'lib', 'app'].find((d) => exists(root, d));
    const searchDir = srcDir ? path.join(root, srcDir) : root;
    const files = findFiles(searchDir, (name) => /^index\..+/.test(name), 2);
    return files.length > 0;
  },

  // ── test_infra ────────────────────────────────────────────────────────────

  test_framework(root) {
    const pkg = readJson(root, 'package.json');
    if (pkg) {
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      const testFrameworks = ['jest', 'vitest', 'mocha', 'jasmine', 'ava', 'tap'];
      if (testFrameworks.some((f) => f in allDeps)) return true;
    }
    // Python: pytest.ini or pyproject.toml with [tool.pytest.ini_options]
    if (exists(root, 'pytest.ini')) return true;
    if (exists(root, 'setup.cfg')) {
      const cfg = readText(root, 'setup.cfg');
      if (/\[tool:pytest\]/.test(cfg)) return true;
    }
    if (exists(root, 'pyproject.toml')) {
      const toml = readText(root, 'pyproject.toml');
      if (/\[tool\.pytest/.test(toml)) return true;
    }
    return false;
  },

  test_files_exist(root) {
    const files = findFiles(
      root,
      (name) => /\.(test|spec)\.[jt]sx?$/.test(name) || /\.(test|spec)\.py$/.test(name),
      3
    );
    return files.length > 0;
  },

  coverage_config(root) {
    const pkg = readJson(root, 'package.json');
    if (pkg) {
      // jest.collectCoverage in package.json
      if (pkg.jest?.collectCoverage === true) return true;
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      if ('c8' in allDeps || 'nyc' in allDeps) return true;
    }
    // Python: coverage.ini / .coveragerc / pyproject.toml [tool.coverage]
    if (exists(root, '.coveragerc') || exists(root, 'coverage.ini')) return true;
    if (exists(root, 'pyproject.toml')) {
      const toml = readText(root, 'pyproject.toml');
      if (/\[tool\.coverage/.test(toml)) return true;
    }
    return false;
  },

  // ── sensor_readiness ─────────────────────────────────────────────────────

  linter_config(root) {
    return existsAny(root, [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yaml',
      '.eslintrc.yml',
      'eslint.config.js',
      'eslint.config.cjs',
      'eslint.config.mjs',
      'ruff.toml',
      '.ruff.toml',
    ]);
  },

  typecheck_available(root) {
    return exists(root, 'tsconfig.json') || exists(root, 'mypy.ini') ||
      (() => {
        const toml = readText(root, 'pyproject.toml');
        return /\[tool\.mypy\]/.test(toml);
      })();
  },

  lock_file(root) {
    return existsAny(root, [
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
      'poetry.lock',
      'uv.lock',
    ]);
  },

  // ── linter_formatter ─────────────────────────────────────────────────────

  linter_config_file(root) {
    // Identical logic to linter_config — reuse
    return detectors.linter_config(root);
  },

  formatter_config(root) {
    return existsAny(root, [
      '.prettierrc',
      '.prettierrc.js',
      '.prettierrc.cjs',
      '.prettierrc.json',
      '.prettierrc.yaml',
      '.prettierrc.yml',
      'prettier.config.js',
      'prettier.config.cjs',
      'prettier.config.mjs',
      '.editorconfig',
      'biome.json',
      'biome.jsonc',
    ]);
  },

  // ── ci_cd ─────────────────────────────────────────────────────────────────

  ci_config_exists(root) {
    return (
      exists(root, '.github', 'workflows') ||
      exists(root, '.gitlab-ci.yml') ||
      exists(root, '.circleci')
    );
  },

  ci_runs_tests(root) {
    // Scan YAML files under .github/workflows for test-related keywords
    const workflowsDir = path.join(root, '.github', 'workflows');
    const yamlFiles = [];
    if (fs.existsSync(workflowsDir)) {
      try {
        const entries = fs.readdirSync(workflowsDir);
        for (const e of entries) {
          if (/\.(yml|yaml)$/.test(e)) {
            yamlFiles.push(path.join(workflowsDir, e));
          }
        }
      } catch { /* ignore */ }
    }
    if (exists(root, '.gitlab-ci.yml')) yamlFiles.push(path.join(root, '.gitlab-ci.yml'));
    if (exists(root, '.circleci', 'config.yml'))
      yamlFiles.push(path.join(root, '.circleci', 'config.yml'));

    const keywords = /\b(test|jest|vitest|pytest|mocha|coverage)\b/i;
    return yamlFiles.some((f) => {
      try { return keywords.test(fs.readFileSync(f, 'utf8')); }
      catch { return false; }
    });
  },
};

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function grade(total) {
  if (total >= 8) return 'Excellent';
  if (total >= 5) return 'Good';
  if (total >= 3) return 'Fair';
  return 'Poor';
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

/**
 * @param {string} projectRoot
 * @param {{ topology?: object, topologyHints?: string[] }} [options]
 * @returns {Promise<ScoringResult>}
 */
export async function scoreHarnessability(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const dimensions = [];
  const recommendations = [];

  // Detect ecosystem for type_safety dimension filtering
  const isTypeScript = exists(root, 'tsconfig.json');
  const isPython = exists(root, 'pyproject.toml') || exists(root, 'setup.py') || exists(root, 'requirements.txt') || exists(root, 'py.typed');
  const TS_ONLY_CHECKS = new Set(['tsconfig_strict', 'tsconfig_exists']);
  const PY_ONLY_CHECKS = new Set(['mypy_strict', 'python_type_hints']);

  for (const dim of checklist.dimensions) {
    const checks = dim.checks.map((chk) => {
      // Skip ecosystem-irrelevant checks (not_applicable)
      if (dim.id === 'type_safety') {
        if (TS_ONLY_CHECKS.has(chk.id) && !isTypeScript) return { id: chk.id, label: chk.label, passed: false, not_applicable: true };
        if (PY_ONLY_CHECKS.has(chk.id) && !isPython) {
          // Run the detector anyway — if it passes (e.g. finds py.typed in subdirs), this IS a Python project
          const detector = detectors[chk.id];
          const detected = detector ? detector(root) : false;
          if (!detected) return { id: chk.id, label: chk.label, passed: false, not_applicable: true };
          // Detector passed → this is a Python project, proceed normally
          return { id: chk.id, label: chk.label, passed: true };
        }
      }
      const detector = detectors[chk.id];
      const passed = detector ? detector(root) : false;
      return { id: chk.id, label: chk.label, passed };
    });

    const applicableChecks = checks.filter((c) => !c.not_applicable);
    const passedCount = applicableChecks.filter((c) => c.passed).length;
    const score = applicableChecks.length > 0
      ? Math.round((passedCount / applicableChecks.length) * 10 * 10) / 10
      : 0;

    dimensions.push({
      id: dim.id,
      label: dim.label,
      weight: dim.weight,
      score,
      checks,
    });

    // Collect recommendations for failing checks in low-scoring dimensions
    if (score < 5) {
      for (const chk of checks) {
        if (!chk.passed && !chk.not_applicable) {
          recommendations.push({
            dimension: dim.id,
            check: chk.id,
            action: chk.label,
          });
        }
      }
    }
  }

  // Weighted average
  let total = 0;
  for (const dim of dimensions) {
    total += dim.score * dim.weight;
  }
  total = Math.round(total * 10) / 10;

  return {
    projectRoot: root,
    total,
    grade: grade(total),
    dimensions,
    recommendations,
    topology: options.topology ?? null,
    topology_hints: options.topologyHints ?? null,
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Envelope wrap
// ---------------------------------------------------------------------------

/**
 * Wrap a scoreHarnessability result in the M3 cross-plugin envelope.
 *
 * Returns the envelope-shaped object (does not write to disk).
 * `result` is the object returned by `scoreHarnessability` — its shape
 * (excluding `generated_at`, which migrates to `envelope.generated_at`)
 * becomes `payload`.
 */
export function wrapInEnvelope(result, options = {}) {
  const plugin = loadPluginMetadata();
  const projectRoot = options.projectRoot ?? result.projectRoot ?? null;
  const generatedAt = options.generatedAt ?? result.generated_at ?? new Date().toISOString();
  const git = options.git ?? (projectRoot ? detectGit(projectRoot) : { head: '0000000', branch: 'HEAD', dirty: 'unknown' });

  // Payload excludes envelope-owned fields; everything else is preserved verbatim.
  // Keeping `result.generated_at` out of the payload avoids two timestamps drifting.
  const { generated_at: _gen, ...payloadFromResult } = result;

  const envelope = {
    $schema: 'https://raw.githubusercontent.com/Sungmin-Cho/claude-deep-suite/main/schemas/artifact-envelope.schema.json',
    schema_version: '1.0',
    envelope: {
      producer: 'deep-dashboard',
      producer_version: plugin.version,
      artifact_kind: 'harnessability-report',
      run_id: options.runId ?? generateUlid(),
      generated_at: generatedAt,
      schema: { name: 'harnessability-report', version: '1.0' },
      git,
      provenance: {
        // Harnessability scoring is purely computational over the project
        // root — there are no upstream artifact files to cite. We emit the
        // root path as the "source" so consumers can locate the surveyed tree.
        source_artifacts: projectRoot ? [{ path: projectRoot }] : [],
        tool_versions: {
          node: process.version,
        },
      },
    },
    payload: payloadFromResult,
  };

  return envelope;
}

// ---------------------------------------------------------------------------
// Report writer
// ---------------------------------------------------------------------------

/**
 * Write result to <projectRoot>/.deep-dashboard/harnessability-report.json,
 * wrapped in the M3 cross-plugin envelope.
 *
 * @param {string} projectRoot
 * @param {object} result  — the object returned by scoreHarnessability
 * @returns {{ path: string, envelope: object }}  the output path and the
 *   envelope written (callers may forward this to stdout / consumers)
 */
export function saveReport(projectRoot, result) {
  const dir = path.join(projectRoot, '.deep-dashboard');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'harnessability-report.json');
  const envelope = wrapInEnvelope(result, { projectRoot });
  fs.writeFileSync(outPath, JSON.stringify(envelope, null, 2));
  return { path: outPath, envelope };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------
// When invoked as `node scorer.js <projectRoot>`, compute the score for
// that project, save the envelope-wrapped report, and emit the envelope JSON
// on stdout. If no argument is given, uses cwd.
// This entry block is a no-op when scorer.js is imported as a module.

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const projectRoot = process.argv[2] ?? process.cwd();
  const result = await scoreHarnessability(projectRoot);
  const { envelope } = saveReport(projectRoot, result);
  console.log(JSON.stringify(envelope, null, 2));
}
