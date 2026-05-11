[English](./CHANGELOG.md) | **한국어**

# 변경 이력

## [1.3.1] — 2026-05-11 — M5 활성화: handoff + compaction-state 메트릭

`claude-deep-suite` PR #11/#12/#13 (2026-05-11 머지)에서 `handoff` 와
`compaction-state` payload 스키마가 ratified되어, M4-deferred 메트릭 4개 중
3개를 활성화한다. 4번째 deferred 메트릭 (`suite.tests.coverage_per_plugin`)
은 source (`ci-status-aggregate`) 가 M5 스키마 작업과 독립적이라 M5.5 까지
유지된다.

단일 PR, backward-compatible additions only.

### Round 1 review 반영 (3-way: Opus + Codex review + Codex adversarial)

`/deep-review` 의 C1 (3-way 일치) + W1 (Opus 단독) 동일 PR 내 처리.
Round 1 에서 dashboard 의 source 선언을 suite 가이드가 묘사하는 실제
producer 표면과 정렬.

- **C1 (3-way) — Handoff 메트릭 발견 계약**:
  - `EXPECTED_SOURCES` 13 → 15: `(deep-evolve, handoff)` 와
    `(deep-evolve, compaction-state)` 추가. Reverse handoff
    (`handoff_kind: "evolve-to-deep-work"`) 은 `long-run-handoff.md` §4.3
    에 따라 deep-evolve 가 emit; compaction-state 도 epoch boundary 에서
    deep-evolve emit (`context-management.md` §6).
  - 신규 collector cardinality `dir+session-glob`: 각 (producer, kind)
    소스가 flat aggregation dir
    (`.deep-<plugin>/<kind-plural>/*.json`) AND per-session subdir
    (`.deep-<plugin>/<session>/<kind-singular>.json`) 양쪽 스캔. suite
    문서에 등장하는 두 layout 을 producer 측 중복 emit 없이 흡수.
  - `computeHandoffRoundtripSuccessRate` 와 compaction 메트릭 2개가
    `(*, handoff)` / `(*, compaction-state)` 모든 소스를 cross-producer 로
    집계.
  - `*_producers` 배열을 `source_summary` 에 노출 (drill-down).
  - end-to-end fixture pair: `handoff.fixture.json` +
    `evolve-receipt-roundtrip.fixture.json` (`parent_run_id` 로 chain back)
    + 신규 e2e 테스트 가 happy path 에서 `roundtrip_success_rate === 1.0`
    검증.
