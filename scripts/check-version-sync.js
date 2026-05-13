#!/usr/bin/env node
// check-version-sync.js — guards against drift between package.json.version
// and .claude-plugin/plugin.json.version.
//
// The envelope's `producer_version` is sourced from plugin.json (see
// `lib/harnessability/scorer.js`), so plugin.json is the single source of
// truth. package.json must stay in lockstep so npm-style tooling agrees with
// the plugin-side identity advertised in every M3 envelope emit.
//
// Usage:
//   node scripts/check-version-sync.js
//
// Exit: 0 = versions match, 1 = drift (error printed to stderr,
//       prefix "check-version-sync:").

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

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
const plugin = readJson('.claude-plugin/plugin.json');

if (typeof pkg.data.version !== 'string' || pkg.data.version.length === 0) {
  process.stderr.write(`check-version-sync: package.json.version missing or empty\n`);
  process.exit(1);
}
if (typeof plugin.data.version !== 'string' || plugin.data.version.length === 0) {
  process.stderr.write(`check-version-sync: .claude-plugin/plugin.json.version missing or empty\n`);
  process.exit(1);
}

if (pkg.data.version !== plugin.data.version) {
  process.stderr.write(
    `check-version-sync: drift detected — ` +
    `package.json.version=${JSON.stringify(pkg.data.version)} vs ` +
    `.claude-plugin/plugin.json.version=${JSON.stringify(plugin.data.version)}\n`
  );
  process.exit(1);
}

process.stdout.write(`✓ package.json and .claude-plugin/plugin.json agree on version ${pkg.data.version}\n`);
