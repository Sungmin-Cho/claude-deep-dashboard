# Contributing to deep-dashboard

Thanks for your interest in improving **deep-dashboard** — the cross-plugin
harness diagnostics and suite-telemetry plugin in the
[Deep Suite](https://github.com/Sungmin-Cho/claude-deep-suite) family for
Claude Code and Codex.

## Development setup

```bash
git clone https://github.com/Sungmin-Cho/claude-deep-dashboard.git
cd claude-deep-dashboard
```

Node 22+ is required (ESM project) on Windows, macOS, and Linux. There are no runtime dependencies — the
test runner is the built-in `node --test`, so there is nothing to `npm install`.

## Tests

```bash
npm test                    # node --test "lib/**/*.test.js" "tests/**/*.test.js"
npm run validate:envelope   # envelope contract self-test (producer_version + identity + shape)
npm run check:catalog-drift # local test-catalog manifest vs the suite-repo source of truth
npm run check:version-sync  # plugin.json.version === package.json.version
node scripts/validate-codex-release-candidate.js --candidate-root "$PWD"
```

Everything must be green before you open a PR. `check:catalog-drift` resolves
the suite repo via `--suite-path=`, the `SUITE_REPO_LOCAL` env var, or a `gh`
CLI fallback.

## Conventions

- **Documentation** follows [`docs/DOCS_RULE.md`](docs/DOCS_RULE.md) (a local
  maintainer guide): the README is evergreen, the CHANGELOG follows
  [Keep a Changelog](https://keepachangelog.com/), and `CLAUDE.md` / `AGENTS.md`
  stay short and never hardcode the version.
- **Version triple-sync**: `.claude-plugin/plugin.json`,
  `.codex-plugin/plugin.json`, and `package.json` must always share the same
  version. `npm run check:version-sync` guards the plugin/package pair.
- **ESM-only, zero runtime deps**: all modules use `import` / `export`; no npm
  packages outside `devDependencies`.

## Pull requests

1. Branch from `main`.
2. Add a `[Unreleased]` entry to `CHANGELOG.md` (and `CHANGELOG.ko.md`) for any
   user-observable change.
3. Make sure the commands above pass.
4. Explain what changed and why.

## Reporting issues

Open a GitHub issue. For security reports, see [`SECURITY.md`](SECURITY.md).
