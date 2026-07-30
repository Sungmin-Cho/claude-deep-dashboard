// Reference integrity for the always-loaded instruction surfaces.
//
// Ported from the deep-goal and deep-work guards of the same name and adapted
// to this repo: the sources are ESM, there is no `agents/` directory, the
// shipped-set authority is `git ls-files` rather than `package.json#files`
// (this package declares no `files` array — a marketplace install is a clone,
// so what git tracks is what an installed plugin holds), and the anchor is the
// documentation placeholder `<plugin-root>` rather than a shell variable. See
// the ANCHOR note below for why that last difference is load-bearing here.
//
// Fence balance is checked because a `references/` split once truncated a
// fenced template mid-block in a sibling: the entry kept the opening ``` and
// the first dozen template lines, the remainder moved behind a conditional
// pointer, and nothing failed. An odd fence count is the machine-detectable
// signature of that class.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep, win32 } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { probeSymlinkCapability } from '../lib/test-support/symlink-capability.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALWAYS_LOADED = ['AGENTS.md', 'CLAUDE.md'];

function markdownFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out.push(p);
    }
  };
  walk(join(ROOT, 'skills'));
  // The always-loaded agent guides are instruction surfaces under the same
  // rule. `ALWAYS_LOADED` is asserted to be in the scan set by its own test, so
  // dropping it here fails loudly instead of silently shrinking coverage.
  for (const doc of ALWAYS_LOADED) {
    const p = join(ROOT, doc);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

// Every `.md` under skills/ — the documents an attacker would want to shadow.
// A bare Read(`SKILL.md`) names one of these with no basis at all, so it
// resolves against cwd, which is the target workspace.
const PLUGIN_DOCS = (() => {
  const names = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) names.add(entry.name);
    }
  };
  walk(join(ROOT, 'skills'));
  return names;
})();

// Workspace-shadow guard.
//
// A bare `Read lib/suite-collector.js` or `node scripts/dashboard-cli.js`
// resolves against the *target workspace*, not the plugin. A repository under
// analysis can put a file at that path and have it read as instructions or run
// with the caller's Bash permissions — and this plugin is pointed at foreign
// repositories by design (`--project-root <target>`), so "the analysed project
// is hostile" is its ordinary operating condition, not an edge case.
//
// Parent-relative forms (`../deep-harness-dashboard/SKILL.md`) are just as
// shadowable. A markdown link resolves against the source file, but a runtime
// read has no such basis — it resolves against cwd. So this guard must NOT
// reuse the reference-integrity resolution below: integrity asks "does this
// file exist?" and may resolve relative to the source; the shadow guard asks
// "does this instruction name a trustworthy basis?", and only an explicit
// plugin-root anchor does.
//
// Two clauses, both required for every instruction form:
//   A. anchoring   — the path names the plugin root explicitly.
//   B. containment — the resolved path stays inside the plugin root.
// Clause B is not implied by A: `<plugin-root>/../workspace/evil.md` carries
// the anchor and still escapes.
//
// Scope: paths the plugin tells an agent to *open or run*. For `.js`/`.sh` that
// is every mention — naming an executable is only useful for running it — so
// those are checked wherever they appear. A descriptive cross-reference to a
// `.md` in prose is not a load instruction, but deny-by-default below does not
// try to tell the two apart: any token resolving to a real plugin file must be
// anchored regardless of the sentence around it.
//
// ANCHOR. This plugin runs on both Claude Code and Codex, and Codex sets no
// `CLAUDE_PLUGIN_ROOT` — the skills say so themselves. Its portable contract is
// instead `pluginRoot = dirname(dirname(dirname(loadedSkillPath)))`: derive the
// installed plugin root once, from the absolute path of the loaded SKILL.md,
// then write every path against that root. `<plugin-root>` is the placeholder
// for that derived root and is the repo's single anchor spelling. A
// shell-expanded spelling is not an alternative here, it is a defect — see the
// two anchor-spelling tests at the bottom, which close that on the shell axis
// (`$VAR/…`) and the placeholder axis (`<other-root>/…`) separately.
//
// SEPARATORS. Windows is a supported host — `ci.yml` runs windows-latest and
// the package script is asserted POSIX-free — so `scripts\dashboard-cli.js`
// names the same file as `scripts/dashboard-cli.js`. A matcher that knows only
// `/` lets the whole deny-by-default invariant be bypassed with one character.
//
// Every matcher below therefore accepts either separator, and every extracted
// token is normalised before it is resolved or compared. Runs of separators
// collapse together, so an escaped `scripts\\x.js` in a string literal
// normalises to the same path. Over-normalising is the safe direction here:
// a token only matters once it resolves to a real file in the plugin, and prose
// containing a stray backslash resolves to nothing.
const SEP = String.raw`[\\/]`;
const normalizePath = (token) => token.replace(/[\\/]+/g, '/');

const ANCHOR = String.raw`<plugin-root>`;
const ANCHOR_NAME = 'plugin-root';
const ANCHORED_TOKEN = new RegExp(`^(?:${ANCHOR})/`);

// DENY BY DEFAULT.
//
// Enumerating instruction syntaxes is the losing half of the problem — each
// round of the original review found a form outside the current allowlist. So
// the question is not "is this a known instruction syntax?" but "does this
// token resolve to a real file in the plugin?". Anything that does must be
// anchored, whatever the verb, extension or sentence around it. Anything that
// does not resolve is prose about the target project and passes.
//
// SHIPPED-SET AUTHORITY. `git ls-files`, not a directory walk with a skip list.
// A walk indexes whatever the maintainer's checkout happens to hold — here that
// is `.deep-review/`, `.serena/`, `docs/DOCS_RULE.md` and `docs/backlog-*.md`,
// none of which exist in CI or in an installed plugin — so the deny-by-default
// verdict would differ per machine, with CI on the lax side. Every skip list
// that tried to fix that was an enumeration and leaked the first time a
// directory was added. Tracked files are the whole answer: this package
// declares no `files` array and is installed by cloning the repo at a pinned
// SHA, so what git tracks IS what the installed plugin holds. That also gets
// `docs/` right, which no skip list can: `docs/DOCS_RULE.md` is gitignored and
// `docs/monitor-decision.md` is tracked and ships, and only the tracked-set
// question separates them.
//
// `toKey` and `tracked` are injectable for the same reason: the Windows key
// shape has to be pinnable from a POSIX runner, and `toKey` is the single place
// a platform separator enters the key set. Both sides of every later comparison
// go through the same normalisation.
function trackedFiles() {
  return execFileSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

function buildPluginFiles({ toKey = (p) => relative(ROOT, p), tracked = trackedFiles() } = {}) {
  const rel = new Set();
  for (const gitPath of tracked) {
    // Normalise the KEY as well as the lookup. `relative()` returns backslashes
    // on Windows, so a raw key set and a normalised lookup are two different
    // spellings and every `has()` misses — which makes deny-by-default report
    // nothing and the guard pass while a violation is present. Silently green
    // is the worst failure mode a guard has, and `tests.yml` runs windows-latest.
    rel.add(normalizePath(toKey(join(ROOT, gitPath))));
  }
  return rel;
}

const PLUGIN_FILES = buildPluginFiles();

// Derived from the index rather than written out. A hand-listed
// `skills|scripts|lib|…` matched the tree on the day it was typed and would
// have gone quiet the first time a directory was added — the same enumeration
// defect the deny-by-default rule exists to avoid, one level down.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PLUGIN_DIRS = [...new Set(
  [...PLUGIN_FILES].filter((k) => k.includes('/')).map((k) => k.split('/')[0]),
)].sort().map(escapeRe).join('|');

const PATH_BODY = String.raw`[A-Za-z0-9._/\\${'{}'}|$<>-]+`;
const REL = String.raw`\.{1,2}${SEP}`;
const ANY_ROOT = String.raw`(?:(?:${ANCHOR})${SEP}|${REL}|(?:${PLUGIN_DIRS})${SEP})`;

// Each pattern captures the path token in group 1, so anchoring and containment
// are judged per token rather than per line — a line mixing an anchored and a
// bare path must still fail on the bare one.
const FORMS = [
  // 1. interpreter exec: `node X`, `bash X`, `sh X`, `python X`
  ['interpreter-exec', new RegExp(String.raw`\b(?:bash|sh|zsh|node|python3?)\s+["'\`]?(${ANY_ROOT}${PATH_BODY})`, 'g')],
  // 2. read verb: `Read X`, `Follow X`. Korean pointer forms are covered by
  //    deny-by-default below; this catches the explicit English verb forms.
  ['read-verb', new RegExp(String.raw`\b(?:Read|Follow|read|follow)\s*\(?\s*["'\`]?(${ANY_ROOT}${PATH_BODY}\.md)`, 'g')],
  // 3. direct exec / source
  ['direct-exec', new RegExp(String.raw`(?:\b(?:source|exec)\s+|^\s*\.\s+)["'\`]?(${ANY_ROOT}${PATH_BODY})`, 'gm')],
  // 4. executable path token anywhere
  //    The trailing boundary matters: without it `.js` matches the prefix of
  //    `plugin.json` and the guard reports a file that does not exist.
  ['executable-token', new RegExp(String.raw`(?<![A-Za-z0-9._/\\{}<>$-])((?:${ANCHOR})${SEP}|${REL}|(?:${PLUGIN_DIRS})${SEP})([A-Za-z0-9._/\\-]*\.(?:js|sh|mjs|cjs)(?![A-Za-z0-9]))`, 'g')],
];

// NON-SHIPPED PATHS.
//
// A path under a directory the plugin never ships is the *worst* case of the
// shadow class, not an exempt one: it cannot resolve inside an installed plugin
// at all, so the only place it can ever resolve is the analysed project. It is
// also the case deny-by-default structurally cannot see, because that rule asks
// "does this resolve in the plugin?" and the answer is permanently no.
//
// So each such path is listed here with the clauses that make it safe to read,
// and a test below asserts the naming document carries all of them.
//
// Pin the PROHIBITION, not the provenance. A sibling's first version matched
// "ships with nothing" alone, which is a fact about the file rather than an
// instruction about it: review trimmed the caveat down to that clause, deleting
// the whole protective sentence, and every test still passed. What keeps the
// path safe is the sentence telling a reader not to open it and why — so that
// is what is required here.
const NON_SHIPPED = new Map([
  ['docs/DOCS_RULE.md', [
    /ships with nothing/,
    /never try to open it at runtime/,
    /only place that path can resolve in an installed plugin is the project being analysed/,
  ]],
]);

