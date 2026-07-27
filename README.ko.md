[English](./README.md) | **한국어**

# deep-dashboard

![version](https://img.shields.io/github/package-json/v/Sungmin-Cho/claude-deep-dashboard?label=version)
![license](https://img.shields.io/github/license/Sungmin-Cho/claude-deep-dashboard)
[![part of deep-suite](https://img.shields.io/badge/part%20of-deep--suite-5b8def)](https://github.com/Sungmin-Cho/claude-deep-suite)

> [claude-deep-suite](https://github.com/Sungmin-Cho/claude-deep-suite) 생태계를 위한 크로스 플러그인 harness 진단 도구.

deep-dashboard 는 코드베이스가 얼마나 "harness 가능"한지 측정하고, 다른 deep-suite 플러그인의 센서 신호를 하나의 효과성 뷰로 집계하며, 크로스 플러그인 텔레메트리 시계열을 누적한다. **읽기 전용 consumer** 로서 다른 플러그인의 출력 디렉터리에 절대 쓰지 않는다.

두 런타임 모두를 위한 네이티브 manifest 를 제공한다: Claude Code manifest 는 `.claude-plugin/plugin.json`, Codex manifest 는 `.codex-plugin/plugin.json` 에 있으며 둘 다 동일한 skill 을 가리킨다.

## deep-suite 에서의 역할

deep-dashboard 는 **harness 진단 계층** 으로, [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) 프레임워크의 두 개념을 구현한다:

- **Harnessability 평가** — 6차원(17개 계산 detector) 에 걸친 코드베이스 준비도의 정량적 0–10 측정.
- **Human steering loop** — [deep-work](https://github.com/Sungmin-Cho/claude-deep-work), [deep-review](https://github.com/Sungmin-Cho/claude-deep-review), [deep-docs](https://github.com/Sungmin-Cho/claude-deep-docs), [deep-evolve](https://github.com/Sungmin-Cho/claude-deep-evolve) 의 센서 결과를 액션 라우팅과 함께 하나의 효과성 점수로 집계하는 통합 대시보드.

프레임워크의 2×2 매트릭스에서 **Computational Sensor** (Continuous 타이밍 밴드) 로 동작한다 — 개발 라이프사이클 밖에서 실행되어 harness 효과성을 시간에 따라 측정한다.

## 설치

`claude-deep-suite` 마켓플레이스를 통해:

```bash
# Claude Code
/plugin install deep-dashboard@claude-deep-suite

# Codex
codex plugin marketplace add Sungmin-Cho/claude-deep-suite
codex plugin add deep-dashboard@claude-deep-suite
```

deep-dashboard 는 Node.js 22 기반으로 Windows 11, macOS, Linux 를 네이티브
지원한다. 지원되는 모든 host 에서 같은 두 skill 과 Node entry point 를 쓴다.

### 런타임 및 직접 CLI 라우팅

Claude Code 와 Codex 는 선택된 `SKILL.md` 의 절대 경로를
`loadedSkillPath` 로 execution tool 에 전달한다. skill 은 이 경로에서 세
디렉터리 위로 올라가 plugin root 를 구한 뒤, 절대 script 경로와 명시적인
target project root 로 scorer 또는 dashboard 를 실행한다.
`CLAUDE_PLUGIN_ROOT` 는 loaded skill 을 찾기 위한 Claude Code 전용
bootstrap 일 뿐 Codex 변수가 아니며, target project fallback 으로 사용되지
않는다.

host 는 보통 shell-neutral Node argument vector 를 전달한다. 다음은 plugin
root 를 절대 경로로 resolve 한 뒤 사용하는 동등한 fallback 형식이다:

```text
# POSIX
node "/absolute/plugin/lib/harnessability/scorer.js" --project-root "$PWD"
node "/absolute/plugin/scripts/dashboard-cli.js" --project-root "$PWD"

# PowerShell
node "C:\absolute\plugin\lib\harnessability\scorer.js" --project-root (Get-Location).Path
node "C:\absolute\plugin\scripts\dashboard-cli.js" --project-root (Get-Location).Path
```

PowerShell 경로는 `loadedSkillPath` 에서 완전히 resolve 해야 한다. `..`
세그먼트를 전달하거나 caller 의 현재 디렉터리에서 plugin 위치를 추론하지
않는다.

설치 후 두 host 모두에서 두 skill 을 사용할 수 있다:

| Skill | Claude Code | Codex |
|---|---|---|
| Harnessability | `/deep-harnessability` | `$deep-dashboard:deep-harnessability` |
| Dashboard | `/deep-harness-dashboard` | `$deep-dashboard:deep-harness-dashboard` |

## Skills

| Skill | 용도 |
|---|---|
| `/deep-harnessability` | 현재 코드베이스를 6차원으로 채점하고 막대 차트를 렌더, `.deep-dashboard/harnessability-report.json` 기록. |
| `/deep-harness-dashboard` | 사용 가능한 플러그인 데이터를 집계해 통합 효과성 대시보드 렌더(`--json` 으로 JSON). |
| `/deep-harness-dashboard --suite` | 17-메트릭 크로스 플러그인 텔레메트리 시계열 + markdown trend report 누적; 옵션 OTel export. |

### `/deep-harnessability`

현재 프로젝트에 대해 scorer 를 실행하고 막대 차트 리포트를 표시한다:

```
[Harnessability Report] Score: 7.2/10 (Good)

  Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
  Module Bounds    ██████░░░░  6/10  ! 1 item needs attention
  Test Infra       ███████░░░  7/10  ! no coverage config found
  Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, lock file
  Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
  CI/CD            ██████████ 10/10  ✓ CI runs tests
```

5 미만으로 채점된 차원 뒤에는 추정 임팩트와 함께 상위 3개 권고가 따른다.

### `/deep-harness-dashboard`

사용 가능한 모든 플러그인에서 데이터를 수집하고, 리포트가 없거나 stale 이면 scorer 를 실행한 뒤, 효과성 점수를 계산해 CLI 대시보드를 렌더한다(옵션으로 `harness-report-YYYY-MM-DD.md` 기록):

```
╔═══════════════════════════════════════════════════════╗
         Deep-Suite Harness Dashboard
╠═══════════════════════════════════════════════════════╣
║ Topology: node-lib │ Harnessability: 7.2/10 (Good)   ║
╠═══════════════════════════════════════════════════════╣
║ ◆ Health Status (last: 2026-04-09)                    ║
║   dependency-vuln   ✓ clean                           ║
║   dead-export        ✗ 2 findings                     ║
╠═══════════════════════════════════════════════════════╣
║ Overall Harness Effectiveness: 6.8/10                 ║
║ Suggested actions:                                    ║
║  1. Remove unused export or add to health-ignore.json ║
╚═══════════════════════════════════════════════════════╝
```

## Harnessability 채점

순수 계산 기반 detector 17개(파일/설정 체크만 — 네트워크 호출도, LLM 추론도 없음)로 6차원에 걸쳐 코드베이스 준비도를 평가한다.

| 차원 | 가중치 | 체크 항목 |
|---|---|---|
| Type Safety | 25% | TypeScript strict mode, tsconfig.json, mypy strict, py.typed / .pyi stub |
| Module Boundaries | 20% | dependency-cruiser 설정, 정돈된 src/lib/app 디렉터리, index 진입점 파일 |
| Test Infrastructure | 20% | 테스트 프레임워크 설치, 테스트 파일 존재, 커버리지 설정 |
| Sensor Readiness | 15% | 린터 설정, 타입 체커 가용, lock 파일 존재 |
| Linter & Formatter | 10% | 린터 설정, 포매터 설정(Prettier / Biome / EditorConfig) |
| CI/CD | 10% | CI 설정 존재(`.github/workflows`, `.gitlab-ci.yml`, `.circleci`), CI 가 테스트 실행 |

각 차원은 통과한 체크 비율로 0–10 점을 받는다. 생태계와 무관한 체크는 `not_applicable` 로 표시되어 해당 차원의 분모에서 제외된다(예: Python 전용 프로젝트의 TypeScript 체크). 차원 가중치는 재분배되지 않는다. 모든 체크가 `not_applicable` 인 차원은 0 점을 받고 그 가중치만큼 그대로 감점되며, 이는 스냅샷 간 점수 비교 가능성을 지키기 위한 의도된 생태계 불일치 페널티다. 최종 점수는 가중 평균이며 소수점 한 자리로 반올림된다.

| 등급 | 점수 |
|---|---|
| Excellent | 8.0–10.0 |
| Good | 5.0–7.9 |
| Fair | 3.0–4.9 |
| Poor | 0.0–2.9 |

리포트는 [claude-deep-suite M3 cross-plugin envelope](https://github.com/Sungmin-Cho/claude-deep-suite/blob/main/docs/envelope-migration.md)(`schema_version: "1.0"` + `envelope` 블록 + `payload`) 로 wrap 되어 `.deep-dashboard/harnessability-report.json` 에 저장된다. domain data 는 `.payload.*`(`total`, `grade`, `dimensions`, `recommendations`) 에 위치한다. 이 리포트는 deep-work Phase 1 Research(존재하고 24시간 미만일 때)와 `/deep-harness-dashboard` 가 소비한다.

## 통합 대시보드

설치된 플러그인의 데이터를 하나의 터미널 뷰 또는 markdown 리포트로 집계한다. collector 는 방어적으로 읽으며(누락 파일은 throw 대신 `null` 반환) **M3 envelope-aware** 다: 각 source 에서 envelope 래퍼를 감지하고 `producer` / `artifact_kind` / `schema.name` identity 가드를 강제한 뒤 unwrap 된 payload 를 노출한다. legacy 비래핑 artifact 는 그대로 통과하고, identity 불일치 envelope 은 stderr 경고와 함께 `null` 처리된다(defense-in-depth).

**데이터 소스**

| 플러그인 | 읽는 데이터 | 위치 |
|---|---|---|
| deep-work | slice receipt, session receipt | `.deep-work/receipts/*.json`, `.deep-work/session-receipt.json` |
| deep-review | review receipt, fitness rule | `.deep-review/receipts/*.json`, `.deep-review/fitness.json` |
| deep-docs | 마지막 doc scan | `.deep-docs/last-scan.json` |
| deep-evolve | evolve receipt | `.deep-evolve/evolve-receipt.json` |
| deep-dashboard | harnessability 리포트 | `.deep-dashboard/harnessability-report.json` |

**효과성 점수** — 5개 가중 차원에서 산출되는 단일 0–10 점수:

| 차원 | 가중치 | 소스 |
|---|---|---|
| Health | 25% | deep-review fitness 데이터의 `sensors_clean_ratio` |
| Fitness | 20% | `.deep-review/fitness.json` 의 `rules_pass_ratio` |
| Session | 20% | 최근 3개 deep-work receipt 의 평균 `quality_score` |
| Harnessability | 15% | harnessability 리포트의 `total` |
| Evolve | 20% | `.deep-evolve/evolve-receipt.json` 의 `quality_score` |

데이터가 없는 차원이 있으면 그 가중치는 사용 가능한 차원에 비례 재분배되고, 데이터가 전혀 없으면 점수는 `N/A` 다.

**액션 라우팅** — fitness rule, review receipt, docs staleness 체크의 finding 이 `suggested_action` 문자열로 매핑된다(예: `dependency-vuln` → `npm audit fix`, `docs-stale` → `/deep-docs-scan` 실행, `file-metric` → deep-work 세션에서 큰 파일 분할).

## Suite 텔레메트리 (`--suite`)

Suite 모드는 단일 스냅샷 대시보드의 opt-in superset 이다. legacy 모드가 5개 소스에서 일회성 효과성 뷰를 렌더하는 반면, suite 모드는 6개 deep-suite 플러그인 전체에 걸친 17개 크로스 플러그인 메트릭의 **시계열** 을 누적하며 OTel 관측성의 기반이다.

15개 소스(12개 M3 envelope artifact + 3개 NDJSON 이벤트 로그)를 읽으며, 프로젝트 root 밖의 vault 를 위해 `options.wikiRoot` / `DEEP_WIKI_ROOT` 를 존중한다. authoritative 메트릭 카탈로그는 [`lib/metrics-catalog.yaml`](./lib/metrics-catalog.yaml) 이며, 모든 메트릭이 소스, 집계 공식, `null_when` 시멘틱을 담고 있다.

| Tier | Metric ID | 요약 |
|---|---|---|
| M4-core | `suite.hooks.block_rate` | hook 스크립트가 차단한 hook 호출. |
| M4-core | `suite.hooks.error_rate` | hook 스크립트 내부 오류율. |
| M4-core | `suite.artifact.freshness_seconds` | envelope-wrapped artifact 의 최대 age. |
| M4-core | `suite.artifact.schema_failures_total` | collector identity-guard 가 거부한 envelope. |
| M4-core | `suite.integrate.recommendation_accept_rate` | Phase 5 Integrate accept rate. |
| M4-core | `suite.review.verdict_mix` | APPROVE / CONCERN / REQUEST_CHANGES 분포. |
| M4-core | `suite.review.recurring_finding_count` | 발생 횟수 ≥ 2 인 finding. |
| M4-core | `suite.wiki.auto_ingest_candidates_total` | **Deprecated** (항상 `null`): producer 에 내구 candidate 신호 없음; wire key 는 보존. |
| M4-core | `suite.wiki.ingest_actions_total` | deep-wiki `log.jsonl` 의 ingest lifecycle 활동량 (`ingest`, `ingest-skip`, `ingest-repair`, `ingest-fail`). |
| M4-core | `suite.docs.auto_fix_accept_rate` | deep-docs garden auto-fix 수락률. |
| M4-core | `suite.evolve.q_delta_per_epoch` | epoch 당 품질 delta. |
| M4-core | `suite.dashboard.missing_signal_ratio` | 누락/무효 expected 소스 비율. |
| M4-core | `suite.cross_plugin.run_id_chain_completeness` | 플러그인 전반의 `parent_run_id` chain 무결성. |
| M5-activated | `suite.compaction.frequency` | 세션 전반에서 관측된 compaction 이벤트. |
| M5-activated | `suite.compaction.preserved_artifact_ratio` | compaction 당 평균 preserved-vs-discarded 비율. |
| M5-activated | `suite.handoff.roundtrip_success_rate` | round-trip 된 initiating handoff 비율. |
| M5.5-activated | `suite.tests.coverage_per_plugin` | per-plugin 테스트 카탈로그 커버리지. |

**출력**

- `.deep-dashboard/suite-metrics.jsonl` — append-only JSONL 시계열(`--suite` 실행당 스냅샷 하나).
- `.deep-dashboard/suite-report.md` — 최신 스냅샷을 이전 baseline 과 비교하는 화살표(↑/↓/→/·/?) markdown trend report.

**옵션 OTel export** — `OTEL_EXPORTER_OTLP_ENDPOINT` 가 설정되면 스냅샷이 설정된 OTLP/HTTP-JSON collector 로도 push 된다. export 실패는 non-fatal 이다: 로깅·보고되지만 로컬 리포트 렌더링을 막지 않는다.

```bash
/deep-harness-dashboard --suite
```

## 아키텍처

deep-dashboard 는 다른 플러그인의 출력 디렉터리에 절대 쓰지 않는다 — scorer 는 대상 프로젝트 내의 `.deep-dashboard/` 에만 쓴다. 그 외 모든 읽기는 소유 플러그인의 출력 디렉터리에서 이뤄진다.

```
deep-work   ──┐
              │
deep-review ──┤
              ├──► deep-dashboard (collector → effectiveness → formatter)
deep-docs   ──┤         │
              │         └──► .deep-dashboard/harnessability-report.json
deep-evolve ──┘
```

scorer, collector, effectiveness 계산기, action router, formatter 는 모두 외부 런타임 의존성이 없는 순수 Node.js ESM 모듈이다.

## 링크

- [변경 이력](CHANGELOG.ko.md)
- [deep-suite 마켓플레이스](https://github.com/Sungmin-Cho/claude-deep-suite)
- 관련 플러그인: [deep-work](https://github.com/Sungmin-Cho/claude-deep-work) · [deep-review](https://github.com/Sungmin-Cho/claude-deep-review) · [deep-docs](https://github.com/Sungmin-Cho/claude-deep-docs) · [deep-evolve](https://github.com/Sungmin-Cho/claude-deep-evolve) · [deep-wiki](https://github.com/Sungmin-Cho/claude-deep-wiki)

## 라이선스

MIT
