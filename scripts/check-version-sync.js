#!/usr/bin/env node
// check-version-sync.js — guards against drift between package.json.version
// and the Claude and Codex plugin manifest versions.
//
// The envelope's `producer_version` is sourced from plugin.json (see
// `lib/harnessability/scorer.js`), so plugin.json is the single source of
// truth. package.json and the Codex manifest must stay in lockstep so
// npm-style tooling agrees with the plugin-side identity advertised in every
// M3 envelope emit.
//
// Usage:
//   node scripts/check-version-sync.js [repo-root]
//
// Exit: 0 = versions match, 1 = drift (error printed to stderr,
//       prefix "check-version-sync:").

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, '..');

function readJson(rel) {
  const path = resolve(REPO_ROOT, rel);
  try {
    return { path, data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    process.stderr.write(`check-version-sync: cannot read ${path}: ${e.message}\n`);
    process.exit(1);
  }
}

const pkg = readJson('package.json');
const manifests = [
  pkg,
  readJson('.claude-plugin/plugin.json'),
  readJson('.codex-plugin/plugin.json')
];

for (const manifest of manifests) {
  if (manifest.data === null || typeof manifest.data !== 'object' || Array.isArray(manifest.data)) {
    process.stderr.write(`check-version-sync: ${manifest.path}: manifest must be a non-null object\n`);
    process.exit(1);
  }
  if (typeof manifest.data.version !== 'string' || manifest.data.version.length === 0) {
    process.stderr.write(`check-version-sync: ${manifest.path}.version missing or empty\n`);
    process.exit(1);
  }
}

const drifted = manifests.slice(1).filter((manifest) => manifest.data.version !== pkg.data.version);
if (drifted.length > 0) {
  for (const manifest of drifted) {
    process.stderr.write(
      `check-version-sync: drift detected — ` +
      `${pkg.path}.version=${JSON.stringify(pkg.data.version)} vs ` +
      `${manifest.path}.version=${JSON.stringify(manifest.data.version)}\n`
    );
  }
  process.exit(1);
}

process.stdout.write(`✓ package.json, .claude-plugin/plugin.json, and .codex-plugin/plugin.json agree on version ${pkg.data.version}\n`);