// Blockquote markers and hard wraps must not decide whether a caveat counts, so
// the required clauses are matched against a flattened body.
function flatten(body) {
  return body.replace(/^[ \t]*>[ \t]?/gm, '').replace(/\s+/g, ' ');
}

// Path-shaped tokens: multi-segment paths only.
//
// The `+` on the separator class is load-bearing. Without it a run of
// separators breaks the segment repetition and the whole match dies, so the
// path is never extracted and deny-by-default never sees it.
//
// There is deliberately NO single-segment alternative, and therefore no
// ROOT_METADATA allowlist. The siblings carry one — `package.json`,
// `AGENTS.md`, `SKILL.md`, … — because a bare basename mentioned descriptively
// ("Codex passes the loaded `SKILL.md` path itself") resolves through the
// source-relative branch and reads as a violation. That list is an enumeration,
// and it is unnecessary: a single-segment token is exactly the shape the two
// verb-keyed basename rules below already govern, where an interpreter or a
// read verb is what turns a name into an instruction. Dropping the alternative
// removes the allowlist and loses no detection.
const PATH_TOKEN = /[A-Za-z0-9_.@${}<>-]+(?:[\\/]+[A-Za-z0-9_.@{}|*-]+)+/g;

// An angle-bracket placeholder standing where a path root goes. The lookbehind
// keeps `.deep-work/<session>/handoff.json` out: a placeholder mid-path is a
// segment, not a root.
const PLACEHOLDER_ROOT_TOKEN = /^<[A-Za-z0-9][A-Za-z0-9_-]*>\//;

