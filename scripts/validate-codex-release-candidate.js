import { spawnSync } from 'node:child_process';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PLUGIN_NAME = 'deep-dashboard';
const RELEASE_VERSION = '1.5.0';
const REQUIRED_SKILLS = ['deep-harness-dashboard', 'deep-harnessability'];
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const EXCLUDED_COPY_ROOTS = new Set([
  '.git',
  '.claude',
  '.codex',
  '.deep-dashboard',
  '.deep-docs',
  '.deep-evolve',
  '.deep-review',
  '.deep-suite-cache',
  '.deep-work',
  '.serena',
  'node_modules'
]);

function requirePlainObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a non-null object`);
  }
  return value;
}

async function readJson(filePath, label = filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`, { cause: error });
  }
  return requirePlainObject(parsed, label);
}

function assertCandidateIdentity(pluginManifest, skillEntries) {
  if (pluginManifest.name !== PLUGIN_NAME) {
    throw new Error(`candidate plugin name must be ${PLUGIN_NAME}`);
  }
  if (pluginManifest.version !== RELEASE_VERSION) {
    throw new Error(`candidate plugin version must be ${RELEASE_VERSION}`);
  }
  if (pluginManifest.skills !== './skills/') {
    throw new Error("candidate plugin skills must be './skills/'");
  }
  const names = new Set(skillEntries.map(({ name }) => name));
  for (const required of REQUIRED_SKILLS) {
    if (!names.has(required)) {
      throw new Error(`candidate is missing skills/${required}/SKILL.md`);
    }
  }
}

