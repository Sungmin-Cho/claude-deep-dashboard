[English](./CHANGELOG.md) | **한국어**

# 변경 이력

## [1.1.0] — 2026-04-14

### 추가
- **크로스 플러그인 피드백 (Phase 3B):**
  - `collectDeepEvolve()` — evolve-receipt.json 수집
  - `evolve` 차원 (가중치 0.20) effectiveness 점수에 추가
  - `extractEvolveFindings()` — 5개 감지 규칙 (low-keep, high-crash, low-q, stale, no-transfer)
  - Q(v) 하락 감지 (delta > 0.05 노이즈 필터)
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
