[English](./CHANGELOG.md) | **한국어**

# 변경 이력

이 프로젝트의 주요 변경 사항을 여기에 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 를 따르며,
[유의적 버전](https://semver.org/spec/v2.0.0.html) 을 준수합니다.

## [1.5.1] — 2026-07-27 (Claude 5 컨텍스트 엔지니어링 규칙에 따른 컨텍스트 다이어트)

### 변경

- `CLAUDE.md` 는 한 줄 `@AGENTS.md` import 로 바뀌었고, 공유 런타임 규칙·gotcha·크로스 플러그인 계약의 단일 소스는 `AGENTS.md` 가 된다 — 두 파일 합산 17,788 → 8,248 바이트 (−53.6 %).
- 두 skill 본문에서 중복·재서술 문장을 걷어내되 실행 계약은 전부 유지한다: 17,418 → 12,503 바이트 (−28.2 %).
- 두 skill 의 `description` frontmatter 를 절반으로 줄였고 (655 → 326, 804 → 401 바이트), 영어·한국어 트리거 문구 16개는 모두 원문 그대로 보존한다.

### 수정

- 가이드에서 `not_applicable` 가중치 재분배 서술을 제거한다: scorer 는 dimension 가중치를 재정규화하지 않으므로, 전부 not-applicable 인 dimension 은 해당 가중치를 그대로 잃는다 — 버그가 아니라 의도된 페널티다.
- 24시간 freshness 임계값의 실제 구현 위치를 scorer 가 아닌 `scripts/dashboard-cli.js` 의 `DAY_MS` 로 바로잡는다.

## [1.5.0] — 2026-07-10 (네이티브 Codex 및 Windows 지원)

### 추가

- 격리된 Codex marketplace 설치를 포함하는 동일한 Node.js 22 릴리스 계약으로 macOS 및 Linux와 함께 Windows 11을 네이티브 지원한다.
- Codex 사용자가 Deep Suite marketplace를 통해 두 dashboard skill을 모두 설치하고 탐색할 수 있다.

### 변경

- skill 실행이 host가 로드한 skill 파일에서 절대 script 경로를 도출해 Claude Code와 Codex 라우팅을 shell-neutral하게 유지한다.
- symlink 의존 보안 검사는 host 권한이 없을 때만 skip하고, 가능한 host에서는 전체 assertion을 유지한다.

## [1.4.0] — 2026-07-07 (정직한 wiki 메트릭 + session effectiveness 부활)

### 추가

- `ingest_actions_total` — 실제 ingest 액션 수를 세는 새 wiki 메트릭. 오도하는 `auto_ingest_candidates_total` 을 대신하는 정직한 신호다.
- effectiveness 가 다시 **session** 차원을 보고한다 — emit 된 `session-receipt` 아티팩트들의 union 으로 재구성.

### 변경

- `auto_ingest_candidates_total` 를 **deprecate** — 수행된 액션이 아니라 후보를 세어 활동을 과대 표시했다. back-compat 을 위해 한 릴리스 동안 유지되며 `ingest_actions_total` 로 대체된다.

### 수정

- payload `schema.version` MAJOR 를 두 unwrap seam 모두에서 가드하여, 미래의 비호환 payload MAJOR 가 조용히 오파싱되는 대신 거부된다.
- `wiki-index` project-local fallback 경로에 `.wiki-meta` 세그먼트가 빠져 있던 문제 — fallback 이 이제 올바른 위치를 resolve 한다.

## [1.3.7] — 2026-05-18 (Codex skill 디렉터리 레이아웃)

### 변경

- Codex skill 표면을 `skills/<skill>/SKILL.md` 디렉터리 구조로 이동해, manifest 의 `"skills": "./skills/"` root 에서 Codex 가 `deep-harnessability` 와 `deep-harness-dashboard` 를 인식할 수 있게 했다.

## [1.3.6] — 2026-05-18 (Codex 네이티브 plugin manifest 와 AGENTS 가이드)

### 추가

- `.codex-plugin/plugin.json` — Claude Code manifest 와 동일한 skill/hook 표면을 가리키는 Codex 네이티브 plugin manifest.
- `AGENTS.md` — runtime 표면과 검증 명령을 다루는 Codex 프로젝트 가이드.

### 변경

- README 가 Claude Code 표면과 함께 Codex 호환성을 문서화한다.

## [1.3.5] — 2026-05-16 (catalog-drift horizon 메커니즘)

### 변경

- catalog-drift 검사가 suite 카탈로그가 dashboard 의 추적 범위를 넘어 성장해도 실패하지 않는다: heading 은 table anchor 로만 취급되고, id 가 manifest horizon 을 초과하는 suite-side row 는 drift 대신 info 로 보고(exit 0)된다. horizon 안의 drift 는 여전히 실패한다.

### 수정

- `test` 스크립트를 `node --test $(find lib -name '*.test.js')` 로 전환해 bash/zsh 모두에서 이식 가능한 테스트 파일 열거를 보장했다(기존 `**` glob 은 CI 에서 테스트 파일을 silent 하게 누락시켰다).

## [1.3.4] — 2026-05-12 (cross-plugin roundtrip 가드)

### 추가

- suite 의 canonical 4-artifact handoff fixture set 을 aggregator 의 M5 compute function 에 통과시켜 expected 메트릭값(`compaction.frequency`, `compaction.preserved_artifact_ratio`, `handoff.roundtrip_success_rate`)을 고정하는 consumer-side end-to-end 테스트 — provider 측의 silent 변경이 테스트 실패로 드러난다.

## [1.3.3] — 2026-05-12 (리뷰 후속 정리)

### 추가

- 로컬 test-catalog manifest 를 suite-repo 진실원본과 비교하는 catalog-drift 검사기(`scripts/check-catalog-drift.js` + `npm run check:catalog-drift`). source 해석 순서: `--suite-path=` → `SUITE_REPO_LOCAL` → `gh api` 폴백.
- drift 검사기를 PR, main push, 매일 크론으로 실행하는 첫 GitHub Actions 워크플로(`catalog-drift-check.yml`).

### 변경

- known-suite-plugins 카탈로그를 `lib/suite-constants.js` 의 단일 진실원본으로 hoist 했다(이전에는 중복 정의).

### 마이그레이션

- 엔벨로프 스키마 변경 없음. `producer_version` 에 strict 동등성을 쓰는 컨슈머는 1.3.2 → 1.3.3 으로 갱신해야 한다.

## [1.3.2] — 2026-05-12 (M5.5: per-plugin 테스트 커버리지)

마지막 deferred 메트릭을 활성화한다. 이 릴리스로 카탈로그의 16개 메트릭 모두 M4-core 가 된다.

### 추가

- `suite.tests.coverage_per_plugin` 메트릭 — 표준 테스트 카탈로그 대비 per-plugin `{ covered, expected, ratio, tests }` 분포를 emit. 미참여 plugin 은 value map 에서 제외되고 `source_summary.plugins_unparticipating` 로 노출된다.
- `lib/test-catalog-manifest.json` — 이 메트릭의 dashboard-internal 진실원본이며 suite-repo 카탈로그와 lockstep 으로 유지된다.

### 변경

- `suite.tests.coverage_per_plugin` 이 M4-deferred 에서 M4-core 로 승격되고, unit 이 `ratio` 에서 `distribution` 으로, 공식이 per-plugin participation-aware 로 바뀌었다.
- distribution 렌더러가 per-plugin ratio cell 을 inline 으로 출력하고, 비어있는 M4-deferred 섹션은 report 에서 생략된다.

### 수정

- sample harnessability-report fixture 의 `producer_version` 를 `plugin.json.version` 과 일치하도록 bump 했다(M3 envelope 채택 이후 stale 상태였음).

### 마이그레이션

- 새 메트릭은 dashboard-internal 이므로 producer-plugin 변경이 필요 없다.

## [1.3.1] — 2026-05-11 (M5: handoff + compaction-state 메트릭)

suite 의 `handoff` 와 `compaction-state` payload 스키마가 ratified 되어, deferred 메트릭 4개 중 3개를 활성화한다. backward-compatible 추가만 포함한다.

### 추가

- compute 함수 3개: `computeCompactionFrequency`(compaction-state envelope 총 개수), `computeCompactionPreservedArtifactRatio`(per-envelope preserved-vs-discarded ratio 의 평균, undefined-discarded 와 full-reset 케이스 제외), `computeHandoffRoundtripSuccessRate`(receiver 가 emit 한 envelope 의 `parent_run_id` 가 handoff 로 chain back 하면 round-trip 으로 카운트).
- `EXPECTED_SOURCES` 를 15개 entry 로 확장하며 `deep-evolve/handoff` 와 `deep-evolve/compaction-state` 추가(deep-evolve 는 reverse handoff 와 epoch-boundary compaction-state 를 emit), 각 스키마의 required key 를 미러링하는 `PAYLOAD_REQUIRED_FIELDS` 포함.
- 각 `(producer, kind)` source 에 대해 flat aggregation dir 와 per-session subdir 양쪽을 스캔하는 신규 collector cardinality.
- handoff 와 compaction-state 의 canonical envelope-wrapped fixture, end-to-end 활성화 테스트에서 소비.

### 변경

- M5-활성화 메트릭 3개를 M4-deferred 블록에서 M4-core 로 이동하고, 각각 suite-repo M5 스키마를 가리키게 했다.
- report 의 section-count header 가 literal 대신 snapshot 에서 count 를 derive 한다.
- roundtrip 분모가 initiating handoff 만 카운트한다(reverse handoff 는 receiver 의 success signal 이지 새 handoff 가 아니다). 그 결과 canonical forward+reverse happy path 가 `1.0` 을 보고한다.
- roundtrip 카운팅이 receiver semantics 를 강제한다 — child 는 `parent_run_id === handoff.run_id` 와 `producer === handoff.payload.to.producer` 를 모두 만족해야 한다.

### 수정

- per-session glob read 의 symlink 격리가 directory reader 의 realpath boundary check 를 미러링한다. out-of-boundary symlink 은 거절되고 in-tree atomic-swap symlink 은 허용된다.
- merge 된 flat + per-session 항목을 `run_id` 기준으로 dedup 해, double-write 된 envelope 이 frequency / roundtrip 분모 / chain index 를 inflate 하지 않는다.

### 호환성

- Snapshot JSONL 형식 불변: 동일한 16개 metric ID 가 매 snapshot 에 등장한다. plugin 이 실제로 `handoff.json` / `compaction-state.json` 을 emit 하기 전까지 활성화된 3개 메트릭은 `value: null` 을 emit 한다.

### 마이그레이션

- compaction / handoff 이벤트를 dashboard 에 노출하려는 plugin 은 envelope-wrapped artifact 를 `.deep-work/handoffs/*.json`(`artifact_kind: "handoff"`)와 `.deep-work/compaction-states/*.json`(`artifact_kind: "compaction-state"`)에 emit 해야 하며, 둘 다 `schema.version: "1.0"` 이다.

## [1.3.0] — 2026-05-11 (M4 Suite Telemetry Aggregator)

M4 마일스톤 종결: 16 suite-level 메트릭, 시계열 JSONL 누적, markdown trend report, 옵션 OTLP exporter, plugin monitors 에 대한 의도적 HOLD 결정(M4.5 재평가).

### 추가

- `lib/metrics-catalog.yaml` — 16개 suite-level 메트릭의 authoritative 카탈로그(M4-core 12개는 즉시 활성화, 4개는 M5 / M5.5 까지 deferred 되어 source artifact 도달 전까지 `null` emit).
- `lib/suite-collector.js` — legacy collector 가 다루지 않는 source(`deep-review/recurring-findings`, `deep-evolve/evolve-insights`, `deep-wiki/index`)와 NDJSON 이벤트 로그 3종을 envelope-aware 로 수집하며, aggregator-pattern envelope 을 child 와 parent 양쪽에서 제외하는 `parent_run_id` chain 재구성 포함.
- `lib/suite-constants.js` — 6-month legacy-fallback timer(`T+0 = 2026-05-07`, exclusive cutoff `2026-11-07`), per-plugin envelope adoption ledger, `EXPECTED_SOURCES`, `PAYLOAD_REQUIRED_FIELDS` 의 단일 진실원본.
- `lib/aggregator.js` — collector 출력을 소비해 16개 메트릭을 모두 emit(각각 `{ value, unit, tier, source_summary }`). `appendSnapshot()` 가 append-only `.deep-dashboard/suite-metrics.jsonl` 에 기록하고, `readRecentSnapshots(n)` 가 malformed line 을 건너뛰며 최근 records 를 반환.
- `lib/suite-formatter.js` — `.deep-dashboard/suite-report.md` 렌더러. 현재 snapshot 을 이전 record 와 비교해 trend arrow(↑/↓/→/·/?) 출력. Distribution 메트릭은 compact `{ key=n, ... }` literal 로 렌더.
- `.deep-review/reports/*-review.md` 의 verdict 파서 — APPROVE / CONCERN / REQUEST_CHANGES 카운트, ambiguity 시 severity precedence.
- `lib/otel.js` — 옵션 OTLP/HTTP-JSON exporter. `OTEL_EXPORTER_OTLP_ENDPOINT` 가 설정된 경우에만 활성(미설정 시 no-op). 각 non-null M4-core numeric 메트릭을 gauge 로 post(distribution 은 fan-out), 실패는 non-fatal. 신규 의존성 없음 — `globalThis.fetch` 사용.
- `docs/monitor-decision.md` — plugin monitors 의 M4.5 HOLD 결정 기록(defensible threshold 설정에 필요한 baseline data 가 아직 없음; history 누적 후 재평가).

### 변경

- README 기능 리스트가 2 → 3 으로 확장되어 M4 Suite Telemetry 를 호출.
- dashboard skill 에 `--suite` 모드 단계와 11-source 테이블 추가.

### 수정

- hook block/error-rate 메트릭이 `hook-log` source 만 카운트해, rate 를 희석시키던 deep-wiki vault `log.jsonl` 의 ingest 이벤트를 제외한다.
- verdict 파서를 leading-anchored, severity-ordered 스캐너로 재작성해 `APPROVE — no CONCERN raised` 같은 prose 가 오파싱되지 않는다. trend arrow 가 "stable"(`→`)과 "regressed to unknown"(`?`)을 구분한다.

### 마이그레이션

- OTLP export 는 `OTEL_EXPORTER_OTLP_ENDPOINT`(옵션: `OTEL_EXPORTER_OTLP_HEADERS=key=value,...`)만 설정하면 되고 코드 변경이 필요 없다.
- `package.json.version` 은 local 도구를 위해 `plugin.json` 과 lockstep 으로 bump 될 뿐 — `plugin.json.version` 이 단일 진실원본이다.

## [1.2.0] — 2026-05-07 (M3 cross-plugin envelope)

### 변경

- `.deep-dashboard/harnessability-report.json` 이 이제 claude-deep-suite M3 cross-plugin envelope 으로 wrap 된다: top-level `schema_version: "1.0"` + `envelope` 블록 + `payload`. domain data 는 이제 `.payload.*`(`total`, `grade`, `dimensions`, `recommendations`, …)에 위치한다.
- scorer CLI 가 stdout 으로 envelope JSON 을 출력(디스크 파일과 동일)하고, `saveReport()` 가 `{ path, envelope }` 를 반환해 호출자가 파일을 다시 읽지 않고 envelope 을 전달할 수 있다.
- collector 가 M3 envelope-aware 로 전환: envelope 래퍼를 감지하고 identity 가드(producer / artifact_kind / schema.name)를 강제한 뒤 inner payload 를 unwrap 한다. legacy 비래핑 artifact 는 통과하고, identity 불일치 envelope 은 stderr 경고와 함께 `null` 처리된다.

### 추가

- `scripts/validate-envelope-emit.js` + `npm run validate:envelope` — zero-dep envelope contract self-test(ULID / SemVer 2.0.0 / kebab-case / RFC 3339, identity check, payload shape).
- `tests/fixtures/sample-harnessability-report.json` — envelope-wrapped sample emit.

### 마이그레이션

- `harnessability-report.json` shape 의 내부 **breaking change**: `report.total` 을 직접 읽던 외부 reader 는 `report.payload.total` 을 읽어야 한다. 24시간 staleness 규칙이 자연 invalidation 을 제공한다.
- 알려진 cross-plugin consumer: deep-work Phase 1 Research 가 이 report 를 소비한다.

## [1.1.1] — 2026-04-17

v1.1.0 리뷰에서 드러난 결함을 해결한 패치 릴리스.

### 수정

- `isTypeScript` 가 단순 `package.json` 존재만으로 true 가 되지 않는다. TS 전용 체크는 `tsconfig.json` 이 있을 때만 적용되어 순수 JS 및 프론트엔드 툴링을 가진 Python 프로젝트가 불이익을 받지 않는다.
- 권고가 `not_applicable` 체크를 제외한다 — TS 프로젝트에 "Python 타입 힌트 추가" 같은 이종 생태계 noise 가 없다.
- scorer CLI 엔트리 추가 — `node scorer.js <project>` 가 이제 JSON 을 출력하고 `.deep-dashboard/harnessability-report.json` 을 저장한다(이전엔 출력 없이 종료).
- 렌더링 헬퍼 전반에 `undefined`/`NaN` 가드 추가; `NaN` trajectory 항목은 `?` 로 렌더된다.
- Markdown 테이블이 모든 interpolation 셀에서 `|` 를 이스케이프해 session sensors, transfer ID, finding 문자열이 테이블 구조를 깨뜨리지 않는다.
- `readJsonDir` 가 스캔 디렉터리 내부에 한해 symlink 를 따라간다(prefix 체크 대신 realpath 봉쇄). 프로젝트 외부 ingest 와 sibling-prefix 우회를 차단하고, 깨진/경계 밖 링크는 경고와 함께 skip 한다.
- action-router 런타임 문자열을 영어로 번역.

### 변경

- README 효과성 표를 100% 가 되는 5차원으로 정정(Health 25% / Fitness 20% / Session 20% / Harnessability 15% / Evolve 20%); 아키텍처 다이어그램이 deep-evolve 를 네 번째 입력 소스로 표시.
- `skills/deep-harnessability.md` 가 미해결 리터럴 대신 문서화된 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` env var 를 사용.
- `.claude-plugin/plugin.json` 버전 정정(1.0.0 에 stale 이었음).

## [1.1.0] — 2026-04-14

### 추가

- 크로스 플러그인 피드백(Phase 3B): `collectDeepEvolve()` 를 통한 deep-evolve receipt 소비, weight redistribution 을 포함한 `evolve` 효과성 차원(가중치 0.20), 5개 감지 규칙(low-keep, high-crash, low-q, stale, no-transfer)을 가진 `extractEvolveFindings()`.
- CLI 및 Markdown 포맷터 출력에 Evolve 섹션.
- 크로스 플러그인 스키마 검증용 contract test fixture.

## [1.0.0] — 2026-04-09

### 추가

- Harnessability 진단: 17개 계산 기반 detector 를 갖춘 6차원 채점 엔진, 생태계 인식 Type Safety 채점(TS/Python `not_applicable` 처리).
- 통합 Dashboard: 효과성 점수(최근 3세션 평균)와 `generated_at` staleness 검사를 포함한 크로스 플러그인 데이터 집계.
- 액션 라우팅: finding 유형별 `suggested_action`.
- CLI 테이블 + markdown 보고서 출력.
- `/deep-harnessability` 와 `/deep-harness-dashboard` skills.