async function readSkillEntries(candidateRoot) {
  const skillsRoot = path.join(candidateRoot, 'skills');
  const entries = [];
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
    let text;
    try {
      text = await readFile(skillPath, 'utf8');
    } catch (error) {
      throw new Error(`missing ${skillPath}: ${error.message}`, { cause: error });
    }
    const declaredName = text.match(/^---[\s\S]*?^name:\s*([^\s]+)\s*$/m)?.[1];
    if (declaredName !== entry.name) {
      throw new Error(`${skillPath} must declare name: ${entry.name}`);
    }
    entries.push({ name: entry.name, path: skillPath });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export async function buildCandidateFixture({ candidateRoot, sourceUrl, sourceSha }) {
  if (!SHA_PATTERN.test(sourceSha)) {
    throw new Error('candidate source.sha must be exactly 40 lowercase hex characters');
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch (error) {
    throw new Error('candidate source.url must be an absolute URL', { cause: error });
  }
  if (parsedUrl.protocol !== 'file:') {
    throw new Error('candidate source.url must use the file: protocol');
  }

  const pluginManifest = await readJson(
    path.join(candidateRoot, '.codex-plugin', 'plugin.json'),
    '.codex-plugin/plugin.json'
  );
  const skillEntries = await readSkillEntries(candidateRoot);
  assertCandidateIdentity(pluginManifest, skillEntries);

  const marketplaceName = `deep-dashboard-${RELEASE_VERSION.replaceAll('.', '-')}-candidate`;
  return {
    marketplace: {
      name: marketplaceName,
      interface: {
        displayName: 'Deep Dashboard Release Candidate',
        shortDescription: 'Isolated Deep Dashboard release-candidate smoke'
      },
      plugins: [
        {
          name: PLUGIN_NAME,
          description: pluginManifest.description ?? 'Deep Dashboard release candidate',
          source: {
            source: 'url',
            url: sourceUrl,
            sha: sourceSha
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_USE'
          },
          category: 'Productivity'
        }
      ]
    },
    pluginManifest,
    skillEntries
  };
}

function copyFilter(candidateRoot, sourcePath) {
  const relative = path.relative(candidateRoot, sourcePath);
  if (relative === '') return true;
  return relative
    .split(path.sep)
    .every((segment) => !segment.startsWith('.deep-') && !EXCLUDED_COPY_ROOTS.has(segment));
}

function isolatedEnvironment(tempRoot, codexHome) {
  const environment = {};
  const allowed = new Set([
    'COMSPEC',
    'LANG',
    'LC_ALL',
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR'
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) {
      environment[key.toUpperCase()] = value;
    }
  }

  const childHome = path.join(tempRoot, 'home');
  const childTemp = path.join(tempRoot, 'tmp');
  Object.assign(environment, {
    HOME: childHome,
    USERPROFILE: childHome,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: path.join(childHome, '.config'),
    XDG_CACHE_HOME: path.join(childHome, '.cache'),
    TEMP: childTemp,
    TMP: childTemp,
    TMPDIR: childTemp,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'file',
    NO_COLOR: '1'
  });
  return { environment, childHome, childTemp };
}

function commandFailure(command, args, result) {
  const stdout = result.stdout?.trim();
  const stderr = result.stderr?.trim();
  const details = [
    `${command} ${args.join(' ')} failed with status ${String(result.status)}`,
    stdout ? `stdout:\n${stdout}` : null,
    stderr ? `stderr:\n${stderr}` : null,
    result.error ? `error: ${result.error.message}` : null
  ].filter(Boolean);
  return new Error(details.join('\n'));
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments: options.windowsVerbatimArguments === true,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw commandFailure(command, args, result);
  }
  return result.stdout.trim();
}

function quoteForCmd(value) {
  // `call` reparses a .cmd shim. Preserve plain flags such as `--version`
  // verbatim; quote only values that actually need cmd escaping.
  if (value !== '' && !/[\s"&|<>^%]/.test(value)) return value;
  const escaped = value
    .replaceAll('^', '^^')
    .replaceAll('%', '%%')
    .replace(/[&|<>]/g, '^$&')
    .replaceAll('"', '""');
  return `"${escaped}"`;
}

export function buildCodexInvocation(
  args,
  { platform = process.platform, environment = {} } = {}
) {
  if (platform !== 'win32') {
    return { command: 'codex', args };
  }
  const commandLine = `call codex ${args.map(quoteForCmd).join(' ')}`;
  return {
    command: environment.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', commandLine],
    // The final argument is already a complete cmd command line. Prevent
    // Node/libuv from applying an additional incompatible quoting pass.
    windowsVerbatimArguments: true
  };
}

function runCodex(args, options) {
  const invocation = buildCodexInvocation(args, { environment: options.env });
  return runCommand(invocation.command, invocation.args, {
    ...options,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments
  });
}

function parsePluginList(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`codex plugin list did not emit JSON: ${error.message}`, { cause: error });
  }
  const object = requirePlainObject(parsed, 'codex plugin list output');
  if (!Array.isArray(object.installed) || !Array.isArray(object.available)) {
    throw new Error('codex plugin list JSON must contain installed[] and available[]');
  }
  return [...object.installed, ...object.available];
}

async function findInstalledCandidate(codexHome) {
  const cacheRoot = path.join(codexHome, 'plugins', 'cache');
  const manifests = [];

  async function walk(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (
        entry.isFile()
        && entry.name === 'plugin.json'
        && path.basename(path.dirname(entryPath)) === '.codex-plugin'
      ) {
        manifests.push(entryPath);
      }
    }
  }

  await walk(cacheRoot);
  const matches = [];
  for (const manifestPath of manifests) {
    const manifest = await readJson(manifestPath, manifestPath);
    if (manifest.name === PLUGIN_NAME && manifest.version === RELEASE_VERSION) {
      matches.push({ manifest, manifestPath, pluginRoot: path.dirname(path.dirname(manifestPath)) });
    }
  }
  if (matches.length !== 1) {
    throw new Error(`expected exactly one installed ${PLUGIN_NAME}@${RELEASE_VERSION} cache, found ${matches.length}`);
  }
  return matches[0];
}

async function verifyInstalledSkills(installed) {
  if (installed.manifest.skills !== './skills/') {
    throw new Error("installed candidate manifest skills must be './skills/'");
  }
  const skillsRoot = path.resolve(installed.pluginRoot, installed.manifest.skills);
  const relative = path.relative(installed.pluginRoot, skillsRoot);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('installed candidate skills path escapes the plugin cache root');
  }
  const entries = await readSkillEntries(installed.pluginRoot);
  const discovered = new Set(entries.map(({ name }) => name));
  for (const required of REQUIRED_SKILLS) {
    if (!discovered.has(required)) {
      throw new Error(`installed candidate is missing skills/${required}/SKILL.md`);
    }
  }
  return REQUIRED_SKILLS.slice();
}