- **W1 (Opus) — Roundtrip 메트릭의 aggregator-kind 제외**:
  - `AGGREGATOR_KINDS` 를 `suite-collector.js#_internal` 에서
    `suite-constants.js` 의 top-level export 로 승격 (shared single
    source of truth).
  - `computeHandoffRoundtripSuccessRate` 가 `childrenByParent` 빌드 시
    aggregator-kind envelope (`harnessability-report`, `evolve-insights`,
    `index`) 을 skip — catalog 계약 ("downstream non-aggregator envelope's
    parent_run_id chains back") 과 `reconstructChains` 의 기존 제외 로직
    미러링.
- **I1 — `missing_signal_ratio` source_summary**: literal `expected_total: 13`
  을 `EXPECTED_SOURCES.length` 로 교체, 다음 활성화 사이클에서 magic
  number drift 방지.

테스트 카운트: 188 → 201 (+13 round-1 리뷰 테스트: per-session subdir
발견, flat+session merge no-double-count, hidden-dir skip, reverse
handoff identity validation, aggregator-kind 제외, happy path fixture
pair).

### Round 2 review 반영 (3-way: Opus + Codex review + Codex adversarial)

- **C2 (Codex review P2 — security)** `readSessionGlob` 의 symlink 격리.
  이전 구현은 `readJsonSafe` 로 symlink 를 따라가면서 `readJsonDir` 가
  enforce 하는 realpath boundary check 를 누락. 악의적 `.deep-work/
  <session>/handoff.json` symlink 가 프로젝트 root 외부를 가리키면 forged
  JSON 을 valid M5 envelope 으로 ingest 가능. Fix 는 `readJsonDir` 패턴
  미러; out-of-boundary symlink 은 `out-of-boundary-symlink` reason 으로
  거절. in-tree symlink (atomic-swap 패턴) 은 계속 허용.
- **W2 (Codex adversarial MEDIUM)** `computeHandoffRoundtripSuccessRate`
  가 guide §7 의 receiver semantics 를 enforce 하도록 강화. child
  envelope 이 (a) `parent_run_id === handoff.run_id` 그리고 (b)
  `child.envelope.producer === handoff.payload.to.producer` 두 조건을
  모두 만족해야 함. 이전에는 임의의 non-aggregator child 가 카운트되어,
  sender 자신이 emit 한 follow-up artifact 가 handoff 를 falsely
  roundtripped 로 marking 가능했음.
- **W3 (Codex P3 + Opus Info-2, 2-way)** `source_summary.handoff_producers`
  와 `compaction_producers` 가 non-empty envelopes 를 가진 source 만
  필터링 — forward handoff 만 emit 하는 프로젝트에서 빈 deep-evolve
  source 가 drill-down 에 등장하지 않음.
- **I5 (Opus Info-1)** `suite-collector.test.js` 의 stale "// All 13
  expected sources missing" 주석을 "All 15" 로 업데이트.
- **I6 (Opus Info-3)** `readSessionGlob` 의 docstring 에 session 이름
  convention (`<date>-<slug>`, long-run-handoff.md §4.1) 및 flat-aggregation
  dirname 충돌 시 의도적 skip 명시.

테스트 카운트: 201 → 209 (+8 round-2 테스트: out-of-tree symlink 거절,
broken symlink 거절, in-tree symlink 허용, unrelated-sender child 거절
(W2 negative), receiver-produced child 카운팅 (W2 positive), payload.to
누락 defensive path, handoff + compaction 양쪽 W3 symmetric 테스트).

### Round 3 review 반영 (3-way: Opus + Codex review + Codex adversarial)

- **C3 (Codex adversarial HIGH)** Reverse handoff 이 denominator 를
  부풀림. `long-run-handoff.md` §7 에 따르면 reverse handoff (다른
  handoff 의 `run_id` 로 chain 되는 handoff) 는 upstream handoff 의
  receiver 측 success signal 이지, 자체 child 가 필요한 fresh
  initiating handoff 이 아님. Round-2 는 모든 handoff 를 denominator
  에 포함시켜 canonical happy path (forward + reverse) 가 50% 로
  capping — operator dashboard 에 materially misleading.
  Fix: denominator = INITIATING handoff 만 (parent_run_id 없거나
  다른 handoff 의 run_id 로 chain 되지 않는 경우). `source_summary`
  에 `handoffs_continuation` drill-down 노출. canonical happy path 가
  이제 정확히 1.0 보고.
- **W4 (Codex review P2)** `dir+session-glob` merge 가 flat +
  per-session 항목을 `run_id` 기준 dedup 없이 concatenate. Producer 가
  양 layout 에 같은 envelope 을 emit 시 (transitional period, accidental
  double-write) `compaction.frequency`, `roundtrip` denominator,
  `chains` index 모두 inflate.
  Fix: source 내 `envelope.run_id` 기준 dedup. 충돌 시 flat 우선
  (먼저 scan), 두 번째 instance 는 producer 디버깅용
  `duplicate-run-id` failure 로 기록.
- **I7 (Opus Info-1)** Metrics catalog 의 `description` + `aggregation`
  문자열을 round-2 W2 receiver-filter + round-3 C3 initiating-handoff
  denominator 반영. `null_when` 명확화.
- **I8 (Opus Info-2)** `Object.freeze(new Set(...))` 은 Set mutation 에
  no-op. freeze 제거 + convention 주석 추가; `const` reference 만으로
  충분.
- **I9 (Opus Info-3)** symlinked-SUBDIR 거절 테스트 추가 (round-2
  symlinked-FILE 테스트의 sibling — 같은 방어, 다른 attack vector).
- **I10 (Opus Info-4)** broken-symlink 테스트 주석 명확화 — 거절은
  `pathExists` short-circuit (realpath check 아님) 에서 발생. 명시적
  `failures.length === 0` assertion 추가.

테스트 카운트: 209 → 214 (+5 net: 3 신규 C3 테스트 (multi-ack,
new-task-via-reverse, all-continuations-degenerate); 1 W4 dedup 테스트;
1 I9 symlinked-subdir 테스트; 2 기존 테스트가 새 C3 semantic 으로 업데이트).

### 추가
- **`lib/suite-constants.js`** — `EXPECTED_SOURCES` 에 envelope tuple 2개
  (`deep-work / handoff`, `deep-work / compaction-state`) 추가, 대시보드의
  `missing_signal_ratio` 분모를 11 → 13 으로 확장. `PAYLOAD_REQUIRED_FIELDS`
  는 각 스키마의 `required[]` 를 1:1 미러링:
  - `deep-work/handoff`: `schema_version`, `handoff_kind`, `from`, `to`,
    `summary`, `next_action_brief`.
  - `deep-work/compaction-state`: `schema_version`, `compacted_at`, `trigger`,
    `preserved_artifact_paths`.
- **`lib/suite-collector.js`** — `SOURCE_SPECS` 에 항목 2개 추가
  (`.deep-work/handoffs/*.json`, `.deep-work/compaction-states/*.json`,
  cardinality `dir`). 기존 `.deep-work/receipts/` flat-dir 패턴을 미러링.
- **`lib/aggregator.js`** — compute 함수 3개 추가:
  - `computeCompactionFrequency`: compaction-state envelope 총 개수;
    `source_summary` 에 `unique_sessions` 노출 (세션별 drill-down).
  - `computeCompactionPreservedArtifactRatio`: per-envelope ratio
    `preserved / (preserved + discarded)` 의 평균.
    `claude-deep-suite/guides/context-management.md` §5 에 따라
    `discarded_artifact_paths` 누락 envelope 은 UNDEFINED (평균에서 제외),
    full-reset (preserved + discarded 모두 빈 배열) 도 제외.
  - `computeHandoffRoundtripSuccessRate`:
    `claude-deep-suite/guides/long-run-handoff.md` §7 — 임의의 non-aggregator
    envelope 의 `parent_run_id` 가 handoff 의 `run_id` 로 chain back 하면
    round-trip 으로 카운트. reverse-handoff + downstream-receipt 양쪽 커버.
- **`lib/metrics-catalog.yaml`** — M5 활성화 3건을 M4-deferred 블록에서
  "M5-activated" 블록으로 이동; 각각 새 source path + suite-repo M5 스키마
  를 가리키는 schema_id 부착.
- **`test/fixtures/{handoff,compaction-state}.fixture.json`** — M5 스키마를
  미러링한 canonical envelope-wrapped fixture; `lib/aggregator.test.js` 의
  end-to-end activation 테스트에서 소비.
- 신규 테스트 16개 (`suite-constants.test.js`, `suite-collector.test.js`,
  `aggregator.test.js`): EXPECTED_SOURCES 확장, payload required field
  reject 경로, per-metric 공식 (frequency / preserved ratio / roundtrip),
  undefined-when-discarded 경로, full-reset 경로, reverse-handoff 경로,
  fixture 기반 end-to-end 활성화 검증.

### 변경
- **`plugin.json.version`** + **`package.json.version`** 1.3.0 → 1.3.1.
- **`lib/suite-formatter.js`** — section header (`## M4-core metrics (N)`,
  `## M4-deferred metrics (N)`) 의 `N` 을 literal 이 아니라 snapshot 에서
  derive. 향후 마일스톤 활성화 시 hard-coded 문자열을 재편집할 필요 없음.
  sub-heading 텍스트 "M5 / M5.5" → "M5.5" 로 축약 (활성화 이후 상태 반영).
- **`lib/aggregator.js`** — `M4_DEFERRED_METRICS` 상수를 4개 → 1개로 축소
  (`suite.tests.coverage_per_plugin`, M5.5 만 잔존). M5 gated 3개는 실제
  compute 함수로 라우팅; tier `M4-deferred` → `M4-core`.
  `missing_signal_ratio` source_summary 의 `expected_total` 11 → 13.

### 호환성 노트
- Snapshot JSONL 형식 불변: 동일한 16개 metric ID 가 매 snapshot 에 등장.
  활성화된 3개의 `tier` 필드는 `M4-deferred` → `M4-core` 로 변경, 해당
  엔트리의 `deferred_until` 필드는 제거 — 이전 JSONL 레코드는 formatter
  의 tier 분기를 통해 그대로 파싱.
- Producer 측 채택은 독립적: 플러그인이 실제로 `handoff.json` /
  `compaction-state.json` 을 emit 하기 전까지, 활성화된 3개 metric 은
  `value: null` (greenfield 경로) 을 emit. 기존 consumer 의 값 형태에는
  변화 없음.

### 마이그레이션 노트
- compaction / handoff 이벤트를 대시보드에 노출하려는 플러그인은
  envelope-wrapped artifact 를 다음 경로에 emit 해야 한다:
  - `.deep-work/handoffs/*.json` (artifact_kind = "handoff",
    schema.name = "handoff", schema.version = "1.0")
  - `.deep-work/compaction-states/*.json` (artifact_kind = "compaction-state",
    schema.name = "compaction-state", schema.version = "1.0")
  producer 채택 ledger 는 suite repo `docs/envelope-migration.md` §6 추적.

---

## [1.3.0] — 2026-05-11 — M4 Suite Telemetry Aggregator

M4 마일스톤 종결 (`claude-deep-suite/docs/deep-suite-harness-roadmap.md` §M4). 16 suite-level metric, 시계열 JSONL 누적, markdown trend report, 옵션 OTLP exporter, plugin monitors 의 의도적 "HOLD" 결정 (M4.5 재평가).

이 릴리스는 3개 PR 통합:
- PR 1 #5 — `lib/metrics-catalog.yaml` + `lib/suite-collector.js` + `lib/suite-constants.js`.
- PR 2 #6 — `lib/aggregator.js` + `lib/suite-formatter.js`.
- PR 3 #7 — `lib/otel.js` + `docs/monitor-decision.md` + version bump + 문서 갱신.

### 추가 (PR 3/3 — §4.5 + §4.6 + §4.7)
- **`lib/otel.js`** — Optional OTLP/HTTP-JSON exporter. `OTEL_EXPORTER_OTLP_ENDPOINT` 가 설정된 경우에만 활성, 미설정 시 no-op (기본 M4 출력 경로는 JSONL + markdown 유지). 각 non-null M4-core numeric metric → gauge data point. Distribution metric `suite.review.verdict_mix` 은 3개 gauge 로 fan-out. M4-deferred metric (null) 은 skip. 실패는 non-fatal: `{ exported: false, reason }` 반환. 신규 의존성 없음 — `globalThis.fetch` + OTLP/HTTP-JSON body 사용. Resource attributes: `service.name=deep-dashboard`, `suite.snapshot.run_id`, `suite.project_root`.
- **`docs/monitor-decision.md`** — Plugin monitors spike 결정 (M4 §4.6): **M4.5 까지 HOLD**. spike 가 3개 acceptance gate 평가 (threshold defensibility, cross-platform reliability, notification-fatigue posture). Gate 1 FAIL — defensible threshold 설정에 필요한 baseline data 없음. 2026-08-11 (T+0 + 3 개월) 재평가, `suite-metrics.jsonl` 4주+ 누적 후.
- 17 신규 테스트 (`lib/otel.test.js`): endpoint resolution (`/v1/metrics` suffix 유무, trailing slash) + header parsing + OTLP payload shape (distribution gauge fan-out + M4-deferred / null skip 규칙 + timeUnixNano encoding + resource attributes) + env-gated no-op + injectable fetcher + http-status / network-error / fetch-unavailable failure paths.

### 변경 (PR 3/3)
- **`plugin.json.version`** 1.2.0 → 1.3.0.
- **`package.json.version`** 1.2.0 → 1.3.0.
- **`skills/deep-harness-dashboard.md`** — `--suite` 모드 단계 + 11-source 테이블 추가. Frontmatter description 에 M4 언급.
- **`README.md` + `README.ko.md`** — 기능 리스트 2 → 3 으로 확장, M4 Suite Telemetry 호출.
- **`.gitignore`** — `docs/` 에서 `docs/*` + `!docs/monitor-decision.md` 예외로 변경. decision record 는 plugin 과 함께 ship, local plans 는 ignored 유지.

### 마이그레이션 노트 (PR 3/3)
- OTLP export 가 필요한 consumer 는 `OTEL_EXPORTER_OTLP_ENDPOINT` 만 설정 (optional: `OTEL_EXPORTER_OTLP_HEADERS=key=value,...`). 코드 변경 불필요.
- Aggregator + formatter API surface 는 PR 2 이후 안정. PR 3 는 `lib/otel.js` + 문서만 추가.

## [Unreleased] — M4 Suite Telemetry Aggregator (PR 2/3)

### 추가
- **`lib/aggregator.js`** — Suite metric aggregator. `collectSuite()` 결과를 입력으로 `lib/metrics-catalog.yaml` 16 metric 모두 emit: M4-core 12 (계산) + M4-deferred 4 (`null` + `deferred_until: M5` / `M5.5`). 각 metric 은 `{ value, unit, tier, source_summary }` 구조. `appendSnapshot()` 가 append-only `.deep-dashboard/suite-metrics.jsonl` 기록; `readRecentSnapshots(n)` 가 malformed line skip 후 최근 N records 반환.
- **`lib/suite-formatter.js`** — `.deep-dashboard/suite-report.md` markdown 렌더러. 현재 snapshot 을 이전 JSONL record 와 비교, metric 별 trend (↑/↓/→) 출력. Distribution metric (e.g., `verdict_mix`) 은 `{ key=n, ... }` 컴팩트 literal; shape divergence 시 `?` fallback.
- `.deep-review/reports/*-review.md` 의 `**Verdict**:` line 파서. APPROVE / CONCERN / REQUEST_CHANGES 토큰 카운트, ambiguity 시 severity precedence: `REQUEST_CHANGES > CONCERN > APPROVE`.
- 38 신규 테스트 (`lib/aggregator.test.js` × 20, `lib/suite-formatter.test.js` × 18): 16 metric emission + greenfield-null 계약 + 12 per-metric 정확도 + div-by-zero 가드 + JSONL append-only round-trip + malformed line skip + trend arrows + ratio/seconds/count/numeric formatting + markdown rendering (sections, deferred-until, pipe-escaping) + file overwrite idempotency.

### 마이그레이션 노트
- `plugin.json.version` 은 1.2.0 유지. 1.3.0 final bump 은 PR 3.

### Round 1 리뷰 대응 (PR #6 — 3-way Opus + Codex review + Codex adversarial)

8 findings 모두 반영:

- **3-way 합의 (🔴 1)**: `computeBlockRate` / `computeErrorRate` 가 deep-wiki vault `log.jsonl` (`kind === 'log'`, wiki ingest 이벤트) 의 non-hook 이벤트를 분모에 포함 → busy wiki log 가 hook rate 를 near-zero 로 희석. `kind === 'hook-log'` 만 필터링하도록 변경. 200/100 wiki 이벤트 + 2 hook 이벤트 회귀 테스트 2종 추가.
- **Opus W1 🟡**: `parseVerdictFromMarkdown` substring poisoning — `**Verdict**: APPROVE — no CONCERN raised` 가 `CONCERN` 반환하던 버그. 3-tier 스캐너로 재작성: (1) verdict-line tail 에 leading-anchored `^<TOKEN>\b` (markdown emphasis `**APPROVE**` / italics / backtick 처리), (2) verdict line 내 severity-ordered word-boundaried 스캔 (table-cell 케이스), (3) whole-doc fallback. prose distractor + emphasis 회귀 3종 추가.
- **Opus W2 🟡**: `trendArrow` 가 "stable" 과 "regressed-to-unknown" 을 `→` 로 혼동. 새 vocabulary: `↑` / `↓` / `→` (equal) / `·` (no baseline) / `?` (asymmetric null OR distribution shape divergence).
- **Opus W3 🟡**: `appendSnapshot` docstring 을 `O_APPEND` atomicity 경계 (`PIPE_BUF` ≈ 4 KiB) + rotation 미제공으로 정직하게 정정. Cross-process advisory locking + rotation 은 M5 백로그 deferred.
- **Opus W4 🟡**: `metrics-catalog.yaml` `suite.review.verdict_mix` 가 `recurring-findings` 를 2nd source 로 listing 했으나 aggregator 미사용 — catalog drift. 미사용 entry 제거; aggregation 설명을 실제 leading-anchored 파서에 맞춤.
- **Opus I5 ℹ️**: catalog `suite.wiki.auto_ingest_candidates_total.null_when` 가 "no matching events" → null 이라 했으나 impl 은 `0` 반환 (count 시멘틱 — 파일 있음, 0 매치). catalog 를 "missing or unreadable" 으로 정정.
- **Opus I6 ℹ️**: `computeDocsAutoFixAcceptRate` + `computeEvolveQDelta` 의 `envelopes[0]` 접근에 single-cardinality 계약 주석 추가, 다중 envelope 진화 시 sort-by-generated_at-desc 경로 명시.
- **Opus I7 ℹ️**: catalog `suite.evolve.q_delta_per_epoch` 의 `max(epochs, 1)` (never-null) 공식이 impl 의 `epochs ≤ 0 → null` 과 불일치. catalog 를 impl 에 맞추고 이유 명시.

Deferred:
- I8 cosmetic (`renderValue` 정수-floored seconds, harmless).
- I9 test gaps — concurrent appendSnapshot / unicode / very-large JSONL. M5 후보.

테스트: 145 → 150 (+5 Round 1 회귀). All pass.

## [Unreleased] — M4 Suite Telemetry Aggregator (PR 1/3)

### 추가
- **`lib/metrics-catalog.yaml`** — `claude-deep-suite/docs/deep-suite-harness-roadmap.md` §M4 의 16개 suite-level 메트릭 카탈로그. M4-core 12개는 즉시 활성화, M4-deferred 4개는 `deferred_until: M5` / `M5.5` 표기와 함께 source 도달 전까지 `null` emit.
- **`lib/suite-collector.js`** — legacy `lib/dashboard/collector.js` 가 다루지 않는 4개 source 를 envelope-aware 로 수집: `deep-review/recurring-findings`, `deep-evolve/evolve-insights`, `deep-wiki/index` (외부 `<wiki_root>/.wiki-meta/index.json`, deep-wiki layout 준수 — `options.wikiRoot` 인자 / `DEEP_WIKI_ROOT` env / project-local 폴백 순), NDJSON 이벤트 로그 3종 (`.deep-work/hooks.log.jsonl`, `.deep-evolve/hooks.log.jsonl`, `<wiki_root>/log.jsonl` — `.wiki-meta/` 가 아니라 vault root). `parent_run_id` chain 재구성, aggregator-pattern envelope (`harnessability-report`, `evolve-insights`, `index`) 은 schema-documented 계약에 따라 **child + parent 양쪽** 에서 제외.
- **`lib/suite-constants.js`** — 6-month legacy fallback timer (`T+0 = 2026-05-07`, `T+0+6mo = 2026-11-07T00:00:00Z` **exclusive cutoff**), per-plugin envelope adoption ledger, `EXPECTED_SOURCES` 11 entries (envelope 8 + NDJSON 3), `PAYLOAD_REQUIRED_FIELDS` (per-kind required-key 리스트, authoritative payload schema mirror) 의 단일 진실원본.
- 29 신규 테스트: envelope unwrap + identity-guard rejection + payload-shape-violation rejection + **payload required-field 검증** (`{}` 거절, partial-shape 는 missing field 리스트와 함께 거절) + chain reconstruction (resolved / unresolved / aggregator-as-child-제외 / **aggregator-as-parent-제외** / **non-string run_id 거절**) + missing-signal-ratio (envelope + NDJSON denominator) + NDJSON hook log parse (malformed line skip) + **readJsonDir parse-failure 전파** + `wikiRoot` 옵션 / env / 폴백 + **legacy `<wiki_root>/index.json` 거절** + 양방향 SOURCE_SPECS ↔ EXPECTED_SOURCES alignment + 6-month timer **exclusive-cutoff** boundary + PAYLOAD_REQUIRED_FIELDS coverage.

### 변경
- **`package.json` `test` 스크립트** 를 `node --test "lib/**/*.test.js"` 로 따옴표 wrap. 이전엔 `sh` flat-globbing 이 `lib/*.test.js` top-level 파일을 누락시키는 silent drop 발생.

### Round 1 리뷰 대응 (PR #5 — 3-way Opus + Codex review + Codex adversarial)

11 findings 모두 머지 전 반영:

- **3-way 합의 (🔴 1)**: `readJsonDir` 가 `.deep-work/receipts/` 같은 dir-cardinality source 에서 malformed JSON 을 silent drop → `schema_failures_total` 미집계. `unparseable-json` / `directory-unreadable` / `broken-symlink` / `out-of-boundary-symlink` 실패를 절대경로와 함께 propagate.
- **Codex P2 × 2 (🔴 2)**: 외부 wiki 경로 보정 (`skills/wiki-schema/wiki-schema.yaml` 준수): `index.json` 은 `<wiki_root>/.wiki-meta/index.json` (이전: `<wiki_root>/index.json` — 실제 존재하지 않음), `log.jsonl` 은 `<wiki_root>/log.jsonl` (이전: `<wiki_root>/.wiki-meta/log.jsonl` — 실제 존재하지 않음). 비대칭은 의도된 설계: `.wiki-meta/` 는 Obsidian graph 에서 숨김, `log.jsonl` 은 root 에서 scriptable.
- **Codex adversarial HIGH (🔴 2)**:
  1. `missing_signal_ratio` denominator 가 8 → 11 로 확장 — hook logs (deep-work, deep-evolve) + deep-wiki vault log 가 ratio 에 포함. hook log 전부 missing 인 프로젝트가 envelope-only ratio 뒤에 숨어 healthy 처럼 보이던 문제 해결.
  2. Payload required-field validation layer 추가: 빈 `{}` payload + partial-shape payload (producer schema 의 required key 누락) → `missing-required-fields:<csv>` 로 거절되며 `schema_failures_total` 에 집계. Zero-dep, `scripts/validate-envelope-emit.js` 선례 미러. Full ajv-style schema-runtime validation 은 M5 후보.
- **Opus warnings (🟡 5)**:
  - W1 — aggregator-pattern envelope (`harnessability-report`, `evolve-insights`, `index`) 을 `reconstructChains` 의 `byRunId` map 에서도 제외. 이전엔 child 로만 제외, parent 로는 가능 → 완전성 silently inflation.
  - W2 — `run_id` 인덱싱을 truthy-check 에서 `typeof === 'string' && length > 0` 으로 강화. `run_id = {nested: true}` / `[]` 같은 malformed envelope 의 parent map 오염 차단.
  - W3 — 6-month timer 주석 재작성, exclusive-cutoff 의미론 + boundary 표 (2026-11-06T23:59:59Z → false, 2026-11-07T00:00:00Z → false, 2026-11-07T00:00:01Z → true) 명시.
  - W4 — `cardinality: 'dir'` 의 permission error 와 missing 구분, `failures: [{path, reason}]` 신규 채널.
  - W5 — NDJSON stream IO error handler 부착; `readNdjson` 이 `{events, missing, error}` 반환 → "파일 없음" vs "스트림 중간 실패" 구분.
- **Opus info (ℹ️ 2)**:
  - I6 — `TODO(M5): consolidate envelope unwrap into lib/envelope-unwrap.js` 주석 추가 (duplicated `isEnvelopeShape` / `unwrapStrict` 근처).
  - I7 — `SOURCE_SPECS ↔ EXPECTED_SOURCES` coverage 테스트를 양방향 containment 로 반전 (이전엔 tautological — `SOURCE_SPECS` 가 silently drop 해도 통과).

Deferred (scope-resolved, anti-oscillation §4 mirror M3 Phase 3 INFO-2~5):
- ajv 기반 full JSON Schema runtime validation — M5 후보.
- `metrics-catalog.yaml` schema/linter — PR 3 후보.
- env-var cached read — minor, deferred.
- `deep-review` review-report markdown frontmatter parsing — PR 2 (formatter 가 verdict_mix 도입 시).

### 마이그레이션 노트
- M4 collector 는 CONSUMER. PR 1 에는 producer-side breaking change 없음. PR 2 (aggregator) + PR 3 (OTel/monitor) 가 이 위에 쌓임.
- `plugin.json.version` 은 M4 마지막 PR (3/3) merge 까지 1.2.0 유지. suite repo `marketplace.json` SHA bump 은 그 머지 이후 별도 suite-repo PR 에서 처리.

## [1.2.0] — 2026-05-07

### 변경
- **`.deep-dashboard/harnessability-report.json` 이제 claude-deep-suite M3 cross-plugin envelope 으로 wrap** (`docs/envelope-migration.md`). top-level `schema_version: "1.0"` + `envelope` 블록 (`producer = "deep-dashboard"`, `producer_version`, `artifact_kind = "harnessability-report"`, `run_id` ULID, `generated_at` RFC 3339, `schema { name, version }`, `git { head, branch, dirty }`, `provenance { source_artifacts, tool_versions }`) + `payload` (`total`, `grade`, `dimensions`, `recommendations`, `topology`, `topology_hints`, `projectRoot`).
- **`scorer.js` CLI** stdout 으로 envelope JSON 출력 (이전: unwrapped 결과). 디스크 파일도 동일 envelope 모양. domain data 는 `.payload.*` 위치 — inline consumer 가 있다면 그에 맞춰 갱신 필요.
- **`scorer.js` `saveReport()`** 반환 형식 변경: `string` (path) → `{ path, envelope }`. 호출자가 파일을 다시 읽지 않고도 envelope 을 다음 단계로 전달할 수 있음.
- **`collector.js` 가 M3 envelope-aware 로 전환**. 각 artifact 경로에서 envelope 래퍼를 감지(strict `schema_version === "1.0"` + `envelope` + `payload` triple)하고, identity 가드 (producer / artifact_kind / schema.name)를 강제한 뒤 `payload` 만 downstream consumer (effectiveness scorer, formatter)에 노출. identity 불일치 envelope 은 stderr 경고와 함께 `null` 처리 (defense-in-depth — handoff §4 round-4 학습).
- envelope-aware 경로: `.deep-docs/last-scan.json`, `.deep-dashboard/harnessability-report.json`, `.deep-work/session-receipt.json`, `.deep-work/receipts/*.json`, `.deep-evolve/evolve-receipt.json`. `.deep-review/fitness.json` 와 `.deep-review/receipts/*.json` 는 legacy read 유지 — deep-review 의 M3 artifact 는 `recurring-findings.json` 이며 dashboard 는 현재 그것을 소비하지 않음.

### 추가
- `scripts/validate-envelope-emit.js` — zero-dep envelope contract self-test (suite spec mirror: `additionalProperties: false`, ULID/SemVer 2.0.0 strict / kebab-case / RFC 3339 정규식, identity check, payload shape minimal).
- `tests/fixtures/sample-harnessability-report.json` — envelope-wrapped sample emit (Phase 3 의 `claude-deep-suite/schemas/payload-registry/deep-dashboard/harnessability-report/v1.0.schema.json` placeholder → authoritative 교체 input).
- `npm run validate:envelope` 스크립트 (zero-dep node).
- collector 신규 테스트 11개 — envelope unwrap (deep-docs, self, deep-work session/slice, deep-evolve), identity-guard 거부 (잘못된 producer, kind, schema.name drift), legacy pass-through (envelope/legacy 혼재, `schema_version: 2` numeric).

### 마이그레이션 노트
- 본 릴리스는 `harnessability-report.json` shape **breaking change** (plugin-internal). `report.payload.total` 대신 `report.total` 을 직접 읽던 외부 reader 는 envelope-aware 로 갱신 필요. `skills/deep-harnessability.md` 의 24시간 staleness 규칙으로 자연 invalidation.
- 알려진 cross-plugin consumer: `deep-work` Phase 1 Research 가 `harnessability-report.json` 을 소비 (handoff §3.3 chain). envelope-aware read 갱신은 deep-work 의 Phase 2 PR (priority #3) 에서 처리.
- claude-deep-suite handoff §1 정책에 따라 본 PR 은 plugin repo 만 변경. `marketplace.json` SHA bump 와 `payload-registry/deep-dashboard/harnessability-report/v1.0.schema.json` placeholder → authoritative 교체는 suite repo Phase 3 batch PR 에서.
- claude-deep-suite Phase 2 Adoption ledger (`docs/envelope-migration.md` §6.1) priority #2 항목.

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
