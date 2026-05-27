# Security Policy

## Supported versions

Security fixes are delivered through the latest release of deep-dashboard. Run
`jq -r .version .claude-plugin/plugin.json` to check your installed version.

## Reporting a vulnerability

Please report security issues **privately** via
[GitHub Security Advisories](https://github.com/Sungmin-Cho/claude-deep-dashboard/security/advisories/new)
rather than opening a public issue.

We aim to acknowledge reports within a few days and will coordinate a fix and a
disclosure timeline with you.

## Scope

deep-dashboard is a **read-only consumer** of cross-plugin telemetry and
diagnostics. It reads artifacts from sibling plugins' output directories
(`.deep-work/`, `.deep-review/`, `.deep-docs/`, `.deep-evolve/`, the wiki
vault), and writes only to `.deep-dashboard/` within the target project. To
limit trust-boundary exposure it:

- detects the M3 cross-plugin envelope and enforces identity guards
  (`producer` / `artifact_kind` / `schema.name`) before unwrapping a payload —
  an identity-mismatched envelope landing under another plugin's read path
  resolves to `null` with a warning, never silently trusted;
- contains directory reads with `realpath` boundary checks so symlinks cannot
  ingest data from outside the project root.

When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, suite metrics are exported to that
endpoint over OTLP/HTTP-JSON; review where that endpoint points before enabling
it. Export is off unless the environment variable is set.