// `files` is injectable for the same reason `toKey` is: the Windows key shape
// has to be pinnable in CI, not merely checked once by hand.
// `rel` is injectable alongside `files` because the `fromSource` normalisation
// is otherwise unpinnable: on POSIX `relative()` already returns slashes, so
// removing the normalisation is a no-op here and no mutation can see it. Only a
// win32 `relative` exercises it, and it has to be injected into the production
// call site — a copy of the logic in a test pins the test's arithmetic, not the
// guard's.
function resolvesInPlugin(token, sourceFile, files = PLUGIN_FILES, rel = relative) {
  const clean = normalizePath(token).replace(/^\.\//, '');
  if (files.has(clean)) return true;
  try {
    const fromSource = normalizePath(rel(ROOT, resolve(dirname(sourceFile), clean)));
    if (files.has(fromSource)) return true;
  } catch { /* unresolvable token — prose */ }
  return false;
}

// Scope, defined once. Yields the path tokens on a line that the invariant
// governs, with the documented exemptions applied. Both the classifier and the
// malicious-workspace fixture consume this, so they cannot test different rules.
function* scopedTokens(line) {
  PATH_TOKEN.lastIndex = 0;
  let m;
  while ((m = PATH_TOKEN.exec(line))) {
    // Normalise once, here, so every consumer of scopedTokens — the classifier
    // and the malicious-workspace fixture alike — judges the same string.
    const raw = normalizePath(m[0]);
    // A token rooted at some OTHER angle-bracket placeholder is adjudicated by
    // the anchor-spelling test below, not here. That test asks whether the path
    // UNDER the placeholder resolves in the plugin, which is the only structural
    // way to tell a second spelling of the plugin root
    // (`<absolute-plugin-root>/lib/…`) from a legitimately different root
    // (`<wiki_root>/log.jsonl`, an external Obsidian vault this plugin reads by
    // configuration). Reporting them here would give the first the wrong reason
    // and the second a false positive.
    //
    // This runs BEFORE the bracket trimming below, and the order is the whole
    // rule: trimming first turns `<wiki_root>/…` into `wiki_root>/…`, which no
    // longer matches a placeholder root, so the skip never fired and the
    // exemption was dead — caught by its own pin, not by reading.
    if (PLACEHOLDER_ROOT_TOKEN.test(raw) && !ANCHORED_TOKEN.test(raw)) continue;
    // `<` and `>` are in the character class only to admit the anchor. Without
    // trimming them, `<skills/…/x.md 첨부>` extracts with a leading `<`, fails
    // to resolve, and the token silently escapes the guard. A bracket that opens
    // a whole placeholder segment is handled above; this is the incidental one,
    // where the `<` belongs to the surrounding prose.
    let token = raw;
    if (token.startsWith('<') && !token.startsWith(ANCHOR)) token = token.slice(1);
    if (token.endsWith('>') && !token.includes(ANCHOR)) token = token.slice(0, -1);
    const before = line.slice(Math.max(0, m.index - 30), m.index);
    // Already inside an anchored path, written with either separator.
    if (new RegExp(String.raw`${ANCHOR}["'\s]*[\\/]?$`).test(before)) continue;
    // Markdown link target `](x.md)` — rendered navigation between documents,
    // not an instruction handed to a file tool. Markdown does not interpolate,
    // so these must stay source-relative; the link-destination test below pins
    // that they are never anchored.
    if (/\]\($/.test(before)) continue;
    yield token;
  }
}

function denyByDefaultHits(line, sourceFile, root = ROOT) {
  const out = [];
  for (const token of scopedTokens(line)) {
    if (ANCHORED_TOKEN.test(token)) {
      // Clause B is enforced here, not deferred. A contained-looking path whose
      // component links out of the root is exactly the file an attacker wants
      // accepted, so both the lexical check and its symlink form run right here.
      // `every referenced plugin path resolves inside the root` is a second,
      // independent backstop: it resolves each anchored path for real and
      // rejects one landing outside with `resolves outside the plugin root`.
      if (escapesRoot(token)) out.push({ form: 'resolves-in-plugin', token, why: 'escapes plugin root' });
      else if (escapesViaSymlink(token, root)) out.push({ form: 'resolves-in-plugin', token, why: 'escapes via symlink' });
      continue;
    }
    // Forward defence only: a non-shipped path never resolves in the plugin, so
    // this line is unreachable today. All of the actual protection is in the two
    // NON_SHIPPED tests below. It is kept so that adding such a path to the
    // shipped set later fails the caveat test rather than this rule silently.
    if (NON_SHIPPED.has(token)) continue;
    if (resolvesInPlugin(token, sourceFile)) {
      out.push({ form: 'resolves-in-plugin', token, why: 'unanchored' });
    }
  }
  return out;
}

// bare basename read: Read(`SKILL.md`). It resolves to no repo-relative path,
// so the rule above cannot see it — yet it is the weakest form of all,
// resolving straight against cwd. Only basenames that name a real plugin
// document are flagged, so ordinary prose is untouched.
const BARE_BASENAME = /\b(?:Read|Follow|read|follow)\s*\(?\s*["'`]([A-Za-z0-9][A-Za-z0-9._-]*\.md)(?:#[^`"']*)?["'`]/g;

// The executable twin. `Read`/`Follow` on a `.md` was covered; an interpreter on
// a runnable file was not, and that shape is strictly more dangerous: `node
// dashboard-cli.js` resolves against cwd — the analysed workspace — and running
// a planted file there is arbitrary code execution with the caller's
// permissions. Membership in the shipped set is still required, so prose that
// merely names a script is untouched; it is the interpreter that makes it an
// instruction.
const BARE_EXEC_BASENAME =
  /\b(?:node|python3?|deno|bun|bash|sh|zsh)\s+["'`]?([A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|cjs|mjs|py|sh))["'`]?/g;

function bareBasenameHits(line) {
  const out = [];
  BARE_BASENAME.lastIndex = 0;
  let m;
  while ((m = BARE_BASENAME.exec(line))) {
    if (PLUGIN_DOCS.has(m[1])) out.push({ form: 'bare-basename', token: m[1], why: 'unanchored' });
  }
  const shippedBasenames = new Set([...PLUGIN_FILES].map((f) => f.split('/').pop()));
  BARE_EXEC_BASENAME.lastIndex = 0;
  while ((m = BARE_EXEC_BASENAME.exec(line))) {
    if (shippedBasenames.has(m[1])) {
      out.push({ form: 'bare-exec-basename', token: m[1], why: 'unanchored' });
    }
  }
  return out;
}

// JS module load of a plugin path — refused outright, in every spelling.
//
// The rule this enforces is "an instruction document does not embed a JS module
// load of a plugin file", not "anchor it properly". There is no safe textual
// form, because `<plugin-root>` is a placeholder an *agent* substitutes while
// reading prose — no JS runtime expands it. `require("<plugin-root>/lib/x.js")`
// is a bare package specifier, so Node searches the *workspace* node_modules and
// loading a planted module there is arbitrary code execution; the `${…}`
// spelling is the same defect, and its backtick form additionally interpolates a
// local variable rather than the environment. This plugin's documented runtime
// interface is the CLI, so any JS module load naming a plugin path inside an
// instruction document is a violation in every spelling.
const JS_MODULE_LOAD = /(?:\brequire\s*\(|\bimport\s*\(|\bimport\b[^;\n]*?\bfrom\s+)\s*["'`]([^"'`\n]+)["'`]/g;

// A root that some runtime would have to expand, or an agent substitute, for the
// specifier to mean anything. Shared with the anchor-spelling rule below.
const VARIABLE_ROOT = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?[\\/]/;
// The same question asked of a whole specifier: is its ROOT a thing something
// would have to expand? Either spelling — a shell variable or an angle-bracket
// placeholder — is inert inside a JS string, which is exactly the defect.
const ROOTED_SPEC = /^(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|<[A-Za-z0-9][A-Za-z0-9_-]*>)[\\/]/;

function jsModuleLoadHits(line, sourceFile) {
  const out = [];
  JS_MODULE_LOAD.lastIndex = 0;
  let m;
  while ((m = JS_MODULE_LOAD.exec(line))) {
    const spec = m[1];
    const substituted = normalizePath(spec).replace(ROOTED_SPEC, '');
    // Two clauses, and no list of builtin prefixes. A `node:` / bare-package
    // skip list was tried and measured dead: `fs` — the legacy builtin spelling
    // this repo's own §Verification block uses — names no plugin path and
    // resolves nowhere, so both clauses already decline it, and the skip removed
    // no detection. The question is only ever whether the specifier names a
    // plugin file, or names a root that nothing will expand.
    if (!ROOTED_SPEC.test(spec) && !resolvesInPlugin(substituted, sourceFile)) continue;
    out.push({
      form: 'js-module-load',
      token: spec,
      why: 'JS specifier — no runtime substitutes the documentation anchor, so Node '
        + 'resolves it as a bare package under the workspace node_modules',
    });
  }
  return out;
}

const ROOT_SENTINEL = sep === '/' ? '/plugin-root' : 'C:\\plugin-root';

// Clause B. Substitute the anchor with a sentinel root, resolve, and require
// the result to stay inside it. Tokens carrying template placeholders cannot be
// resolved literally, so they are checked lexically for `..` instead.
function escapesRoot(token) {
  const body = normalizePath(token).replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$]/.test(body)) return body.split('/').includes('..');
  const resolved = resolve(ROOT_SENTINEL, body);
  return resolved !== ROOT_SENTINEL && !resolved.startsWith(ROOT_SENTINEL + sep);
}

// Symlink escape: an anchored, lexically-contained path can still point out of
// the root if a component is a symlink. Only checkable for targets that exist.
//
// `root` is a parameter rather than a closed-over constant so the fixture can
// use a throwaway root outside the repository. Planting the symlink inside the
// real root races every other test file — `node --test` runs files in parallel
// processes — and a flaky security guard is worse than a missing one: it teaches
// people to re-run until green.
function escapesViaSymlink(token, root = ROOT) {
  const body = normalizePath(token).replace(new RegExp(`^(?:${ANCHOR})/`), '');
  if (/[{}|$]/.test(body)) return false;
  const target = join(root, body);
  if (!existsSync(target)) return false;
  const real = realpathSync(target);
  const realRoot = realpathSync(root);
  return real !== realRoot && !real.startsWith(realRoot + sep);
}

// Resolve a token for real, from a given cwd, exactly as a runtime agent would.
// Re-running the classifier tells you only what the classifier already believes;
// this performs the resolution and asks which file the instruction lands on. It
// is the second, independent layer, and it is shared by every fixture that needs
// it so no two of them can disagree about what resolution means.
function resolveAsAgentWould(token, cwd) {
  if (ANCHORED_TOKEN.test(token)) {
    return resolve(ROOT, token.replace(new RegExp(`^${ANCHOR}/`), ''));
  }
  return resolve(cwd, token.replace(/^\.\//, ''));
}

// Returns violations on a line: {form, token, why}. Empty when the line is clean.
function shadowableTokens(line, sourceFile = join(ROOT, 'AGENTS.md'), root = ROOT) {
  const out = [];
  for (const [form, re] of FORMS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) {
      const token = normalizePath(m[2] === undefined ? m[1] : m[1] + m[2]);
      if (!ANCHORED_TOKEN.test(token)) out.push({ form, token, why: 'unanchored' });
      else if (escapesRoot(token)) out.push({ form, token, why: 'escapes plugin root' });
      else if (escapesViaSymlink(token, root)) out.push({ form, token, why: 'escapes via symlink' });
    }
  }
  out.push(...bareBasenameHits(line));
  out.push(...jsModuleLoadHits(line, sourceFile));
  out.push(...denyByDefaultHits(line, sourceFile, root));
  // A token can match several FORMS plus deny-by-default; report each once.
  const seen = new Set();
  return out.filter((v) => {
    const key = `${v.token}|${v.why}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Indented too: fences nested in a list item or a numbered step are still fences.
const FENCE = /^[ \t]*```/gm;

function unbalancedFences(files = markdownFiles(), read = readFileSync) {
  const out = [];
  for (const file of files) {
    const fences = (read(file, 'utf8').match(FENCE) || []).length;
    if (fences % 2 !== 0) out.push(`${relative(ROOT, file)} (${fences})`);
  }
  return out;
}

test('every skill and always-loaded markdown file has balanced code fences', () => {
  // Driven over synthetic documents first. No shipped document is unbalanced
  // today, so the corpus sweep below cannot fail by itself — the whole
  // `% 2` condition could be deleted and this test would stay green while the
  // rule it names went away. The sibling guards all carry that hole.
  const fake = join(ROOT, 'skills', 'fixture.md');
  assert.deepEqual(unbalancedFences([fake], () => '```bash\ncode\n'),
    ['skills/fixture.md (1)'], 'an unclosed fence must be reported');
  // Indented, and deliberately ODD. A balanced indented pair is a decorative
  // probe: a column-0-only matcher counts zero fences there, which is also even,
  // so the assertion passes under the very mutation it claims to catch
  // (measured). An unbalanced indented block is the case that discriminates —
  // these documents write fences inside numbered steps, and a column-0 matcher
  // leaves every one of them unchecked.
  assert.deepEqual(unbalancedFences([fake], () => '1. run it\n   ```bash\n   node x\n'),
    ['skills/fixture.md (1)'],
    'an INDENTED fence must be counted — a column-0-only matcher sees zero here, '
    + 'which is even, and reports nothing');
  assert.deepEqual(unbalancedFences([fake], () => 'an inline ``` marker in prose\n'), [],
    'a marker mid-line is not a fence — without the line anchor an inline code '
    + 'span flips the parity and every document below it reads as truncated');

  const unbalanced = unbalancedFences();
  assert.deepEqual(unbalanced, [],
    `unclosed code fence — a split or edit truncated a fenced block:\n  ${unbalanced.join('\n  ')}`);
});

test('the shipped-file index is what git tracks, not what this checkout holds', () => {
  // The index is the premise of deny-by-default, so its derivation is asserted
  // rather than assumed. Three properties, each of which a directory walk with a
  // skip list gets wrong on this repo:
  assert.ok(PLUGIN_FILES.size > 40, `index holds only ${PLUGIN_FILES.size} keys — git ls-files returned nothing usable`);
  // 1. a gitignored maintainer file must be absent even though it exists here.
  assert.equal(PLUGIN_FILES.has('docs/DOCS_RULE.md'), false,
    'a gitignored file is in the index — then the verdict differs between a '
    + 'maintainer checkout and CI, with CI on the lax side');
  // 2. …while its tracked sibling under the SAME directory must be present. No
  //    skip list can express this, which is the argument for asking git.
  assert.equal(PLUGIN_FILES.has('docs/monitor-decision.md'), true,
    'a tracked file under a partially-ignored directory must still be indexed');
  // 3. no key carries the host separator.
  assert.deepEqual([...PLUGIN_FILES].filter((k) => k.includes('\\')), [],
    'index keys must be canonicalised at construction');
});

test('the always-loaded agent guides are in the scan set', () => {
  // Root-level entries in ALWAYS_LOADED have no separator, so a Windows
  // emulation over them alone cannot fail — it would be a decorative
  // assertion. The derivation is pinned against a real nested document
  // instead, which is where the spelling actually diverges. `relative` is a
  // seam, not a switch: it defaults to the host's and turns nothing off.
  const scanKeys = (rel = relative) =>
    markdownFiles().map((f) => normalizePath(rel(ROOT, f)));
  const scanned = scanKeys();
  for (const doc of ALWAYS_LOADED) {
    assert.ok(existsSync(join(ROOT, doc)), `${doc} must exist to be scanned`);
    assert.ok(scanned.includes(doc), `${doc} must be in the shadow-guard scan set`);
  }
  const nested = scanned.find((k) => k.includes('/'));
  assert.ok(nested,
    'the scan set must hold a nested document, or the next assertion proves nothing');
  assert.ok(scanKeys(win32.relative).includes(nested),
    `the Windows spelling of ${nested} must be the same key as the host's — `
    + 'otherwise every membership check against a slash literal misses there');
});

test('no read or exec instruction can be shadowed from the target workspace', () => {
  const violations = [];
  for (const file of markdownFiles()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const v of shadowableTokens(line, file)) {
        violations.push(`${relative(ROOT, file)}:${i + 1}  [${v.form}] ${v.token} — ${v.why}`);
      }
    });
  }
  assert.deepEqual(violations, [],
    'plugin path read or executed outside the plugin root — anchor it at '
    + `<plugin-root> and keep it inside the root:\n  ${violations.join('\n  ')}`);
});

// One case per instruction form, so the coverage claim is itself tested. A form
// with no case here is a form the guard does not enforce. `safe` is null for
// js-module-load: that form has no safe textual spelling in this repo, and the
// dedicated test below pins that the anchored spelling is refused too.
const FORM_CASES = [
  ['interpreter-exec', 'node lib/harnessability/scorer.js --project-root .',
    'node "<plugin-root>/lib/harnessability/scorer.js" --project-root "<absolute-target-project-root>"'],
  ['read-verb', 'Read `skills/deep-harnessability/SKILL.md` and apply it',
    'Read `<plugin-root>/skills/deep-harnessability/SKILL.md` and apply it'],
  ['direct-exec', 'source scripts/check-version-sync.js',
    'source <plugin-root>/scripts/check-version-sync.js'],
  ['executable-token', 'the CLI lives at `scripts/dashboard-cli.js`',
    'the CLI lives at `<plugin-root>/scripts/dashboard-cli.js`'],
  ['bare-basename', 'Read(`SKILL.md`)',
    'Read(`<plugin-root>/skills/deep-harnessability/SKILL.md`)'],
  ['bare-exec-basename', 'Run `node dashboard-cli.js --project-root .`',
    'Run `node "<plugin-root>/scripts/dashboard-cli.js" --project-root .`'],
  ['dot-relative', 'Read `../deep-harness-dashboard/SKILL.md`',
    'Read `<plugin-root>/skills/deep-harness-dashboard/SKILL.md`'],
  ['js-module-load', 'const c = require("lib/suite-collector.js");', null],
];

test('every enumerated instruction form is enforced', () => {
  for (const [form, unsafe, safe] of FORM_CASES) {
    assert.ok(shadowableTokens(unsafe).length > 0, `${form}: guard must flag — ${unsafe}`);
    if (safe === null) continue;
    assert.deepEqual(shadowableTokens(safe), [], `${form}: guard must accept — ${safe}`);
  }
});

test('each FORM is the rule that catches its own shape', () => {
  // PER-AXIS ISOLATION. Every case above names a file the plugin really ships,
  // so deny-by-default catches it too and the FORMS contribute nothing to the
  // verdict — measured: deleting interpreter-exec, direct-exec or
  // executable-token outright fails no assertion in this file. That makes the
  // coverage claim above true of the guard as a whole and false of each rule.
  //
  // The FORMS earn their place on paths that do NOT resolve — a file that does
  // not exist yet, or a sibling's. Each case below names one, so deny-by-default
  // is structurally blind to it and exactly one rule can see it. The assertion is
  // on the SET of forms, not the count, because a non-empty result proves only
  // that something fired.
  for (const [line, forms] of [
    ['bash skills/zzz-missing.txt /abs/work', ['interpreter-exec']],
    ['source scripts/zzz-missing.txt', ['direct-exec']],
    ['Read `skills/zzz/missing.md` and follow it', ['read-verb']],
    ['the generator is at `lib/zzz/missing-generator.js`', ['executable-token']],
  ]) {
    assert.deepEqual(shadowableTokens(line).map((h) => h.form), forms,
      `exactly ${forms[0]} must catch this, alone: ${line}`);
  }
});

test('the scope exemptions are each pinned, and each still lets the guard see a real path', () => {
  // Three skips in `scopedTokens` decide what the whole invariant never looks
  // at, so each is asserted directly rather than left to whatever the corpus
  // happens to contain. Every one is unreachable in the shipped documents today
  // — measured: deleting any of them changes no corpus verdict — which is
  // exactly why they need their own pins.
  const tokens = (line) => [...scopedTokens(line)];

  // 1. Already inside an anchored path. The anchor is normally consumed as part
  //    of one token; this is the spelling where it is not, because the quote
  //    breaks the token and the tokeniser restarts at `scripts`.
  assert.deepEqual(tokens('node "<plugin-root>"/scripts/dashboard-cli.js'), [],
    'a path following a quoted anchor is anchored — the preceding-context check '
    + 'is the only thing that knows that');
  assert.deepEqual(tokens('node scripts/dashboard-cli.js'), ['scripts/dashboard-cli.js'],
    'and without the anchor the same path must still be seen');

  // 2. Markdown link destination — rendered navigation, not a file-tool
  //    instruction, and it must stay source-relative because markdown does not
  //    interpolate. The link-destination test above pins the other half.
  assert.deepEqual(tokens('see [the skill](skills/deep-harnessability/SKILL.md)'), [],
    'a markdown link destination is navigation, not a load instruction');
  assert.deepEqual(tokens('see `skills/deep-harnessability/SKILL.md`'),
    ['skills/deep-harnessability/SKILL.md'],
    'the same path outside a link target must still be seen');

  // 3. A foreign placeholder root, handed to the anchor-spelling rule.
  assert.deepEqual(tokens('reads `<wiki_root>/.wiki-meta/index.json`'), [],
    'an external vault root is not a plugin path — flagging it as unanchored '
    + 'would be a false positive on a correct reference');
  assert.deepEqual(tokens('reads `<plugin-root>/AGENTS.md`'), ['<plugin-root>/AGENTS.md'],
    'the anchor itself must still be yielded, or containment never runs on it');
});

test('a JS module load of a plugin path is refused in every spelling', () => {
  for (const line of [
    'const c = require("lib/suite-collector.js");',
    'const c = require("<plugin-root>/lib/suite-collector.js");',
    'const c = require("${CLAUDE_PLUGIN_ROOT}/lib/suite-collector.js");',
    'import c from `${CLAUDE_PLUGIN_ROOT}/lib/suite-collector.js`;',
  ]) {
    assert.ok(jsModuleLoadHits(line, join(ROOT, 'AGENTS.md')).length > 0,
      `must flag JS module load: ${line}`);
  }
  // Specifiers that name no plugin path. `fs` is the legacy builtin spelling
  // this repo's own §Verification block uses; a prefix list of `node:` alone
  // would flag it, which is why the precondition asks whether the specifier is
  // path-shaped at all.
  for (const line of [
    'const { readFileSync } = require("node:fs");',
    `node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8'))"`,
  ]) {
    assert.deepEqual(jsModuleLoadHits(line, join(ROOT, 'AGENTS.md')), [],
      `a specifier naming no plugin path must pass: ${line}`);
  }
});

test('anchored paths that escape the plugin root are rejected (containment)', () => {
  const traversals = [
    'Read `<plugin-root>/../workspace/evil.md`',
    'node "<plugin-root>/../workspace/evil.js"',
  ];
  for (const line of traversals) {
    const hits = shadowableTokens(line);
    assert.ok(hits.length > 0, `containment must reject: ${line}`);
    assert.equal(hits[0].why, 'escapes plugin root', `wrong reason for: ${line}`);
  }
  // A `..` that stays inside the root is fine.
  assert.deepEqual(
    shadowableTokens('Read `<plugin-root>/skills/deep-harnessability/../deep-harness-dashboard/SKILL.md`'), [],
    'in-root traversal must be accepted');
});

test('mixed lines fail on the bare token', () => {
  const line = 'Read `<plugin-root>/skills/deep-harnessability/SKILL.md` then Read `../deep-harness-dashboard/SKILL.md`';
  const hits = shadowableTokens(line);
  assert.equal(hits.length, 1, `exactly the bare token must be flagged, got ${JSON.stringify(hits)}`);
  assert.equal(hits[0].why, 'unanchored');
});

test('a malicious workspace cannot shadow any instruction the plugin issues', () => {
  // End-to-end statement of the invariant. Plant shadows in a fake target
  // workspace for every file the plugin ships, then confirm no instruction in
  // the repo would resolve to one of them. Because every instruction is
  // anchored, cwd is irrelevant — which is the property under test, not an
  // accident of this fixture.
  //
  // Derived, not enumerated, and repo-relative only. A hand-written plant list
  // covers the paths someone remembered; deriving from the index makes coverage
  // follow the tree. Bare basenames are deliberately NOT planted: a document
  // that merely mentions a shipped basename in prose would then register as a
  // landing. That shape is handled by detection instead (BARE_EXEC_BASENAME),
  // where an interpreter is what makes it an instruction.
  const evil = mkdtempSync(join(tmpdir(), 'dd-evil-workspace-'));
  try {
    // Excluding directory landings is safe only while no shipped directory is a
    // Node LOAD_AS_DIRECTORY target. A nested `index.js` or `package.json` would
    // make a planted DIRECTORY reachable again, and nothing else would notice,
    // because the `isFile()` filter below would keep skipping it. The repo root's
    // own `package.json` is excluded: no token in any document resolves to the
    // workspace root itself, so the root is not a reachable landing.
    assert.deepEqual(
      [...PLUGIN_FILES].filter((k) => k.includes('/') && /(?:^|\/)(index\.[cm]?js|package\.json)$/.test(k)).sort(),
      [],
      'a shipped directory just became loadable by name — the isFile() landing '
      + 'filter now hides a reachable shadow, and must be revisited');

    for (const rel of PLUGIN_FILES) {
      const dest = join(evil, rel);
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest)) writeFileSync(dest, '// SHADOW — must never be read\n');
    }

    const landed = [];
    for (const file of markdownFiles()) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const token of scopedTokens(line)) {
          const target = resolveAsAgentWould(token, evil);
          // A landing must be a FILE. Planting every shipped path creates the
          // directories above it, so `existsSync` alone reports a hit for any
          // prose that names a shipped directory — `lib/dashboard`, say — where
          // nothing shadowable was planted at all.
          if (target.startsWith(evil + sep) && existsSync(target) && statSync(target).isFile()) {
            landed.push(`${relative(ROOT, file)}:${i + 1}  ${token} → ${target}`);
          }
        }
      });
    }
    assert.deepEqual(landed, [],
      `these instructions resolve onto a planted shadow file:\n  ${landed.join('\n  ')}`);

    // Non-vacuity: the same resolution, given an unanchored token, does land on
    // the shadow — so an empty result above is a property of the documents, not
    // of a resolver that never finds anything.
    const control = resolveAsAgentWould('lib/suite-collector.js', evil);
    assert.ok(control.startsWith(evil + sep) && existsSync(control) && statSync(control).isFile(),
      'fixture is vacuous — an unanchored token must land on the planted shadow');
    // …and the anchored spelling of the same path must not, or "landed" would be
    // a property of the resolver rather than of the token.
    assert.equal(
      resolveAsAgentWould('<plugin-root>/lib/suite-collector.js', evil).startsWith(evil + sep),
      false, 'an anchored token must resolve into the plugin, never the workspace');
  } finally {
    rmSync(evil, { recursive: true, force: true });
  }
});

