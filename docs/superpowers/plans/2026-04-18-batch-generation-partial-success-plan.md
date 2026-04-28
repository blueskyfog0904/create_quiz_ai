# 영어 배치 문제생성 partial success 개선 계획

> **계획 작성 방식:** 이 계획은 현재 코드 구조 점검을 바탕으로 만든 실행 전 계획이며, 각 단계는 **분석 → 계획 → 검증** loop를 따릅니다. 검증을 통과하기 전에는 다음 단계로 진행하지 않습니다.

## 목표
영어문제생성에서 배치로 10개 문제를 요청했을 때, 예를 들어 9개 성공 / 1개 실패가 발생하면:

1. **성공한 9개는 즉시 검토/선택/저장 가능**해야 한다.
2. **실패한 1개는 별도로 재생성(재시도)** 할 수 있어야 한다.
3. 사용자는 “전체 실패”처럼 느끼지 않고, **partial success 상태를 명확히 이해**할 수 있어야 한다.
4. 저장 완료 후에는 `/library/purchased`(영어문제 관리)에서 확인 가능해야 한다.

---

## 현재 구조 분석

### 관련 파일
- UI: `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx`
- 페이지 로딩: `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/page.tsx`
- 배치 실행: `src/app/api/generate/listboard-jobs/[jobId]/run/route.ts`
- 실패 재시도: `src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts`
- 저장: `src/app/api/generate/listboard-jobs/[jobId]/save/route.ts`
- 결과 조회: `src/app/api/generate/listboard-jobs/[jobId]/route.ts`

### 현재 코드상 의도된 모델
현재 코드만 보면 partial success를 어느 정도 지원하려는 흔적이 있습니다.

- `TERMINAL_JOB_STATUSES`에 `partially_completed` 포함
- `completedPreviewItems`는 `item.status === 'completed' && generated_question != null` 기준으로 생성
- `saveableItemIds`는 completedPreviewItems 중 `save_status in ('unsaved','save_failed')`인 항목만 추림
- `failedCount > 0`이면 `실패 항목 재시도` 버튼 노출
- `handleSaveItems(...)`는 선택된 성공 항목만 `/save` route로 저장
- `/save` route도 실제로는 `status === 'completed' && question_id === null && save_status in ('unsaved','save_failed')`만 저장 대상으로 잡음

즉 설계상으론 **성공 항목 저장 + 실패 항목 재시도**가 이미 부분적으로 가능해야 합니다.

### 그런데 사용자가 겪은 문제
사용자 실측 결과는:
- 10개 중 1개 실패 시
- “작업이 완료되지 않은 것처럼” 보이거나
- 성공한 9개를 저장할 수 없음

즉, 코드 의도와 실제 UX 사이에 차이가 있습니다.

---

## 가장 유력한 원인 후보

### 원인 1 — 상위 작업 상태(`job.status`)와 하위 항목 상태(`item.status`)의 불일치
현재 저장/재시도 가능 여부는 사실상 **item 단위 상태**에 달려 있지만,
사용자 경험은 여전히 **job 단위 상태**에 더 강하게 묶여 있을 가능성이 있습니다.

예:
- 어떤 실패 케이스에서 job이 `partially_completed`가 아니라 `failed`로 끝나거나,
- 어떤 item이 `failed`로 끝났지만 다른 item도 previewable 상태로 반영되기 전에 화면이 “실패” 맥락으로만 해석될 수 있음

### 원인 2 — 완료 다이얼로그와 액션 문구가 partial success 상태를 명확히 설명하지 못함
현재 완료 다이얼로그는 단순히:
- “문제 생성이 완료되었습니다.”
- “생성 결과를 확인하고 필요한 문제를 저장할 수 있습니다.”
형태입니다.

하지만 partial success인 경우 사용자가 알아야 하는 핵심은:
- 몇 건 성공했는지
- 몇 건 실패했는지
- 지금 저장 가능한 항목 수가 몇 개인지
- 실패 항목 재시도가 가능한지
입니다.

이 설명이 부족하면, 사용자는 저장 가능 상태를 놓치고 “작업이 끝나지 않았다”고 느낄 수 있습니다.

### 원인 3 — `run` / `retry` route의 최종 상태 전이와 UI refresh 타이밍 문제
`job-status-client.tsx`는 polling과 `refreshJob()`로 상태를 끌어오는데,
partial success 직후 UI가 저장 가능 상태를 반영하기 전에
- stale state
- completion dialog timing
- selection initialization
같은 타이밍 이슈가 있으면 저장 가능 항목이 없는 것처럼 보일 수 있습니다.

