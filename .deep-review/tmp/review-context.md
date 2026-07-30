# Review target context

Branch `refactor/context-diet-claude5` (5 commits over main @ 5291fab), open as PR #23.
Intent: documentation "context diet" applying Anthropic's Claude 5 context-engineering rules
(source: claude.com blog, 2026-07-24) — no behavior change intended.

Changes claimed by the authors:
- CLAUDE.md reduced to a 1-line `@AGENTS.md` import + note; AGENTS.md rebuilt as the single
  source of shared runtime contracts (docs 17,788 -> 8,248 bytes combined).
- Both SKILL.md files dieted (17,418 -> 12,503 bytes): frontmatter descriptions halved with
  trigger phrases preserved verbatim; routing-handoff prose compressed; label-mapping table
  removed; render/argv/routing contracts retained for standalone (Codex) skill loads.
- Two inherited doc-vs-code contract errors corrected: (a) removed a false claim that
  not_applicable check weights are redistributed (scorer.js never redistributes; deliberate,
  pinned by missing-signal.test.js); (b) 24h freshness threshold code site corrected to
  DAY_MS in scripts/dashboard-cli.js (was misattributed to scorer.js).
- Release plumbing for v1.5.1: 3 manifests + package-lock + CHANGELOG(.ko) + version pins in
  tests/fixtures/sample-harnessability-report.json, tests/plugin-contract.test.js,
  tests/codex-release-candidate.test.js, and scripts/validate-codex-release-candidate.js
  RELEASE_VERSION (constant only — the sole non-doc source change; flagged for attention).

Machine gates already run by authors: npm test 329/329; validate:envelope, check:catalog-drift,
check:version-sync green; GitHub CI green on 3 OS including the codex release-candidate validator.

Note (controller): environment change_state was "untracked-only", but all 18 untracked files are
.deep-review/tmp/* leftovers from a 2026-07-06 review (this plugin's own state dir). Effective
target deliberately set to clean REVIEW_BASE..HEAD.