const UNEXPANDED_LINK = /\]\((<[A-Za-z0-9][A-Za-z0-9_-]*>[^)]*|\$\{?[A-Za-z_][^)]*)\)/g;

function unexpandedLinkDestinations(files = markdownFiles(), read = readFileSync) {
  const broken = [];
  for (const file of files) {
    read(file, 'utf8').split('\n').forEach((line, i) => {
      UNEXPANDED_LINK.lastIndex = 0;
      let m;
      while ((m = UNEXPANDED_LINK.exec(line))) {
        broken.push(`${relative(ROOT, file)}:${i + 1}  ](${m[1]})`);
      }
    });
  }
  return broken;
}

test('markdown link destinations are never the plugin-root placeholder', () => {
  // The mirror image of the anchor rule. Markdown does not interpolate, so an
  // anchored link destination is a literal broken URL. Link targets are an
  // exception class in `scopedTokens`; this asserts the exception is actually
  // earned in the documents.
  //
  // Driven over a synthetic document first. The corpus holds no such link today,
  // so the sweep cannot fail by itself and the whole pattern could be deleted
  // while this stayed green.
  const fake = join(ROOT, 'skills', 'fixture.md');
  const body = [
    'see [the guide](AGENTS.md) and [the CLI](../deep-harnessability/SKILL.md)', // correct
    'see [the guide](<plugin-root>/AGENTS.md)',                                  // placeholder
    'see [the CLI](${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-cli.js)',             // variable
    'the wrapper is <https://github.com/Sungmin-Cho/claude-deep-suite>',         // autolink
  ].join('\n');
  assert.deepEqual(
    unexpandedLinkDestinations([fake], () => body).map((o) => o.split(':')[1].split(' ')[0]),
    ['2', '3'],
    'exactly the two unexpandable destinations must be reported');

  const broken = unexpandedLinkDestinations();
  assert.deepEqual(broken, [],
    'markdown link destination uses a placeholder or variable that nothing expands '
    + `— use a source-relative path instead:\n  ${broken.join('\n  ')}`);
});