### 원인 4 — 실제로는 저장 가능 항목이 있어도 “저장 액션”이 실패/제약으로 막힐 수 있음
`/save` route는 저장 가능 항목만 필터링하지만,
- selected item set이 비어 있거나
- preview metadata/draft state가 아직 초기화되지 않았거나
- `generated_question` parse 결과가 null이면
저장 가능 항목이 0처럼 보일 수 있습니다.

---

# 권장 방향

## 최종 권장안
**job 전체 성공 여부와 별개로, item 단위 성공/실패를 1급 상태로 승격**해서 UX를 다시 설계하는 것이 가장 좋습니다.

핵심 원칙:
1. **성공 항목은 즉시 저장 가능**
2. **실패 항목은 즉시 재시도 가능**
3. job 상태는 `completed / partially_completed / failed`를 명확히 나누고,
   각 상태마다 CTA를 다르게 보여준다.
4. 저장 가능한 성공 항목 수를 상단 sticky action bar에서 항상 보이게 한다.

---

## UX 방향

### 상태 메시지
#### 전체 성공
- “10개 생성 완료 · 저장 가능한 문제 10건”

#### partial success
- “10개 중 9개 생성 완료 · 1개 실패”
- “생성 완료된 9개는 지금 저장할 수 있고, 실패 1개는 재시도할 수 있습니다.”

#### 전체 실패
- “생성 실패 10건 · 재시도가 필요합니다.”

### 상단 액션 영역
항상 아래 정보를 노출:
- 선택 건수
- 저장 가능 건수
- 생성 성공 건수
- 생성 실패 건수

그리고 CTA:
- `선택한 문제 저장`
- `실패 항목 재시도`
- `저장 문제 확인`

### 완료 다이얼로그
partial success인 경우 텍스트를 분기:
- “일부 문제 생성이 실패했습니다.”
- “성공한 문제는 먼저 저장할 수 있습니다.”
- “실패 항목은 재시도 버튼으로 다시 생성할 수 있습니다.”

---

## API / 상태 전이 방향

### Job status 규칙 강화
- `completed_count > 0 && failed_count > 0` → 반드시 `partially_completed`
- `completed_count === 0 && failed_count > 0` → `failed`
- `completed_count === requested_generation_count` → `completed`

### Save route 계약
`/api/generate/listboard-jobs/[jobId]/save`
- 입력된 item 중 저장 가능한 completed item만 저장
- 응답에 아래를 명시적으로 포함:
  - `requestedCount`
  - `saveableCount`
  - `savedCount`
  - `failedCount`
  - `skippedCount`
- 저장 불가 item이 섞여 있어도 전체 실패로 보기보다
  **부분 저장 성공**을 먼저 표현하는 계약이 좋음

### Retry route 계약
`/retry`
- `status === 'failed'` item만 재시도
- 응답에
  - `retriedCount`
  - `remainingCompletedCount`
  - `remainingFailedCount`
를 포함하면 UX가 더 명확해짐

---

# 구현 계획

## Loop 1 — 실제 상태 전이와 saveable 계산을 재현 가능하게 고정

### 종료 조건
1. partial success의 정의가 job/item 단위로 명확하다.
2. 저장 가능한 항목 계산식이 테스트/문서로 고정된다.
3. 정적 검증 통과.

### Task 1. 상태/저장 가능 규칙을 테스트로 고정

**파일:**
- Modify: `tests/...` 신규 테스트 추천
- Modify: `job-status-client.tsx` 관련 source-level test

- [ ] `partially_completed` 상태에서 completed item이 있으면 saveable item이 0이 아니어야 함
- [ ] failed item이 있어도 completedPreviewItems는 그대로 렌더되어야 함
- [ ] failed item이 있어도 상단 저장 CTA가 saveable item 기준으로 활성화되어야 함

### 추천 신규 테스트 파일
- `tests/listboard-job-partial-success.test.mjs`

핵심 assertion:
- `completedPreviewItems`
- `saveableItemIds`
- `failedCount > 0`
- `job.status === 'partially_completed'`
- `handleRetryFailed`
- `handleSaveItems`

---

## Loop 2 — UI를 partial success 중심으로 재구성

### 종료 조건
1. 사용자가 성공/실패를 한눈에 구분한다.
2. 성공 항목 저장과 실패 항목 재시도 CTA가 동시에 자연스럽게 보인다.
3. 정적 검증 통과.

