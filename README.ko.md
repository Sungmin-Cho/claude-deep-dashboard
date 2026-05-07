[English](./README.md) | **한국어**

# deep-dashboard

[deep-suite](https://github.com/sungmin/deep-suite) 생태계를 위한 크로스 플러그인 harness 진단 도구.

deep-dashboard는 두 가지 기능을 제공합니다:

1. **Harnessability 진단** — 코드베이스의 "harness 가능성"을 6개 차원으로 완전히 계산하여 0–10점 점수와 실행 가능한 권장 사항을 제공합니다.
2. **통합 Dashboard** — deep-work, deep-review, deep-docs의 sensor 수신 데이터를 단일 효과성 뷰로 집계하고 액션 라우팅을 제공합니다.

---

### 하네스 엔지니어링에서의 역할

deep-dashboard는 [Deep Suite](https://github.com/Sungmin-Cho/claude-deep-suite) 생태계의 **하네스 진단 레이어**로, [Harness Engineering](https://martinfowler.com/articles/harness-engineering.html) 프레임워크의 두 가지 개념을 구현합니다:

- **Harnessability 평가**: 코드베이스의 "하네스 가능성"을 정량적으로 측정 — 6차원, 17개 computational detector, 0-10 점수. 프레임워크는 이 개념을 정성적으로만 서술하지만, deep-dashboard는 구체적 도구로 구현.
- **Human Steering Loop**: [deep-work](https://github.com/Sungmin-Cho/claude-deep-work), [deep-review](https://github.com/Sungmin-Cho/claude-deep-review), [deep-docs](https://github.com/Sungmin-Cho/claude-deep-docs)의 센서 결과를 통합하여 단일 effectiveness 점수 + 액션 라우팅으로 제공 — 프레임워크가 요구하는 피드백 루프를 닫음.

2×2 매트릭스에서 deep-dashboard는 Continuous 타이밍 밴드의 **Computational Sensor**로 동작 — 개발 라이프사이클 밖에서 하네스 효과성을 시간에 걸쳐 측정합니다.

---

## 설치

프로젝트 루트에서 Claude Code 플러그인으로 설치:

```bash
claude plugin install path/to/deep-dashboard
```

또는 registry에 게시된 경우:

```bash
claude plugin install @deep-suite/deep-dashboard
```

설치 후 두 가지 skill이 모든 Claude Code 세션에서 사용 가능합니다:
- `/deep-harnessability`
- `/deep-harness-dashboard`

---

## 기능

### Harnessability 진단

17개의 순수 계산 기반 detector(파일 및 설정 확인만 — 네트워크 호출 없음, LLM 추론 없음)를 사용하여 6개 차원에서 코드베이스 준비 상태를 평가합니다.

| 차원 | 가중치 | 확인 항목 |
|---|---|---|
| Type Safety | 25% | TypeScript strict 모드, tsconfig.json, mypy strict, py.typed / .pyi stubs |
| Module Boundaries | 20% | dependency-cruiser 설정, 정돈된 src/lib/app 디렉토리, index entry-point 파일 |
| Test Infrastructure | 20% | 테스트 프레임워크 설치 여부, 테스트 파일 존재 여부, coverage 설정 |
| Sensor Readiness | 15% | Linter 설정, type-checker 사용 가능 여부, lock 파일 존재 여부 |
| Linter & Formatter | 10% | Linter 설정 파일, formatter 설정 (Prettier / Biome / EditorConfig) |
| CI/CD | 10% | CI 설정 존재 여부 (.github/workflows, .gitlab-ci.yml, .circleci), CI 테스트 실행 여부 |

**채점 모델**

각 차원은 통과한 검사 항목의 비율에 따라 0–10점을 부여합니다. 생태계와 무관한 검사 항목은 `not_applicable`으로 표시되어 해당 차원의 분모에서 제외됩니다(예: Python 전용 프로젝트에서의 TypeScript 검사). 최종 점수는 모든 차원 점수의 가중 평균이며 소수점 첫째 자리로 반올림됩니다.

| 등급 | 점수 |
|---|---|
| Excellent | 8.0–10.0 |
| Good | 5.0–7.9 |
| Fair | 3.0–4.9 |
| Poor | 0.0–2.9 |

보고서는 `.deep-dashboard/harnessability-report.json` 에 [claude-deep-suite M3
cross-plugin envelope](https://github.com/Sungmin-Cho/claude-deep-suite/blob/main/docs/envelope-migration.md)
형식으로 저장됩니다 (`schema_version: "1.0"` + `envelope` 블록 + `payload`).
domain data 는 `.payload.*` 위치 (`total`, `grade`, `dimensions`,
`recommendations`). envelope identity:
`(producer=deep-dashboard, artifact_kind=harnessability-report, schema.name=harnessability-report)`.

다음에서 사용됩니다:
- **deep-work** Phase 1 Research (파일이 존재하고 24시간 이내인 경우) — envelope-aware
- `/deep-harness-dashboard` (5개 효과성 입력 중 하나로) — collector unwrap 을 통해 envelope-aware

**권장 사항**

5점 미만인 차원의 실패한 검사 항목은 권장 사항 목록에 포함됩니다. Skill은 예상 영향도와 함께 상위 3개를 표시합니다.

---

### 통합 Dashboard

설치된 모든 v1 플러그인의 데이터를 단일 터미널 뷰 또는 markdown 보고서로 집계합니다.

**데이터 소스 (v1 지원 플러그인)**

| 플러그인 | 읽는 데이터 | 위치 |
|---|---|---|
| deep-work | Slice receipts, session receipt | `.deep-work/receipts/*.json`, `.deep-work/session-receipt.json` |
| deep-review | Review receipts, fitness rules | `.deep-review/receipts/*.json`, `.deep-review/fitness.json` |
| deep-docs | 마지막 문서 스캔 | `.deep-docs/last-scan.json` |
| deep-dashboard | Harnessability 보고서 | `.deep-dashboard/harnessability-report.json` |

Collector 는 방어적으로 읽습니다 — 파일이 없으면 예외를 던지지 않고 `null` 을 반환합니다.

Collector 는 **M3 envelope-aware** 입니다. 각 artifact 소스에 대해
[claude-deep-suite cross-plugin envelope](https://github.com/Sungmin-Cho/claude-deep-suite/blob/main/docs/envelope-migration.md)
(`schema_version === "1.0"` + `envelope` 블록 + `payload`)을 감지하고,
identity 가드 (`producer` / `artifact_kind` / `schema.name`)를 강제한 뒤,
unwrap 된 `payload` 만 effectiveness scorer 와 formatter 에 노출합니다.
legacy (un-wrapped) artifact 는 그대로 통과. identity 불일치 envelope 은
stderr 경고와 함께 `null` 처리 (defense-in-depth). envelope-aware 소스:
`last-scan.json`, `harnessability-report.json` (self), `session-receipt.json`,
`receipts/SLICE-*.json`, `evolve-receipt.json`. `.deep-review/fitness.json`
와 `.deep-review/receipts/*.json` 는 legacy read 유지 — `recurring-findings.json`
이 deep-review 의 M3 artifact 이며 dashboard 는 그것을 현재 소비하지 않습니다.

**효과성 점수**

5개의 가중 차원으로 0–10점의 단일 효과성 점수를 계산합니다:

| 차원 | 가중치 | 소스 |
|---|---|---|
| Health | 25% | deep-review fitness 데이터의 `sensors_clean_ratio` |
| Fitness | 20% | `.deep-review/fitness.json`의 `rules_pass_ratio` |
| Session | 20% | 최근 3개 deep-work receipt의 평균 `quality_score` (0–100 정규화 → 0–10) |
| Harnessability | 15% | `.deep-dashboard/harnessability-report.json`의 `total` |
| Evolve | 20% | `.deep-evolve/evolve-receipt.json`의 `quality_score` (0–100 정규화 → 0–10) |

차원에 데이터가 없으면 해당 가중치가 사용 가능한 차원에 비례적으로 재분배됩니다. 데이터가 전혀 없는 경우 효과성 점수는 `N/A`입니다.

**액션 라우팅**

Fitness rules, review receipts, docs 오래됨 검사의 결과가 `suggested_action` 문자열로 매핑됩니다:

| Finding 유형 | 카테고리 | 권장 액션 |
|---|---|---|
| `dependency-vuln` | health | `npm audit fix` |
| `dead-export` | health | 미사용 export 제거 또는 health-ignore.json에 추가 |
| `stale-config` | health | 잘못된 config 참조 수정 |
| `coverage-trend` | health | 다음 deep-work 세션에서 테스트 추가 |
| `file-metric` | fitness | deep-work 세션에서 대용량 파일 분리 |
| `forbidden-pattern` | fitness | 금지된 패턴 제거 |
| `structure` | fitness | 같은 위치에 테스트 파일 추가 |
| `dependency` | fitness | 의존성 제약 수정 |
| `docs-stale` | docs | `/deep-docs-scan` 실행 |

**출력 형식**

- **CLI 테이블** — 터미널에 직접 렌더링되는 박스 드로잉 ASCII 테이블
- **Markdown 보고서** — 요청 시 프로젝트 루트에 `harness-report-YYYY-MM-DD.md` 파일 저장

#### deep-evolve 연동 (v1.1)

- **데이터 소스**: `.deep-evolve/evolve-receipt.json`
- **Effectiveness 차원**: `evolve` (가중치 0.20) — `quality_score` (0-100)를 0-10으로 정규화
- **감지 규칙** (5개):
  - `evolve-low-keep`: keep rate 15% 미만 → 전략 개선 권장
  - `evolve-high-crash`: crash rate 20% 초과 → eval harness 점검
  - `evolve-low-q`: 최근 3개 `q_trajectory` 값 중 가장 오래된 값이 가장 최근 값보다 0.05 초과로 높을 때 발생 (최근 3-point 윈도우가 하락 추세) → 전략 검토
  - `evolve-stale`: receipt 30일 이상 경과 → 추가 실험 권장
  - `evolve-no-transfer`: 전이 학습 미활용 → meta-archive 구축 권장
- **포맷터**: CLI 및 Markdown 출력에 Evolve 섹션 표시 (폐기된 세션은 별도 표시)

**스키마 참고**
- `transfer.received_from`: `non-empty string | null`. 빈 문자열이나 숫자 센티널은 스키마에 포함되지 않음. `null`은 전이 학습이 수신되지 않음을 의미.

---

## Skills

### `/deep-harnessability`

현재 프로젝트에 대해 harnessability scorer를 실행하고 막대 차트 보고서를 표시합니다.

```
/deep-harnessability
```

출력 예시:

```
[Harnessability Report] Score: 7.2/10 (Good)

  Type Safety      ████████░░  8/10  ✓ tsconfig strict mode
  Module Bounds    ██████░░░░  6/10  ! 1 item needs attention
  Test Infra       ███████░░░  7/10  ! no coverage config found
  Sensor Ready     ████████░░  8/10  ✓ lint, typecheck, lock file
  Linter/Fmt       ████░░░░░░  4/10  ! no prettier/format config
  CI/CD            ██████████ 10/10  ✓ CI runs tests
```

5점 미만인 차원은 예상 영향도와 함께 상위 3개의 권장 사항이 이어서 표시됩니다. 보고서는 `.deep-dashboard/harnessability-report.json`에 저장됩니다.

---

### `/deep-harness-dashboard`

사용 가능한 모든 플러그인 데이터를 집계하여 통합 dashboard를 렌더링합니다.

```
/deep-harness-dashboard
```

JSON 출력 포함:

```
/deep-harness-dashboard --json
```

이 skill은:
1. 사용 가능한 모든 v1 플러그인에서 데이터를 수집합니다.
2. 보고서가 없거나 오래된 경우 `/deep-harnessability`를 실행합니다.
3. 효과성 점수를 계산합니다.
4. CLI dashboard를 렌더링합니다.
5. 선택적으로 markdown 보고서(`harness-report-YYYY-MM-DD.md`)를 생성하고 커밋을 제안합니다.

CLI 출력 예시:

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

---

## 아키텍처

deep-dashboard는 deep-suite 생태계의 **읽기 전용 소비자**입니다. 다른 플러그인의 출력 디렉토리에 절대 쓰지 않습니다.

```
deep-work   ──┐
              │
deep-review ──┤
              ├──► deep-dashboard (collector → effectiveness → formatter)
deep-docs   ──┤         │
              │         └──► .deep-dashboard/harnessability-report.json
deep-evolve ──┘
```

Harnessability scorer는 대상 프로젝트의 `.deep-dashboard/` 안에만 씁니다. 그 외 모든 읽기는 각 플러그인의 출력 디렉토리(`.deep-work/`, `.deep-review/`, `.deep-docs/`)에서 이루어집니다.

Scorer, collector, 효과성 계산기, 액션 라우터, formatter는 모두 외부 런타임 의존성이 없는 순수 Node.js ESM 모듈입니다.

---

## v1 범위

**지원 플러그인:** deep-work, deep-review, deep-docs.

**v2로 이연:**
- 추론 기반 리뷰 (LLM 보조 harnessability 힌트)
- `changedFiles` 범위 지정 (현재 세션에서 변경된 파일만 채점)
- deep-wiki 및 deep-research 데이터 계약