test('a path the plugin never ships carries the sentence that makes it safe', () => {
  // Self-consistency axis. The rule "a bare plugin path resolves against the
  // analysed project" is violated hardest by a path that can resolve NOWHERE
  // else, and deny-by-default structurally cannot see it: that rule only flags
  // what resolves inside the plugin. Writing a rule is not enforcing it, so the
  // exemption is asserted rather than assumed.
  const violations = [];
  for (const [token, clauses] of NON_SHIPPED) {
    assert.ok(!PLUGIN_FILES.has(token),
      `${token} is listed as non-shipped but is in the shipped file set`);
    for (const file of markdownFiles()) {
      const body = readFileSync(file, 'utf8');
      if (!body.includes(token)) continue;
      const flat = flatten(body);
      for (const clause of clauses) {
        if (!clause.test(flat)) {
          violations.push(`${relative(ROOT, file)} names ${token} but is missing: ${clause.source}`);
        }
      }
    }
  }
  assert.deepEqual(violations, [],
    `a non-shipped path is named without every clause that makes it safe to read:\n  ${violations.join('\n  ')}`);
});

// Derived from `.gitignore`, not hand-listed. A hand-listed pair matched the
// ignore file exactly on the day it was written and would have leaked silently
// the first time a third entry was added.
//
// Three directory spellings, not one. The sibling guards accept only a trailing
// `/`, and this repo writes `docs/*` — precisely so that `!docs/monitor-decision.md`
// can re-include a child — so a `/`-only derivation drops `docs` from the swept
// set and the rule goes silent on the exact class it exists for. `foo/`, `foo/*`
// and `foo/**` are the complete set of directory-scoped gitignore spellings, so
// accepting all three is closing the shape rather than extending a list.
const DIR_PATTERN = /^(.*?)\/(?:\*{1,2})?$/;
const IGNORED_DIRS = (() => {
  const body = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  return body.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map((line) => DIR_PATTERN.exec(line))
    .filter((m) => m && m[1])
    .map((m) => m[1]);
})();

// Not every gitignored directory is a leak when a document names it. The rule's
// premise is "this can only ever resolve against the analysed project, so naming
// it hands the instruction there" — and for a plugin's declared output root,
// resolving against the analysed project is the CONTRACT.
//
// Three arms, each with a stated authority, and no list of variable names.
//
// (1) ASK THE CODE — a directory this plugin WRITES into a project is its own
//     output root. Writing is the discriminator, not joining: a sibling's probe
//     matched any `path.join` and classified `docs/` as an output root, silencing
//     the rule for the exact class it exists for.
// (2) ASK THE CONVENTION — `.deep-*` is the suite's name for a plugin output
//     root. This deliberately covers a SIBLING's root: this plugin never writes
//     `.deep-work/`, but it is told to READ one there, and flagging that would be
//     an over-flag.
// (3) ASK THE HOST — a tool's per-project directory. `.claude` is Claude Code's,
//     `.vscode`, `.idea` and `.cursor` are the editors'. None belongs to any
//     plugin, all live in the analysed project, and a document may correctly name
//     one. This arm IS a small enumeration and saying so is the point: its growth
//     condition is known — a new host or editor project directory — and the
//     alternative, treating anything unproven as a workspace output, is fail-open.
//     `.cursor` is gitignored here and absent from the siblings' lists.
//
// `node_modules` is neither: not a leak, not an output root, just noise.
const HOST_PROJECT_DIRS = new Set(['.claude', '.vscode', '.idea', '.cursor']);

function pluginWrittenDirs(dirs, files = PLUGIN_FILES) {
  const WRITE = /(mkdirSync|writeFileSync|appendFileSync|createWriteStream|rmSync|cpSync|renameSync)/;
  const found = new Set();
  for (const key of files) {
    if (!/\.[cm]?js$/.test(key) || /\.test\.[cm]?js$/.test(key)) continue;
    const body = readFileSync(join(ROOT, key), 'utf8');
    for (const d of dirs) {
      if (found.has(d)) continue;
      const re = new RegExp(`['"\`]${escapeRe(d)}['"\`]`, 'g');
      let m;
      while ((m = re.exec(body))) {
        if (WRITE.test(body.slice(Math.max(0, m.index - 260), m.index + 260))) { found.add(d); break; }
      }
    }
  }
  return found;
}

const WORKSPACE_OUTPUT_DIRS = new Set([
  ...pluginWrittenDirs(IGNORED_DIRS),
  ...IGNORED_DIRS.filter((d) => d.startsWith('.deep-')),
  ...IGNORED_DIRS.filter((d) => HOST_PROJECT_DIRS.has(d)),
]);
const MAINTAINER_ONLY_DIRS = IGNORED_DIRS
  .filter((d) => !WORKSPACE_OUTPUT_DIRS.has(d) && d !== 'node_modules');

test('the non-shipped directory list is derived from .gitignore, not guessed', () => {
  // Non-vacuity for the sweep below: it is only meaningful if this derivation
  // actually found the directories that motivate it. Asserted against the RAW
  // derivation — the workspace-output split runs after it and has its own test.
  assert.ok(IGNORED_DIRS.length > 0, '.gitignore yielded no ignored directories');
  for (const dir of ['docs', '.deep-dashboard']) {
    assert.ok(IGNORED_DIRS.includes(dir),
      `${dir} must be found by the derivation — it is where the blind spot was found`);
  }
  // The spelling axis, pinned directly rather than left to whatever `.gitignore`
  // happens to contain. `docs/*` is the row this repo actually writes, and a
  // `/`-only derivation — which is what both source guards ship — drops it.
  for (const spelling of ['docs/', 'docs/*', 'docs/**']) {
    const m = DIR_PATTERN.exec(spelling);
    assert.equal(m && m[1], 'docs', `directory spelling must be recognised: ${spelling}`);
  }
  for (const notADir of ['.env.*', '*.log', 'npm-debug.log*', 'tsconfig.tsbuildinfo']) {
    assert.equal(DIR_PATTERN.exec(notADir), null, `a file pattern must not be read as a directory: ${notADir}`);
  }
});

test('the workspace-output split is derived from the convention, and is two-way', () => {
  // The split is the one place this rule can be turned off, so it is asserted in
  // both directions rather than only where it happens to matter today.
  assert.ok(WORKSPACE_OUTPUT_DIRS.has('.deep-dashboard'),
    "this plugin's own output root must be classed as a workspace output");
  assert.ok(WORKSPACE_OUTPUT_DIRS.has('.deep-work'),
    'a sibling output root must be too — naming it in the analysed project is correct');
  assert.ok(WORKSPACE_OUTPUT_DIRS.has('.cursor'),
    'a host/editor per-project directory must be, or naming it reads as a leak');
  // Arm 1 must actually fire. If the write probe finds nothing, the whole arm is
  // decorative and only the `.deep-*` convention is doing the work.
  assert.ok(pluginWrittenDirs(IGNORED_DIRS).has('.deep-dashboard'),
    'the write probe found no output root — arm 1 is not contributing anything');
  assert.ok(MAINTAINER_ONLY_DIRS.includes('docs'),
    'docs must stay maintainer-only — it is the class this rule exists for');
  assert.ok(!WORKSPACE_OUTPUT_DIRS.has('docs'),
    'docs is read, never written — a probe that classes it as an output root has silenced the rule');
  for (const dir of MAINTAINER_ONLY_DIRS) {
    assert.ok(!dir.startsWith('.deep-'), `${dir} looks like an output root but is swept`);
  }
  assert.ok(MAINTAINER_ONLY_DIRS.length > 0, 'the split must not empty the rule — that silences it');
  assert.ok(MAINTAINER_ONLY_DIRS.length < IGNORED_DIRS.length,
    'nothing was split off — then the rule is unchanged, which is not what its comment claims');
});

// Either separator. This check is lexical over raw lines on purpose — that is
// what makes it immune to any index blind spot — and for the same reason
// normalizePath never reaches it, so `\` has to be spelled out here.
//
// Negative lookbehind, not a positive prefix list. Enumerating the characters
// that may precede a path means every character nobody thought of is a bypass:
// `**docs/X.md**` and `[docs/Y.md](…)` — bold text and link text, both ordinary
// markdown — slip past a list of space/backtick/quote/paren.
const MAINTAINER_PATH = new RegExp(
  String.raw`(?<![A-Za-z0-9._\\/-])((?:${MAINTAINER_ONLY_DIRS.map(escapeRe).join('|')})[\\/][A-Za-z0-9._\\/-]+)`, 'g');

function undeclaredMaintainerPaths(files = markdownFiles(), read = readFileSync) {
  const violations = [];
  for (const file of files) {
    read(file, 'utf8').split('\n').forEach((line, i) => {
      MAINTAINER_PATH.lastIndex = 0;
      let m;
      while ((m = MAINTAINER_PATH.exec(line))) {
        const token = normalizePath(m[1]);
        if (NON_SHIPPED.has(token)) continue;      // earned by the caveat test above
        // A tracked path under a partially-ignored directory DOES ship, so it is
        // not this rule's class at all — deny-by-default governs it like any
        // other plugin path. `docs/monitor-decision.md` is the live case, and it
        // exists only because this repo writes `docs/*` with a `!` re-include.
        if (PLUGIN_FILES.has(token)) continue;
        violations.push(`${relative(ROOT, file)}:${i + 1}  ${m[1]}`);
      }
    });
  }
  return violations;
}

