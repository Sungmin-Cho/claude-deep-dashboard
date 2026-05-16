#!/usr/bin/env node
/**
 * Catalog drift checker — guards against silent drift between
 *   claude-deep-dashboard/lib/test-catalog-manifest.json   (dashboard-internal)
 *   claude-deep-suite/docs/test-catalog.md                 (authoritative)
 *
 * The dashboard manifest is the single source of truth for the
 * suite.tests.coverage_per_plugin metric (M5.5-activated, v1.3.2). It
 * mirrors §1-§8 of the suite-repo catalog 1:1. Catalog drift was a manual
 * review-time check until v1.3.3 (W1) — this script automates the
 * comparison so CI can catch silent drift (e.g. suite-repo flips §5
 * status → dashboard manifest doesn't follow).
 *
 * Exit codes:
 *   0 — manifest and suite-repo table agree
 *   1 — drift detected (diff printed to stderr)
 *   2 — fetch/parse error
 *
 * Suite-catalog source resolution (first hit wins):
 *   1. `--suite-path=<path>` flag      — local file (dev convenience)
 *   2. `SUITE_REPO_LOCAL=<path>` env   — local file (CI optionally)
 *   3. `gh api repos/Sungmin-Cho/claude-deep-suite/contents/docs/test-catalog.md`
 *                                       — CI default, requires gh CLI in PATH
 *
 * Mirrors the suite-repo manifest-doc-sync.yml pattern at the dashboard
 * level. Run via `npm run check:catalog-drift`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MANIFEST_PATH = path.join(__dirname, '..', 'lib', 'test-catalog-manifest.json');

/**
 * Parses the `## Catalog ...` markdown table at the top of suite-repo
 * docs/test-catalog.md. Returns rows in document order:
 *   { id, name, participating_plugins, done }
 *
 * Heading regex is intentionally loose (`^## Catalog\b`) so that suite
 * authors can annotate the count freely (e.g., `## Catalog (8 M5.5 tests
 * + 1 M5.7.B extension)`). The heading only serves as a table anchor;
 * the dashboard's tracked scope is governed by manifest contents, not
 * the heading text. See `diffCatalog` for the horizon mechanism.
 *
 * Column convention (mirrors suite-repo doc):
 *   | # | 테스트 | 책임 plugin | 위치 | 실행 | 상태 |
 *   The `상태` cell is treated as "done" iff it begins with the ✅ glyph
 *   (Unicode WHITE HEAVY CHECK MARK U+2705). Other glyphs (⏳, 🚫, …)
 *   map to done=false.
 */
export function parseSuiteCatalogTable(md) {
  const lines = md.split('\n');
  const startIdx = lines.findIndex((l) => /^## Catalog\b/.test(l));
  if (startIdx === -1) {
    throw new Error('catalog table heading not found in suite-repo doc (expected `## Catalog …`)');
  }
  const rows = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    // Stop at the section terminator (`---`) once we've parsed at least one row.
    if (line.startsWith('---') && rows.length > 0) break;
    // Skip blank / non-table lines.
    if (!line.startsWith('|')) continue;
    // Skip the markdown separator row (`| --- | --- | …`).
    if (/^\|[\s|:-]+\|$/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length < 6) continue;
    const idCell = cells[0];
    // Skip the header row (`# | 테스트 | …`) — only integer-id rows are data.
    if (!/^\d+$/.test(idCell)) continue;
    rows.push({
      id: idCell,
      name: cells[1],
      // The `책임 plugin` cell uses either `,` or ` + ` as the multi-plugin
      // separator depending on author style (suite-repo catalog uses both
      // historically: §3 with `, ` and §7/§8 with ` + `). Treat both as
      // logically equivalent to keep the drift check semantic-only.
      participating_plugins: cells[2].split(/[,+]/).map((s) => s.trim()).filter(Boolean),
      done: cells[5].startsWith('✅'),
    });
  }
  return rows;
}

/**
 * Compares manifest.tests[] with parsed table rows. Returns
 *   { diffs, outOfScope }
 * where `diffs` is the list of drift strings (empty = no drift) and
 * `outOfScope` is the list of table rows whose id falls beyond the
 * dashboard's tracked horizon. The script's `main()` exits 1 when
 * `diffs` is non-empty; `outOfScope` rows are reported as info only.
 *
 * Horizon mechanism (v1.3.5+): the dashboard implicitly tracks
 * `id ∈ [1 .. max(manifest.tests.id)]`. Rows beyond this horizon are
 * suite-side extensions (e.g., §9 cross-plugin e2e regression guard
 * added in suite commit `688370e`) that the dashboard has not adopted
 * for per-plugin coverage aggregation. They are surfaced for visibility
 * but do NOT fail CI — preventing the suite catalog from being unable
 * to grow without lockstep dashboard manifest updates.
 *
 * To promote an out-of-scope row into the tracked set, add it to
 * `lib/test-catalog-manifest.json` (and bump the test-catalog-manifest
 * "exactly N entries" assertion in `test-catalog-manifest.test.js`).
 */
