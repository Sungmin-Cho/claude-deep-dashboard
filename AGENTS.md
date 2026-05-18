# deep-dashboard - Codex Project Guide

Cross-plugin harness diagnostics and suite telemetry for the Deep Suite
ecosystem. This repo keeps Claude Code compatibility and exposes Codex-native
manifest metadata.

Current version: 1.3.6.

## Runtime Surfaces

- Codex manifest: `.codex-plugin/plugin.json`
- Claude Code manifest: `.claude-plugin/plugin.json`
- Skills: `skills/`
- Diagnostics code: `lib/`
- Scripts: `scripts/validate-envelope-emit.js`, `scripts/check-catalog-drift.js`,
  `scripts/check-version-sync.js`

Dashboard output under `.deep-dashboard/` belongs to target projects unless it
is an intentional fixture.

## Verification

```bash
node -e "JSON.parse(require('fs').readFileSync('.codex-plugin/plugin.json','utf8'))"
npm test
npm run validate:envelope
npm run check:catalog-drift
npm run check:version-sync
```

After a release, update both suite marketplace manifests in
`/Users/sungmin/Dev/claude-plugins/deep-suite/`.