test('no undeclared path under a maintainer-only directory is named', () => {
  // The generalisation of the caveat rule. Anything under a gitignored directory
  // is unresolvable in an installed plugin and therefore resolves only against
  // the workspace. Each one must be declared in NON_SHIPPED, which forces the
  // caveat test to cover it.
  //
  // The matcher, on the axis rather than on whatever the corpus holds today.
  for (const probe of ['See `docs/backlog.md` for the rest.', 'See `docs\\backlog.md` too.',
    '**docs/bold.md** matters', '[docs/link.md](x) matters']) {
    MAINTAINER_PATH.lastIndex = 0;
    assert.ok(MAINTAINER_PATH.exec(probe), `the sweep must see: ${probe}`);
  }
  MAINTAINER_PATH.lastIndex = 0;
  assert.equal(MAINTAINER_PATH.exec('nodocs/notapath.md is mid-token'), null,
    'a match must not start mid-token');
  // `.deep-docs/last-scan.json` must not be read as a `docs/` path: the `-`
  // before `docs` is in the lookbehind class, which is what stops it.
  MAINTAINER_PATH.lastIndex = 0;
  assert.equal(MAINTAINER_PATH.exec('reads `.deep-docs/last-scan.json` from the project'), null,
    'a sibling output root must not be mistaken for a maintainer-only directory');

  // …and the two exemptions, through the production function. The tracked-path
  // exemption has no live site in the corpus, so without this probe it could be
  // widened to "exempt everything" and nothing would notice.
  const fake = join(ROOT, 'skills', 'fixture.md');
  const body = [
    'doc rules in `docs/DOCS_RULE.md`',            // declared → earned by the caveat test
    'the ADR is `docs/monitor-decision.md`',        // tracked → ships → not this rule's class
    'see `docs/UNDECLARED.md` for the rest',        // neither → a leak
  ].join('\n');
  assert.deepEqual(
    undeclaredMaintainerPaths([fake], () => body).map((v) => v.split('  ')[1]),
    ['docs/UNDECLARED.md'],
    'exactly the undeclared, unshipped path must be reported');

  const violations = undeclaredMaintainerPaths();
  assert.deepEqual(violations, [],
    'a path under a gitignored, never-shipped directory can only resolve against '
    + `the analysed project — declare it in NON_SHIPPED or drop it:\n  ${violations.join('\n  ')}`);
});

test('a backslash separator does not hide a path from the guard', () => {
  // Windows is a supported host, so a backslash path is a legitimate spelling and
  // not a typo — and one character must not bypass the deny-by-default invariant.
  //
  // Mixed separators matter as much as pure backslash: a rule that learned to
  // recognise "a backslash path" as a second shape would still miss
  // `lib\dashboard/collector.js`. That is why the fix normalises at tokenisation
  // instead of teaching each matcher a new form.
  const TABLE = [
    ['unanchored slash', 'Run `node scripts/dashboard-cli.js` to start.'],
    ['unanchored backslash', 'Run `node scripts\\dashboard-cli.js` to start.'],
    ['read-verb slash', 'Read `lib/dashboard/collector.js`'],
    ['read-verb backslash', 'Read `lib\\dashboard\\collector.js`'],
    ['mixed separators', 'Run `node lib\\dashboard/collector.js` to start.'],
    ['read-verb mixed', 'Read `skills/deep-harnessability\\SKILL.md` first.'],
    // The rows below carry no read verb and no runnable extension, so the
    // executable-token FORM cannot cover for the tokeniser. They are the only
    // rows that actually exercise the `+` on PATH_TOKEN's separator class.
    ['run, .md, no verb', 'The skill lives at skills//deep-harnessability//SKILL.md today.'],
    ['backslash run, .md, no verb', 'The skill lives at skills\\\\deep-harnessability\\\\SKILL.md today.'],
    ['mixed run, .md, no verb', 'The skill lives at skills\\/deep-harnessability/\\SKILL.md today.'],
  ];
  for (const [label, line] of TABLE) {
    assert.ok(shadowableTokens(line).length > 0, `${label} must be flagged: ${line}`);
  }

  // An anchored traversal written with backslashes is still a traversal, and must
  // be rejected for that reason rather than as "unanchored".
  const traversal = shadowableTokens('node "<plugin-root>\\..\\workspace\\evil.json"');
  assert.ok(traversal.length > 0, 'anchored backslash traversal must be flagged');
  assert.equal(traversal[0].why, 'escapes plugin root',
    `traversal must fail on containment, not anchoring: ${JSON.stringify(traversal)}`);

  // Escape parity: a doubled backslash is how the same path appears inside a
  // string literal, and separator runs collapse, so it resolves identically.
  assert.ok(shadowableTokens('const p = "lib\\\\dashboard\\\\collector.js";').length > 0,
    'an escaped backslash path must be flagged too');

  // PER-AXIS ISOLATION. The rows above are caught by several rules at once, so
  // they prove the bug is closed without proving which piece closed it.

  // PATH_TOKEN's separator run, isolated: no read verb, so no FORM matches, and
  // a `.md` extension the executable-token FORM cannot see. If the token is not
  // extracted whole, nothing sees it at all.
  assert.ok(
    shadowableTokens('정본은 `skills\\deep-harnessability\\SKILL.md` 이다.').length > 0,
    'deny-by-default must extract a backslash path whole, not just its basename');

  // And the mirror: a case only a FORM can see. Deny-by-default asks whether a
  // token resolves inside the plugin, so a path to a file that does not exist is
  // invisible to it — that is the gap FORMS still cover. This one needs the
  // separator inside the path *body*, not just after the root.
  assert.ok(shadowableTokens('Read `skills\\zzz\\missing.md` before starting.').length > 0,
    'a FORM must match a backslash path body, even when nothing resolves');

  assert.deepEqual(
    shadowableTokens('Read `<plugin-root>\\skills\\deep-harnessability\\SKILL.md`'), [],
    'an anchored backslash path must be accepted, not flagged as unanchored');
});

test('normalising separators does not promote prose into a path', () => {
  // Collapsing separator runs makes over-flagging the failure mode to watch, so
  // the text that must stay silent is pinned. But "produces no violation" has two
  // mechanisms behind it, and asserting only the outcome hides which one is
  // load-bearing.

  // A. The tokeniser must not see a path here at all.
  for (const line of [
    'escape a quote with \\" and a backslash with \\\\',
    'Use `\\n` for a newline and `\\t` for a tab.',
    'A literal backslash is written `\\\\` in a JS string literal.',
    'The validator matches /^[A-Za-z]+\\/[a-z-]+$/ against each entry.',
  ]) {
    assert.deepEqual([...scopedTokens(line)], [], `no path token may be extracted from: ${line}`);
    assert.deepEqual(shadowableTokens(line), [], `must not be flagged: ${line}`);
  }

  // B. Here the tokeniser DOES extract something — a Windows path quoted inside
  //    user input is genuinely path-shaped — and it stays silent only because it
  //    resolves to no plugin file. That is a claim about the rule, so it gets a
  //    non-vacuity check: declare those exact tokens plugin files and the line
  //    must be flagged. Nothing is stubbed; only the file set the rule consults
  //    is changed, so what runs is the real classifier.
  for (const [line, expected] of [
    ['Windows paths in user input (`C:\\Users\\me\\project`) are normalised before use.',
      ['Users/me/project']],
    ['const p = "C:\\\\Users\\\\me\\\\notes.md";', ['Users/me/notes.md']],
  ]) {
    assert.deepEqual([...scopedTokens(line)], expected,
      `separator runs must collapse to one canonical token: ${line}`);
    assert.deepEqual(shadowableTokens(line), [], `must not be flagged: ${line}`);

    for (const t of expected) PLUGIN_FILES.add(t);
    try {
      assert.ok(shadowableTokens(line).length > 0,
        'vacuous negative — this line stays silent even when its tokens name real '
        + `plugin files, so asserting its silence proves nothing: ${line}`);
    } finally {
      for (const t of expected) PLUGIN_FILES.delete(t);
    }
  }
});

// The anchor cannot be spelled as something a runtime expands.
//
// Closed by a structural question rather than a list of variable names, which is
// what the sibling guards use: `${CLAUDE_PLUGIN_ROOT}`, `<PLUGIN_ROOT>`,
// `$CLAUDE_PLUGIN_ROOT`. A list of spellings misses the next one, and this repo
// already carries a spelling none of those lists holds. So the question is: does
// any path in this document take its root from something a shell or JS would
// have to expand? That catches `$CLAUDE_PLUGIN_ROOT/…`, `${ANY_OTHER_ROOT}/…`
// and every future variable without naming any of them.
//
// The trailing separator is what makes it a ROOT rather than a mention.
// `DEEP_WIKI_ROOT` at skills/deep-harness-dashboard/SKILL.md names a
// configuration environment variable for an external Obsidian vault — it is not
// a plugin-root spelling, it carries no `$`, and no path hangs off it. Naming a
// configuration variable is information; rooting a path at one is the defect.
function variableRootOffenders(files = markdownFiles(), read = readFileSync) {
  const offenders = [];
  for (const file of files) {
    read(file, 'utf8').split('\n').forEach((line, i) => {
      if (VARIABLE_ROOT.test(line)) {
        offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
      }
    });
  }
  return offenders;
}

test('the anchor cannot be spelled as a shell variable anywhere', () => {
  // Verb-agnostic by construction. A `non-expanding-anchor` check hung off a list
  // of commands misses `cp`, `mv`, `install` and any wrapper — enumeration
  // creeping back in on a second axis. This plugin bans the expanded spelling
  // outright in every scanned file, because Codex sets no `CLAUDE_*` variable —
  // the skills say so in the same paragraph that then uses one — and the
  // placeholder is substituted by the agent rather than by a shell, so quoting
  // cannot change the outcome either way.
  assert.ok(VARIABLE_ROOT.test("cp '${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-cli.js' /tmp/x"),
    'the expanded-root rule must reject the shell spelling regardless of the command');
  assert.ok(VARIABLE_ROOT.test('node "$CLAUDE_PLUGIN_ROOT/scripts/dashboard-cli.js"'),
    'the bare `$VAR` spelling counts as much as the braced one');
  assert.ok(VARIABLE_ROOT.test('realpath($SOME_FUTURE_ROOT/skills/x/SKILL.md)'),
    'a variable nobody listed must count too — that is the point of asking structurally');
  // Negatives: the shapes this repo legitimately writes must stay clean, or the
  // rule would ban the target-root argument and the wiki configuration variable.
  for (const clean of [
    'node "<plugin-root>/scripts/dashboard-cli.js" --project-root "$PWD"',
    'Honors `options.wikiRoot` or `DEEP_WIKI_ROOT` for external wiki vaults.',
    'PowerShell: --project-root (Get-Location).Path',
  ]) {
    assert.ok(!VARIABLE_ROOT.test(clean), `must stay clean: ${clean}`);
  }
  // And deny-by-default is verb-agnostic too: no command appears in this line.
  assert.ok(shadowableTokens('scripts/dashboard-cli.js 를 참조한다').length > 0,
    'deny-by-default must flag a bare plugin path with no command verb present');
});

