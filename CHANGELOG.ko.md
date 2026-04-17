[English](./CHANGELOG.md) | **한국어**

# 변경 이력

## [1.1.1] — 2026-04-17

2026-04-17 ultrareview에서 드러난 v1.1.0의 결함 및 후속 polish를 해결한 패치 릴리스.

### 수정
- **`scorer.js`의 `isTypeScript`**가 단순 `package.json` 존재만으로 true가 되지 않도록 축소. TS 전용 체크는 `tsconfig.json`이 있을 때만 적용. 순수 JS 및 프론트엔드 툴링을 가진 Python 프로젝트가 더 이상 불이익을 받지 않음.
- **`scorer.js` 권고 루프**에서 `not_applicable` 체크 제외 — TS 프로젝트에 "Python 타입 힌트 추가" 같은 이종 생태계 권고가 더 이상 발생하지 않음.
- **`scorer.js` CLI 엔트리** 추가. 기존에는 스킬 명령 `node scorer.js <project>`가 출력 없이 종료됐으나, 이제 JSON을 stdout으로 출력하고 스킬이 약속한 대로 `.deep-dashboard/harnessability-report.json`을 저장함.
- **`formatter.js` undefined 가드**를 `centerLine`, `renderHealth`, `renderActions`에 적용. `pad()`와 `stripAnsi()` 헬퍼도 입력을 방어적으로 coerce하여 미래 호출자가 크래시 경로를 재도입할 수 없음.
- **`formatter.js` NaN 처리**: `q_trajectory`의 `NaN` 항목이 `NaN` 문자열 리터럴 대신 `?`로 렌더링됨.
- **`formatter.js` Markdown 테이블**: 모든 interpolation 셀(Health, Fitness, Sessions, Evolve)에 `|` 문자 이스케이프. 세션 sensors, transfer ID, finding 문자열이 테이블 구조를 깨뜨리지 않음.
- **`collector.js`의 `readJsonDir`**가 스캔 디렉토리 내부 대상에 한해 심볼릭 링크를 안전하게 따라감. 순진한 `startsWith` prefix 체크 대신 `fs.realpathSync` + `path.relative` 봉쇄 검사를 사용해 프로젝트 외부 ingest 및 sibling-prefix 우회(`.deep-work/receipts-old/`가 `.deep-work/receipts` 스캔을 통과하던 문제)를 모두 차단. 깨진 링크와 경계 밖 링크는 가시적 경고와 함께 skip.
- **`action-router.js` 런타임 문자열** 영어 번역 (keep-rate, crash-rate, stale-receipt, no-transfer `detail` 필드가 phase-3 통합 당시부터 부분 한국어였음).

### 변경
- **`README` 효과성 표**를 100%가 되는 5차원으로 정정: Health 25% / Fitness 20% / Session 20% / Harnessability 15% / Evolve 20%. 이전 표는 4개 행에 잘못된 가중치(30/25/25/20)였음.
- **`README` 아키텍처 다이어그램**이 `deep-evolve`를 네 번째 입력 소스로 표시.
- **`README` evolve 섹션**: 영문 README의 한국어 파편 번역, `evolve-low-q` 규칙 명확화("최근 3개 `q_trajectory` 값 중 가장 오래된 값이 가장 최근 값보다 0.05 초과"), `transfer.received_from` 스키마를 `non-empty string | null`로 문서화.
- **`skills/deep-harnessability.md`** 리터럴 `PLUGIN_DIR` / `PROJECT_ROOT` 대신 Claude Code 문서화 env var `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` 사용.
- **`action-router.test.js`**가 엄격-배타 임계값 동작(`keep_rate < 0.15`, `crash_rate > 0.20`)을 고정하여 미래 리팩터링이 부호를 조용히 뒤집지 못하도록 함.
- **`.claude-plugin/plugin.json`**이 1.0.0에 stale — `package.json`과 동기화.

### 비고
- Ultrareview M1 (falsy `received_from`의 `evolve-no-transfer`) won't-fix로 종결: 문서화된 스키마에서 `0`과 `""`는 유효한 값이 아니므로 원 보고 시나리오는 도달 불가.
- 테스트 수: 45 → 58 (+13 회귀 테스트 — scorer, formatter, action-router, collector에 분포).

## [1.1.0] — 2026-04-14

### 추가
- **크로스 플러그인 피드백 (Phase 3B):**
  - `collectDeepEvolve()` — evolve-receipt.json 수집
  - `evolve` 차원 (가중치 0.20) effectiveness 점수에 추가
  - `extractEvolveFindings()` — 5개 감지 규칙 (low-keep, high-crash, low-q, stale, no-transfer)
  - `evolve-low-q`: 최근 3개 `q_trajectory` 값 중 가장 오래된 값이 가장 최근 값보다 0.05 초과로 높을 때 발생 (최근 3-point 윈도우가 하락 추세).
  - CLI 및 Markdown 포맷터에 Evolve 섹션 표시
  - `action-router.test.js` 신규 테스트 파일
  - 크로스 플러그인 스키마 검증용 contract test fixture

## 1.0.0 (2026-04-09)

### 추가
- Harnessability 진단: 17개의 계산 기반 detector를 갖춘 6차원 채점 엔진
- 통합 Dashboard: 효과성 점수를 포함한 크로스 플러그인 데이터 집계
- 액션 라우팅: finding 유형별 suggested_action
- CLI 테이블 + markdown 보고서 출력
- /deep-harnessability 및 /deep-harness-dashboard skills

### 아키텍처
- 생태계 인식 type_safety 채점 (TS/Python not_applicable 처리)
- 최근 3개 세션 효과성 평균 산출
- 오래됨 검사를 위한 generated_at 타임스탬프
- 커스텀 topology를 위한 deep merge 지원