### Task 2. `job-status-client.tsx` UX 개선

**파일:**
- Modify: `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx`

- [ ] 완료 다이얼로그 문구를 `completed / partially_completed / failed` 상태별로 분기
- [ ] 상단 작업 요약 카드에 “저장 가능 n건 / 실패 n건”을 더 분명히 표시
- [ ] 실패 항목 섹션에서 retry 대상과 저장 불가 이유를 더 명시적으로 표시
- [ ] 성공 항목 섹션 제목을 “지금 저장 가능한 생성 결과” 식으로 강화
- [ ] partial success 상태에서 `저장 문제 확인` 버튼은 savedCount 기준으로만 동작

---

## Loop 3 — 저장 API 계약을 partial save 친화적으로 강화

### 종료 조건
1. 저장 API가 부분 저장 결과를 명확히 반환한다.
2. 저장 불가 항목이 있어도 성공 항목 저장을 우선 처리한다.
3. 정적 검증 통과.

### Task 3. `/save` route 응답 확장

**파일:**
- Modify: `src/app/api/generate/listboard-jobs/[jobId]/save/route.ts`

- [ ] 응답에 `requestedCount`, `saveableCount`, `savedCount`, `failedCount`, `skippedCount` 포함
- [ ] 저장할 수 없는 item이 섞여 있어도 전체 실패 대신 부분 저장 결과 반환
- [ ] `NO_SAVEABLE_ITEMS`와 “일부 저장 실패”를 명확히 구분

---

## Loop 4 — failed item retry 흐름 강화

### 종료 조건
1. 실패한 항목만 정확히 재시도된다.
2. 재시도 후 상태가 다시 UI에 반영된다.
3. 정적 검증 통과.

### Task 4. retry 결과/후속 refresh 강화

**파일:**
- Modify: `src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts`
- Modify: `job-status-client.tsx`

- [ ] retry 응답에 `retriedCount`, `remainingFailedCount` 등 메타 포함 검토
- [ ] retry 이후 `refreshJob(true)`로 상태가 즉시 반영되는지 확인
- [ ] 이미 저장 가능한 success item selection이 retry 이후 불필요하게 초기화되지 않도록 점검

---

## Loop 5 — 부분 성공 시나리오 수동 검증

### 종료 조건
1. 10개 중 일부 실패 시에도 성공 항목 저장 가능
2. 실패 항목만 재시도 가능
3. 재시도 후 새로 성공한 항목도 이어서 저장 가능
4. `/library/purchased` 확인 흐름까지 자연스럽게 이어짐

### 수동 검증 시나리오
- [ ] 10건 요청 → 9 성공 / 1 실패
  - 기대: 9건 preview 노출
  - 기대: 9건 저장 가능
  - 기대: 실패 1건 retry 가능
- [ ] 10건 요청 → 5 성공 / 5 실패
  - 기대: 5건 저장 가능 / 5건 retry 가능
- [ ] retry 후 1건 추가 성공
  - 기대: 새 성공 항목도 저장 가능 집합에 포함
- [ ] save 후 `/library/purchased` 이동
  - 기대: 저장된 문제 확인 가능

---

# Acceptance Criteria

1. 배치 생성이 partial success여도 성공 항목은 즉시 저장할 수 있다.
2. 실패 항목은 별도로 retry할 수 있다.
3. job 상태가 `partially_completed`일 때 UI가 이를 명확히 설명한다.
4. `/save`는 부분 저장 결과를 구체적으로 반환한다.
5. retry 후 새 상태가 즉시 화면에 반영된다.
6. 저장 완료 후 `/library/purchased`에서 확인 가능하다.

---

# 검증 전략

## 정적 검증
- source-level tests for job status UI / save route / retry route
- `npx eslint ...`
- `npx tsc --noEmit`

## 수동 검증
- partial success 케이스 강제 재현
- 저장 가능 집합/실패 집합 UI 확인
- retry → refresh → save → purchased 확인

---

# 최종 권장 요약

현재 코드는 partial success를 일부 지원하려는 구조를 이미 갖고 있지만,
**사용자가 그 상태를 명확히 이해하고 바로 저장/재시도할 수 있게 하는 UX/상태 계약이 부족**합니다.

따라서 가장 좋은 방향은:
- job 단위 성공/실패보다 **item 단위 성공/실패/저장가능성**을 우선하는 UX로 바꾸고,
- save/retry API도 그 모델에 맞춰 더 명확한 계약을 주는 것입니다.