export async function validateCodexReleaseCandidate(candidateRootInput) {
  const candidateRoot = await realpath(path.resolve(candidateRootInput));
  if (!(await stat(candidateRoot)).isDirectory()) {
    throw new Error(`candidate root is not a directory: ${candidateRoot}`);
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'deep-dashboard-codex-candidate-'));
  let result;
  try {
    const repositoryRoot = path.join(tempRoot, 'repository');
    const marketplaceRoot = path.join(tempRoot, 'marketplace');
    const codexHome = path.join(tempRoot, '.codex');
    const { environment, childHome, childTemp } = isolatedEnvironment(tempRoot, codexHome);
    await Promise.all([
      mkdir(repositoryRoot, { recursive: true }),
      mkdir(marketplaceRoot, { recursive: true }),
      mkdir(codexHome, { recursive: true }),
      mkdir(childHome, { recursive: true }),
      mkdir(childTemp, { recursive: true }),
      mkdir(path.join(childHome, '.config'), { recursive: true }),
      mkdir(path.join(childHome, '.cache'), { recursive: true })
    ]);

    await cp(candidateRoot, repositoryRoot, {
      recursive: true,
      force: true,
      filter: (sourcePath) => copyFilter(candidateRoot, sourcePath)
    });

    const runGit = (args) => runCommand('git', args, { cwd: repositoryRoot, env: environment });
    runGit(['init']);
    runGit(['config', '--local', 'user.name', 'deep-dashboard candidate fixture']);
    runGit(['config', '--local', 'user.email', 'candidate@example.invalid']);
    runGit(['config', '--local', 'commit.gpgsign', 'false']);
    runGit(['add', '--all']);
    runGit(['commit', '--no-gpg-sign', '-m', 'test: build isolated Codex release candidate']);
    const sourceSha = runGit(['rev-parse', 'HEAD']);
    if (!SHA_PATTERN.test(sourceSha)) {
      throw new Error(`temporary candidate commit returned invalid SHA: ${sourceSha}`);
    }

    const sourceUrl = pathToFileURL(path.join(repositoryRoot, '.git')).href;
    const fixture = await buildCandidateFixture({
      candidateRoot: repositoryRoot,
      sourceUrl,
      sourceSha
    });
    const marketplaceManifest = path.join(
      marketplaceRoot,
      '.agents',
      'plugins',
      'marketplace.json'
    );
    await mkdir(path.dirname(marketplaceManifest), { recursive: true });
    await writeFile(marketplaceManifest, `${JSON.stringify(fixture.marketplace, null, 2)}\n`);

    const codexVersion = runCodex(['--version'], { cwd: tempRoot, env: environment });
    if (codexVersion !== 'codex-cli 0.144.1') {
      throw new Error(`unexpected Codex CLI: ${codexVersion}`);
    }

    runCodex(['plugin', 'marketplace', 'add', marketplaceRoot], {
      cwd: tempRoot,
      env: environment
    });
    const listOutput = runCodex([
      'plugin',
      'list',
      '--marketplace',
      fixture.marketplace.name,
      '--available',
      '--json'
    ], { cwd: tempRoot, env: environment });
    const listed = parsePluginList(listOutput).find(
      (plugin) => plugin.name === PLUGIN_NAME
        && plugin.marketplaceName === fixture.marketplace.name
    );
    if (!listed) {
      throw new Error(`candidate marketplace did not list ${PLUGIN_NAME}`);
    }
    if (listed.source?.sha !== sourceSha) {
      throw new Error(`listed candidate source.sha does not match ${sourceSha}`);
    }
    runCodex([
      'plugin',
      'add',
      `${PLUGIN_NAME}@${fixture.marketplace.name}`
    ], { cwd: tempRoot, env: environment });

    const installed = await findInstalledCandidate(codexHome);
    const skills = await verifyInstalledSkills(installed);
    if (installed.manifest.version !== RELEASE_VERSION) {
      throw new Error(`installed candidate version must be ${RELEASE_VERSION}`);
    }

    result = {
      marketplace: fixture.marketplace.name,
      plugin: PLUGIN_NAME,
      version: installed.manifest.version,
      sourceSha,
      skills
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  return result;
}

function parseArguments(args) {
  if (args.length !== 2 || args[0] !== '--candidate-root' || args[1] === '') {
    throw new Error('usage: node scripts/validate-codex-release-candidate.js --candidate-root <absolute-workspace>');
  }
  if (!path.isAbsolute(args[1])) {
    throw new Error('--candidate-root must be an absolute path');
  }
  return args[1];
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;

if (isMain) {
  try {
    const candidateRoot = parseArguments(process.argv.slice(2));
    const validated = await validateCodexReleaseCandidate(candidateRoot);
    process.stdout.write(`${JSON.stringify(validated, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`validate-codex-release-candidate: ${error.message}\n`);
    process.exitCode = 1;
  }
}