test('no path in a shipped document is rooted at a shell variable', () => {
  // Driven over a synthetic document first, through the same function the corpus
  // goes through. Without that, a corpus that happens to be clean would let the
  // whole condition be deleted while this test stayed green.
  const fake = join(ROOT, 'skills', 'fixture.md');
  const bodies = new Map([[fake, [
    'node "<plugin-root>/scripts/dashboard-cli.js" --project-root "$PWD"',  // correct
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/dashboard-cli.js"',                // expanded
    'realpath($CLAUDE_PLUGIN_ROOT/skills/x/SKILL.md)',                      // expanded
    'Honors `DEEP_WIKI_ROOT` for external wiki vaults.',                    // not a path root
  ].join('\n')]]);
  const found = variableRootOffenders([fake], (f) => bodies.get(f));
  assert.deepEqual(found.map((o) => o.split(':')[1].split(' ')[0]), ['2', '3'],
    `exactly the two expanded roots must be reported, got ${JSON.stringify(found)}`);

  const offenders = variableRootOffenders();
  assert.deepEqual(offenders, [],
    'a path is rooted at something a shell would have to expand — Codex defines no '
    + `such variable, so it stays literal and resolves against the analysed project. `
    + `This plugin anchors on the derived ${ANCHOR} placeholder only:\n  ${offenders.join('\n  ')}`);
});

// The placeholder axis of the same rule.
//
// A second spelling of the plugin root cannot be caught by listing spellings —
// that is how `<absolute-plugin-root>` arrived here from a sibling in the first
// place. The structural question is: for each angle-bracket placeholder used as a
// path ROOT, does the path UNDER it resolve to a file this plugin ships? If it
// does, the placeholder is standing in for the plugin root, whatever it is
// called. If it does not, it is some other root — `<wiki_root>/log.jsonl` is an
// external Obsidian vault, `<producer>/<artifact_kind>` is a registry key — and
// none of this rule's business.
const PLACEHOLDER_ROOT = /(?<![A-Za-z0-9._\\/-])<([A-Za-z0-9][A-Za-z0-9_-]*)>[\\/]([A-Za-z0-9._\\/-]*[A-Za-z0-9])/g;

function pluginRootSpellings(files = markdownFiles(), read = readFileSync) {
  const found = new Map();
  for (const file of files) {
    read(file, 'utf8').split('\n').forEach((line, i) => {
      PLACEHOLDER_ROOT.lastIndex = 0;
      let m;
      while ((m = PLACEHOLDER_ROOT.exec(line))) {
        if (!resolvesInPlugin(normalizePath(m[2]), file)) continue;
        if (!found.has(m[1])) found.set(m[1], []);
        found.get(m[1]).push(`${relative(ROOT, file)}:${i + 1}  <${m[1]}>/${m[2]}`);
      }
    });
  }
  return found;
}

test('the plugin uses exactly one anchor spelling', () => {
  // Non-vacuity first: the rule must be able to separate a second spelling of the
  // plugin root from a genuinely different root, and both shapes are present in
  // the corpus, so a rule that simply reported every placeholder would look
  // identical on the failure count while being wrong about `<wiki_root>`.
  // A REAL source path, with an injected body. The source-relative branch of
  // `resolvesInPlugin` is what makes the `skills/<name>/SKILL.md` row below
  // discriminate, and from a made-up `skills/fixture.md` that branch resolves
  // nothing — which would leave the mid-path lookbehind unpinned (measured: with
  // a synthetic source path, deleting the lookbehind fails nothing).
  const src = join(ROOT, 'skills', 'deep-harnessability', 'SKILL.md');
  const bodies = new Map([[src, [
    'node "<plugin-root>/scripts/dashboard-cli.js"',            // the anchor
    'node "<absolute-plugin-root>/scripts/dashboard-cli.js"',   // a second spelling
    '`<wiki_root>/log.jsonl`',                                  // an external root
    "`PAYLOAD_SCHEMA_MAJOR['<producer>/<artifact_kind>']`",     // a registry key
    '`.deep-work/<session>/handoff.json`',                      // a mid-path segment
    'each skill lives at `skills/<name>/SKILL.md`',             // a mid-path segment
                                                                // whose tail DOES resolve —
                                                                // the row the lookbehind exists for
  ].join('\n')]]);
  const probe = pluginRootSpellings([src], (f) => bodies.get(f));
  assert.deepEqual([...probe.keys()].sort(), ['absolute-plugin-root', 'plugin-root'],
    `the rule must see both plugin-root spellings and neither other root, got ${JSON.stringify([...probe.keys()])}`);

  const spellings = pluginRootSpellings();
  const extra = [...spellings.entries()].filter(([name]) => name !== ANCHOR_NAME);
  assert.deepEqual(extra.flatMap(([, sites]) => sites), [],
    `second spelling of the plugin root — this plugin anchors on ${ANCHOR} only:\n  `
    + extra.flatMap(([, sites]) => sites).join('\n  '));
  assert.ok(spellings.has(ANCHOR_NAME),
    `the anchor ${ANCHOR} is used nowhere — then this test proves nothing and the `
    + 'documents have no anchor at all');
});

// SCAN-SET COVERAGE.
//
// The scan set is the sibling contract — `skills/` plus the always-loaded
// guides — because a CHANGELOG is release history and a README is user-facing,
// and neither is an instruction surface. That is a claim about what those
// documents CONTAIN, not a permanent exemption by location, and nothing checked
// it: a shipped document outside the scan set could start rooting paths at the
// plugin and the classifier would be structurally blind to it.
//
// This is the tripwire for that. It applies the two anchor rules — and only
// those, not the whole classifier — to every tracked `.md` the scan set does not
// cover. A hit does not mean the document is wrong; it means the document has
// started to look like an instruction surface, and the choice between scanning
// it and rewriting the path is a deliberate one rather than an oversight.
function unscannedMarkdown() {
  const scanned = new Set(markdownFiles().map((f) => normalizePath(relative(ROOT, f))));
  return [...PLUGIN_FILES]
    .filter((k) => k.endsWith('.md') && !scanned.has(k))
    .sort()
    .map((k) => join(ROOT, k));
}

function unscannedAnchorSites(files = unscannedMarkdown(), read = readFileSync) {
  const out = [];
  for (const file of files) {
    read(file, 'utf8').split('\n').forEach((line, i) => {
      const at = `${normalizePath(relative(ROOT, file))}:${i + 1}  ${line.trim()}`;
      if (VARIABLE_ROOT.test(line)) { out.push(at); return; }
      PLACEHOLDER_ROOT.lastIndex = 0;
      let m;
      while ((m = PLACEHOLDER_ROOT.exec(line))) {
        if (resolvesInPlugin(normalizePath(m[2]), file)) { out.push(at); return; }
      }
    });
  }
  return out;
}

test('a shipped document outside the scan set carries no plugin-rooted path', () => {
  // Non-vacuity: the classifier's scan set must actually leave something out, or
  // this test is about an empty collection and proves nothing.
  assert.ok(unscannedMarkdown().length > 0,
    'every tracked markdown file is scanned — then this tripwire is vacuous');

  // And the two rules it applies, driven over a synthetic document. Row 3 is the
  // shape a CHANGELOG legitimately writes and must stay clean; row 4 is the
  // shape a README legitimately writes.
  const fake = join(ROOT, 'skills', 'deep-harnessability', 'SKILL.md');
  const body = [
    'the ADR sketches `node ${CLAUDE_PLUGIN_DIR}/scripts/x.js`',   // variable root
    'moved to `<absolute-plugin-root>/lib/suite-collector.js`',    // foreign plugin-root spelling
    'moved Codex surfaces to `skills/<skill>/SKILL.md` dirs',      // mid-path segment — clean
    'honours `DEEP_WIKI_ROOT` for external vaults',                // named, not rooted — clean
  ].join('\n');
  assert.deepEqual(
    unscannedAnchorSites([fake], () => body).map((o) => o.split(':')[1].split(' ')[0]),
    ['1', '2'],
    'exactly the two plugin-rooted lines must be reported');

  const sites = unscannedAnchorSites();
  assert.deepEqual(sites, [],
    'a shipped document the guard does not scan roots a path at the plugin. Either it '
    + 'is an instruction surface and belongs in the scan set, or the path should not be '
    + `written that way:\n  ${sites.join('\n  ')}`);
});