export function diffCatalog(manifest, tableRows) {
  const diffs = [];
  const tableById = new Map(tableRows.map((r) => [r.id, r]));
  const manifestById = new Map(manifest.tests.map((t) => [t.id, t]));

  // Implicit horizon: largest manifest id (parsed as integer for ordering).
  // Rows whose id exceeds this are out-of-scope and reported separately.
  const manifestIdInts = manifest.tests
    .map((t) => parseInt(t.id, 10))
    .filter((n) => Number.isFinite(n));
  const maxManifestId = manifestIdInts.length > 0 ? Math.max(...manifestIdInts) : 0;

  for (const t of manifest.tests) {
    const row = tableById.get(t.id);
    if (!row) {
      diffs.push(`id=${t.id} extra-in-manifest (no row in suite-repo table)`);
      continue;
    }
    if (t.name !== row.name) {
      diffs.push(`id=${t.id} name differs: manifest="${t.name}" vs table="${row.name}"`);
    }
    const mSet = new Set(t.participating_plugins);
    const rSet = new Set(row.participating_plugins);
    const mismatch = mSet.size !== rSet.size
      || [...mSet].some((p) => !rSet.has(p))
      || [...rSet].some((p) => !mSet.has(p));
    if (mismatch) {
      diffs.push(
        `id=${t.id} participating_plugins differ: manifest=[${[...mSet].sort().join(',')}] vs table=[${[...rSet].sort().join(',')}]`
      );
    }
    const mDone = t.status === 'done';
    if (mDone !== row.done) {
      diffs.push(`id=${t.id} status (done?) differs: manifest=${mDone} (status="${t.status}") vs table=${row.done}`);
    }
  }

  const outOfScope = [];
  for (const row of tableRows) {
    if (manifestById.has(row.id)) continue;
    const rowIdInt = parseInt(row.id, 10);
    if (Number.isFinite(rowIdInt) && rowIdInt > maxManifestId) {
      outOfScope.push(row);
      continue;
    }
    diffs.push(`id=${row.id} missing-from-manifest (row present in suite-repo table)`);
  }

  return { diffs, outOfScope };
}

function resolveSuiteCatalog() {
  const argFlag = process.argv.find((a) => a.startsWith('--suite-path='));
  if (argFlag) {
    const p = argFlag.slice('--suite-path='.length);
    return fs.readFileSync(p, 'utf8');
  }
  if (process.env.SUITE_REPO_LOCAL) {
    const p = path.join(process.env.SUITE_REPO_LOCAL, 'docs', 'test-catalog.md');
    return fs.readFileSync(p, 'utf8');
  }
  // CI default: fetch via gh api raw accept header.
  try {
    return execFileSync(
      'gh',
      [
        'api',
        'repos/Sungmin-Cho/claude-deep-suite/contents/docs/test-catalog.md',
        '-H', 'Accept: application/vnd.github.raw',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    );
  } catch (e) {
    throw new Error(
      `gh api fetch failed: ${e.message}. Use --suite-path=<path> or set SUITE_REPO_LOCAL=<suite-repo>.`
    );
  }
}

function main() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    console.error(`[catalog-drift] manifest read failed at ${MANIFEST_PATH}: ${e.message}`);
    process.exit(2);
  }
  let suiteMd;
  try {
    suiteMd = resolveSuiteCatalog();
  } catch (e) {
    console.error(`[catalog-drift] suite-catalog resolution failed: ${e.message}`);
    process.exit(2);
  }
  let rows;
  try {
    rows = parseSuiteCatalogTable(suiteMd);
  } catch (e) {
    console.error(`[catalog-drift] table parse failed: ${e.message}`);
    process.exit(2);
  }
  const { diffs, outOfScope } = diffCatalog(manifest, rows);
  if (outOfScope.length > 0) {
    console.log(
      `[catalog-drift] info — ${outOfScope.length} suite-repo row(s) beyond dashboard scope (id > ${manifest.tests.length}):`
    );
    for (const r of outOfScope) console.log(`  · id=${r.id} "${r.name}" (suite-side; not aggregated by dashboard)`);
  }
  if (diffs.length === 0) {
    console.log(
      `[catalog-drift] OK — manifest (${manifest.tests.length} tests) matches suite-repo table (${rows.length} rows, ${outOfScope.length} out-of-scope).`
    );
    process.exit(0);
  }
  console.error(`[catalog-drift] DRIFT DETECTED (${diffs.length} discrepancies):`);
  for (const d of diffs) console.error(`  • ${d}`);
  process.exit(1);
}

// Only run main() when executed as a script; allow named-export import for tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