test('an anchored path that leaves the root through a symlink is rejected', (t) => {
  // `escapes via symlink` is produced on two code paths and, without this test,
  // asserted on neither: containment only ever exercises the lexical `..` form.
  // `resolve` is lexical, so an anchored, `..`-free path whose component is a
  // symlink passes every other check and still lands outside the plugin.
  //
  // The capability is probed with this repo's own helper rather than inferred
  // from process.platform: unprivileged Windows throws EPERM, and a security test
  // that turns the suite red for a reason unrelated to the invariant is the same
  // failure mode as one that never runs.
  const { skip } = probeSymlinkCapability();
  if (skip) {
    t.skip(skip);
    return;
  }
  const outside = mkdtempSync(join(tmpdir(), 'dd-symlink-outside-'));
  const fakeRoot = mkdtempSync(join(tmpdir(), 'dd-symlink-root-'));
  try {
    writeFileSync(join(outside, 'evil.md'), '# SHADOW — outside the plugin root\n');
    mkdirSync(join(fakeRoot, 'skills'), { recursive: true });
    symlinkSync(join(outside, 'evil.md'), join(fakeRoot, 'skills', 'evil.md'), 'file');
    writeFileSync(join(fakeRoot, 'skills', 'ok.md'), '# in-root\n');
    const token = '<plugin-root>/skills/evil.md';

    // Non-vacuity: the token is anchored and lexically contained, so every other
    // clause accepts it. Only the symlink check can reject it.
    assert.ok(ANCHORED_TOKEN.test(token), 'fixture token must be anchored');
    assert.equal(escapesRoot(token), false, 'fixture token must be lexically contained');

    // Both production sites: the FORMS path and the deny-by-default path.
    const viaForm = shadowableTokens(`Read \`${token}\``, undefined, fakeRoot);
    assert.ok(viaForm.some((v) => v.why === 'escapes via symlink'),
      `read-verb path must reject the symlink: ${JSON.stringify(viaForm)}`);
    const viaDeny = denyByDefaultHits(`증명은 \`${token}\` 를 따른다`, join(ROOT, 'AGENTS.md'), fakeRoot);
    assert.ok(viaDeny.some((v) => v.why === 'escapes via symlink'),
      `deny-by-default path must reject the symlink: ${JSON.stringify(viaDeny)}`);

    // A real in-root target of the same shape is still accepted, so the rule is
    // about where the link points and not about the directory it sits in.
    assert.deepEqual(
      shadowableTokens('Read `<plugin-root>/skills/ok.md`', undefined, fakeRoot), [],
      'a real in-root file must still be accepted');
  } finally {
    rmSync(fakeRoot, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

// Either separator in every pattern. This resolver reads the raw body on
// purpose, so normalizePath never reaches it and each pattern has to accept `\`
// itself. Slash-only leaves the backslash spelling of an out-of-root reference
// visible to the classifier but INVISIBLE here — the layer that actually checks
// containment.
const REFERENCE_PATTERNS = [
  // Trailing boundary, same reason as the guard: without it `.js` matches the
  // prefix of `.json` and the resolver reports files that never existed.
  [new RegExp(String.raw`${ANCHOR}[\\/]([A-Za-z0-9._\\/-]+\.(?:md|js|sh|json|yaml)(?![A-Za-z0-9]))`, 'g'), false],
  [/`(\.\.[\\/][A-Za-z0-9._\\/-]+\.md)(?:#[a-z0-9-]+)?`/g, true],
  [/\]\((\.\.?[\\/][A-Za-z0-9._\\/-]+\.md)\)/g, true],
];

// `root` is a parameter so the containment branch can be driven against a
// throwaway root. Nothing in the shipped corpus resolves out of root — the
// branch is unreachable over the real tree, which is exactly the condition under
// which a containment check quietly stops working.
function brokenReferences(files = markdownFiles(), read = readFileSync, root = ROOT) {
  const broken = [];
  let resolved = 0;
  const realRoot = realpathSync(root);
  for (const file of files) {
    const body = read(file, 'utf8');
    for (const [re, isRelative] of REFERENCE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(body))) {
        const target = isRelative
          ? resolve(dirname(file), normalizePath(m[1]))
          : join(root, normalizePath(m[1]));
        if (!existsSync(target)) {
          broken.push(`${relative(root, file)} -> ${m[1]} (missing)`);
          continue;
        }
        // Existing is not enough: a target that resolves outside the plugin root
        // — lexically or through a symlinked component — is exactly the file an
        // attacker wants accepted. Containment is checked here too, so this test
        // and the classifier cannot disagree about what counts as in-root.
        const real = realpathSync(target);
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
          broken.push(`${relative(root, file)} -> ${m[1]} (resolves outside the plugin root: ${real})`);
          continue;
        }
        resolved += 1;
      }
    }
  }
  return { broken, resolved };
}

test('every referenced plugin path resolves inside the root', (t) => {
  // One sample per pattern, in both spellings, so a revert fails on the axis
  // rather than on whatever file happens to be in the tree.
  const samples = [
    ['<plugin-root>/../workspace/evil.json', '<plugin-root>\\..\\workspace\\evil.json'],
    ['`../shared/x.md`', '`..\\shared\\x.md`'],
    ['[l](../shared/x.md)', '[l](..\\shared\\x.md)'],
  ];
  REFERENCE_PATTERNS.forEach(([re], i) => {
    for (const spelling of samples[i]) {
      re.lastIndex = 0;
      assert.ok(re.exec(spelling), `pattern ${i} must see both spellings: ${spelling}`);
    }
  });

  // The `missing` branch, driven — no shipped reference is broken today.
  const fakeFile = join(ROOT, 'skills', 'fixture.md');
  assert.deepEqual(
    brokenReferences([fakeFile], () => 'Read `<plugin-root>/lib/zzz-missing.js`').broken,
    ['skills/fixture.md -> lib/zzz-missing.js (missing)'],
    'a reference to a file that does not exist must be reported');

  // The CONTAINMENT branch, driven against a throwaway root. Nothing in the
  // corpus resolves out of root, so without this the whole `realpath` comparison
  // could be deleted and every test would stay green — measured.
  const { skip } = probeSymlinkCapability();
  if (skip) {
    t.diagnostic(`containment branch not driven: ${skip}`);
  } else {
    const outside = mkdtempSync(join(tmpdir(), 'dd-ref-outside-'));
    const fakeRoot = mkdtempSync(join(tmpdir(), 'dd-ref-root-'));
    try {
      writeFileSync(join(outside, 'evil.md'), '# SHADOW\n');
      mkdirSync(join(fakeRoot, 'lib'), { recursive: true });
      symlinkSync(join(outside, 'evil.md'), join(fakeRoot, 'lib', 'evil.md'), 'file');
      writeFileSync(join(fakeRoot, 'lib', 'ok.md'), '# in-root\n');
      const src = join(fakeRoot, 'doc.md');
      const escaped = brokenReferences([src], () => 'Read `<plugin-root>/lib/evil.md`', fakeRoot);
      assert.equal(escaped.broken.length, 1, JSON.stringify(escaped));
      assert.match(escaped.broken[0], /resolves outside the plugin root/,
        'an existing target reached through a symlink out of the root must be rejected '
        + 'for containment, not counted as resolved');
      assert.equal(escaped.resolved, 0, 'and it must not be counted as resolved');
      // The in-root twin, so the rule is about where the link points rather than
      // about the directory it sits in.
      const inRoot = brokenReferences([src], () => 'Read `<plugin-root>/lib/ok.md`', fakeRoot);
      assert.deepEqual(inRoot.broken, [], 'a real in-root target must still be accepted');
      assert.equal(inRoot.resolved, 1);
    } finally {
      rmSync(fakeRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  }

  const { broken, resolved } = brokenReferences();
  assert.deepEqual(broken, [], `unresolvable or out-of-root reference:\n  ${broken.join('\n  ')}`);
  assert.ok(resolved > 0, 'sweep matched no references at all — the patterns have rotted');
});

test('normalisation is applied to both sides of every comparison (Windows emulation)', () => {
  // On Windows the key builder returns backslash-joined keys. Patching only the
  // key side reproduces that. A guard that normalises the lookup but not the key
  // compares two different spellings and every `has()` misses — deny-by-default
  // then reports nothing and the suite passes **while a violation is present**.
  // Silently green is the worst state a guard can be in, and `tests.yml` runs
  // windows-latest, so this is pinned here rather than verified once by hand.
  const winKeys = buildPluginFiles({
    toKey: (f) => relative(ROOT, f).split(sep).join('\\'),
  });
  assert.ok(winKeys.has('lib/harnessability/scorer.js'),
    'key generation must normalise, not store what the platform produced');
  // Nested source on purpose: from a root-level document `dirname` is ROOT, so
  // the source-relative branch reproduces the direct branch and would rescue an
  // un-normalised token side, hiding what this test claims to pin.
  const nested = join(ROOT, 'skills', 'deep-harnessability', 'SKILL.md');
  for (const spelling of ['lib/harnessability/scorer.js', 'lib\\harnessability\\scorer.js']) {
    assert.equal(resolvesInPlugin(spelling, nested, winKeys), true,
      `lookup must resolve against Windows-shaped keys: ${spelling}`);
  }
  // Non-vacuity, with a backslash token on purpose. A slash token makes this pair
  // decorative — the un-normalised key set misses either way, so it passes however
  // the token was handled. The backslash spelling discriminates.
  const rawKeys = new Set([...winKeys].map((k) => k.split('/').join('\\')));
  assert.equal(resolvesInPlugin('lib\\harnessability\\scorer.js', nested, rawKeys), false,
    'un-normalised keys must not be reachable by an un-normalised token');

  // The `fromSource` half, exercised through the production call site with a
  // win32 `relative`. A relative token whose direct lookup misses must still
  // resolve via the source-relative branch, which it can only do if that branch
  // normalises its own result first. Nothing else can see this: on POSIX
  // `relative()` already returns slashes, so removing the normalisation is a
  // no-op.
  const winRel = (from, to) => relative(from, to).split('/').join('\\');
  // This pin is vacuous unless the DIRECT branch misses. `resolvesInPlugin`
  // strips the leading `./` and looks the bare name up first; if a file of that
  // name sat at the repo root it would return there and the source-relative
  // branch — the thing being pinned — would never run, while the assertion still
  // saw `true`.
  assert.equal(winKeys.has('scorer.js'), false,
    'a root-level file of this basename would make the next assertion vacuous');
  assert.equal(
    resolvesInPlugin('./scorer.js', join(ROOT, 'lib', 'harnessability', 'x.js'), winKeys, winRel),
    true,
    'the source-relative branch must normalise its own result before looking it up',
  );

  // And the whole index a Windows host would build must be key-for-key identical
  // to this one. With the normalisation removed from `buildPluginFiles`, every
  // key here comes back with backslashes.
  const rebuilt = buildPluginFiles({
    toKey: (f) => win32.relative(win32.join('C:\\plugin-root'),
      win32.join('C:\\plugin-root', ...relative(ROOT, f).split(sep))),
  });
  assert.deepEqual([...rebuilt].sort(), [...PLUGIN_FILES].sort(),
    'the index a Windows host builds must be key-for-key identical to this one');
});
