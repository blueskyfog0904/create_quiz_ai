# 모의고사 배치 문제생성 진행 UX 개선 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** IT 비전문 교사·학원 사용자가 모의고사 AI 문제의 생성 진행상황을 쉬운 한국어로 이해하고, 완성된 문제를 검토·선택 저장한 뒤 영어문제 관리에서 바로 확인할 수 있도록 기존 job 화면을 개선한다.

**Architecture:** 기존 `/generate/boards/[slug]/posts/[postId]/jobs/[jobId]` route와 job/item/API/DB 상태 모델을 유지한다. `JobStatusClient`가 이미 보유한 item 단위 상태를 이용해 같은 화면 안에서 `생성 → 검토 → 저장` 단계를 표현하고, 생성 중에도 완료된 문제를 저장할 수 있는 partial-success 계약을 보존한다. API·DB·신규 dependency는 변경하지 않는다.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS, shadcn UI, Supabase, Node.js `node:test`, ESLint, Playwright(수동 시각 검증 보조)

---

## 1. 요청사항 파악 결과

### 1.1 사용자가 달성하려는 결과

사용자의 목표는 AI 작업 상태를 기술적으로 관찰하는 것이 아니라 다음 흐름을 실수 없이 마치는 것이다.

1. 모의고사 문항과 문제 유형을 선택한다.
2. AI가 몇 개 중 몇 개를 만들고 있는지 확인한다.
3. 완성된 문제의 내용을 검토한다.
4. 사용할 문제만 선택해서 저장한다.
5. `/library/purchased`의 영어문제 관리에서 해당 생성 작업을 통해 저장한 문제를 확인한다.

### 1.2 현재 화면의 확인된 문제

- `running`, `queued`, `save_failed` 같은 시스템 상태가 사용자에게 직접 노출된다.
- 실제 생성 중에는 진행률 숫자가 있어도 비례 진행 막대 대신 스피너만 보인다.
- 생성, 실패, 저장 통계가 동일한 우선순위의 카드 6개로 나뉘어 현재 해야 할 행동이 흐려진다.
- 완료된 결과가 없을 때도 비활성화된 선택·저장 toolbar가 먼저 노출된다.
- 생성 완료 dialog가 `확인`만 제공하고, 저장 완료는 toast에 의존한다.
- 생성 완료와 영어문제 관리 저장 완료가 서로 다른 상태라는 설명이 부족하다.

### 1.3 보존해야 하는 기존 계약

- 생성 중이어도 먼저 완료된 문제는 검토·선택 저장할 수 있어야 한다.
- 부분 성공 시 성공 문제 저장과 실패 문제 재시도를 동시에 제공해야 한다.
- 저장 후보는 `completed + generated_question parse 성공 + unsaved/save_failed` item만 포함한다.
- 저장 완료 item은 재저장할 수 없어야 한다.
- 실패 item만 retry하고, retry 중에도 기존 성공 item의 선택·저장 상태를 보존해야 한다.
- 저장 후 `/library/purchased?jobId=<jobId>`에서 해당 작업의 저장 문제만 확인할 수 있어야 한다.

### 1.4 명시적 범위 제외

- AI 생성·검토 알고리즘 변경
- 크레딧 차감·실패 환불 정책 변경
- Supabase migration 또는 status enum 변경
- 생성 자동 저장
- 실제 근거가 없는 예상 남은 시간 표시
- 페이지 이탈 후 생성을 보장한다는 안내
- 생성 취소 API 및 환불 흐름 추가
- 영어문제 관리 전체 IA 개편
- 신규 UI/상태관리 dependency 추가

---

## 2. RALPLAN-DR 결정 요약

### 원칙

1. 교사에게 시스템 상태가 아니라 현재 상황과 다음 행동을 설명한다.
2. 기존 partial-success와 선택 저장 계약을 절대 약화하지 않는다.
3. API·DB 변경 없이 현재 item 상태를 최대한 활용한다.
4. 사용할 수 없는 버튼은 미리 노출하지 않는다.
5. 색상만으로 상태를 구분하지 않고 텍스트·아이콘·ARIA를 함께 제공한다.

### 핵심 결정 요인

1. 기존 job route가 새로고침·재진입·polling·retry에 적합하다.
2. item에 문항 번호, 문제 유형, 생성 상태, 저장 상태가 이미 존재한다.
3. 개인지문 흐름의 장점은 별도 URL이 아니라 `검토 → 선택 저장 → 저장 목록 확인`이라는 단계 감각이다.

### 검토한 대안

#### 대안 A — 게시글 선택 화면에서 FORM/RESULT 상태로 모두 처리

- 장점: 개인지문 화면과 가장 비슷하다.
- 단점: 장기 job 재진입, 브라우저 새로고침, 부분 성공, retry 상태 복원이 복잡해진다.
- 기각 이유: 현재 job route와 DB 상태 모델을 불필요하게 우회한다.

#### 대안 B — 기존 화면에서 문구만 한글화

- 장점: 변경량이 가장 작다.
- 단점: 과도한 통계 카드, 생성 중 진행 막대 부재, 비활성 toolbar, 약한 완료 CTA가 그대로 남는다.
- 기각 이유: 사용자의 핵심 문제인 정보 구조를 해결하지 못한다.

#### 대안 C — 기존 job route 유지 + 단계형 화면 재구성 **(채택)**

- 기술적으로는 현재 job route와 API를 유지한다.
- 사용자에게는 `문제 생성 → 문제 검토 → 영어문제 관리에 저장` 흐름으로 보이게 한다.
- 생성 결과가 도착하는 즉시 아래 미리보기에서 검토·저장할 수 있게 한다.
- 생성 완료는 비차단형 inline 안내로 표현하고, 저장 완료에만 다음 행동 dialog를 사용한다.

---

## 3. 목표 화면 상태 정의

| 상태 | 대표 제목 | 보조 설명 | 주요 행동 |
| --- | --- | --- | --- |
| 준비 중 | 문제 생성을 준비하고 있어요 | 선택한 문항과 문제 유형을 확인하고 있습니다. | 행동 없음 |
| 생성 중, 완료 0건 | AI가 문제를 만들고 있어요 | 현재 생성 중인 문항과 전체 진행률을 표시한다. | 행동 없음 |
| 생성 중, 완료 1건 이상 | AI가 문제를 만들고 있어요 | 완성된 문제는 아래에서 먼저 검토·저장할 수 있다고 안내한다. | 완성된 문제 검토/선택 저장 |
| 전체 생성 완료 | 생성된 문제를 검토하고 저장하세요 | 생성 완료는 저장 완료가 아님을 설명한다. | 선택한 문제 저장 |
| 부분 성공 | 일부 문제가 먼저 완성되었어요 | 성공 문제는 저장하고 실패 문제는 다시 만들 수 있다고 안내한다. | 선택 저장 / 실패 항목 다시 생성 |
| 전체 실패 | 문제를 생성하지 못했어요 | 생성 결과가 없으며 재시도가 필요하다고 안내한다. | 실패 항목 다시 생성 |
| 저장 완료 | 선택한 문제 N개가 저장되었습니다 | 영어문제 관리에서 해당 생성 작업을 통해 저장한 문제를 확인할 수 있다고 안내한다. | 계속 검토 / 영어문제 관리에서 보기 |

### 상태 표시 문구

```ts
const jobStatusLabel: Record<string, string> = {
  queued: '생성 준비 중',
  running: 'AI가 문제를 만드는 중',
  completed: '문제 생성 완료',
  partially_completed: '일부 문제 생성 완료',
  failed: '다시 생성 필요',
  cancelled: '생성 취소됨',
}

const itemStatusLabel: Record<string, string> = {
  queued: '대기 중',
  running: '생성 중',
  completed: '검토 가능',
  failed: '다시 생성 필요',
  cancelled: '생성 취소됨',
}
```

저장 상태는 `BatchQuestionPreviewCard`에서 다음처럼 표시한다.

```ts
const saveStatusLabel: Record<string, string> = {
  unsaved: '저장 전',
  saving: '영어문제 관리에 저장 중',
  saved: '영어문제 관리에 저장됨',
  save_failed: '저장 재시도 필요',
}
```

---

## 4. 변경 파일 구조

### 수정

- `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx`
  - 사용자 친화 상태 파생
  - 3단계 진행 안내
  - 생성 중 비례 progress bar와 현재 문항 표시
  - 조건부 저장 toolbar
  - inline 완료/부분 성공/전체 실패 안내
  - 저장 완료 dialog
  - workspace subject를 보존하는 purchased URL

- `src/components/features/quiz/batch-question-preview-card.tsx`
  - 저장 상태 문구
  - 버튼 문구
  - checkbox/별점/태그 컨트롤 접근성 이름
  - 모바일 header 배치 개선

- `src/app/(dashboard)/library/purchased/purchased-client.tsx`
  - `jobId` filter가 이번 저장 요청만이 아니라 해당 생성 작업의 누적 저장 결과를 뜻하도록 banner 문구를 정확히 변경

- `tests/listboard-job-partial-success.test.mjs`
  - 생성 중 완료 항목 저장 가능 계약 유지
  - 새로운 조건부 toolbar가 partial-success를 막지 않는지 검증

- `tests/listboard-job-retry-feedback.test.mjs`
  - 실패 item 재시도와 성공 item 저장의 동시 제공 계약 유지

### 생성

- `tests/listboard-job-progress-ux.test.mjs`
  - 교사 친화 상태 문구, progress bar, 현재 문항, 완료 안내, 저장 dialog, purchased URL, 접근성 source contract 검증

### 변경하지 않음

- `src/app/api/generate/listboard-jobs/[jobId]/run/route.ts`
- `src/app/api/generate/listboard-jobs/[jobId]/route.ts`
- `src/app/api/generate/listboard-jobs/[jobId]/retry/route.ts`
- `src/app/api/generate/listboard-jobs/[jobId]/save/route.ts`
- `src/app/(dashboard)/library/purchased/page.tsx`
- Supabase migrations 및 generated types

---

## 5. 구현 계획: 요청사항 파악 → 구현 계획 → 검증 loop

각 Phase는 해당 검증 gate를 통과하기 전에는 종료하지 않는다.

### Phase 0: 기준선과 기존 계약 고정

**요청사항 파악**

- 현재 partial-success와 retry/save accounting 테스트가 통과하는지 확인한다.
- 작업 시작 전 사용자 변경 파일을 기록하고, 구현 중 덮어쓰지 않는다.

**Files:**
- Read: `tests/listboard-job-partial-success.test.mjs`
- Read: `tests/listboard-job-retry-feedback.test.mjs`

- [ ] **Step 1: 작업 트리 기준선 확인**

Run:

```bash
git status --short
```

Expected: 기존 변경이 있다면 파일 목록을 작업 기록에 남긴다. 이번 구현 대상과 겹치면 덮어쓰지 않고 diff 기준으로 병합한다.

- [ ] **Step 2: 기존 핵심 계약 테스트 실행**

Run:

```bash
node --test \
  tests/listboard-job-partial-success.test.mjs \
  tests/listboard-job-retry-feedback.test.mjs
```

Expected: `pass 5`, `fail 0`.

**검증 gate:** 기존 두 테스트가 통과해야 Phase 1로 진행한다. 실패하면 새 UX 구현 전에 기존 실패 원인을 분리한다.

---

### Phase 1: 실패하는 UX 계약 테스트 작성

**요청사항 파악**

- 구현 전 테스트가 실제로 실패해야 새 UX가 테스트에 의해 고정된다.
- 기존 source-contract 테스트 방식인 `readFileSync + assert.match/doesNotMatch`를 따른다.

**Files:**
- Create: `tests/listboard-job-progress-ux.test.mjs`
- Modify: `tests/listboard-job-partial-success.test.mjs`
- Modify: `tests/listboard-job-retry-feedback.test.mjs`

- [ ] **Step 1: 진행 UX source-contract 테스트 추가**

테스트는 최소한 다음 계약을 검사한다.

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const jobStatusClientSource = readFileSync(
  new URL('../src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx', import.meta.url),
  'utf8'
)
const batchPreviewSource = readFileSync(
  new URL('../src/components/features/quiz/batch-question-preview-card.tsx', import.meta.url),
  'utf8'
)
const purchasedClientSource = readFileSync(
  new URL('../src/app/(dashboard)/library/purchased/purchased-client.tsx', import.meta.url),
  'utf8'
)

test('job progress uses teacher-friendly labels and an accessible live progress bar', () => {
  assert.match(jobStatusClientSource, /AI가 문제를 만들고 있어요/)
  assert.match(jobStatusClientSource, /완성된 문제는 아래에서 먼저 검토하고 저장할 수 있습니다/)
  assert.match(jobStatusClientSource, /const currentRunningItem = items\.find/)
  assert.match(jobStatusClientSource, /role="progressbar"/)
  assert.match(jobStatusClientSource, /aria-valuenow=\{progressPercent\}/)
  assert.doesNotMatch(jobStatusClientSource, />\{isStartingRun \? 'running' : job\.status\}</)
  assert.doesNotMatch(jobStatusClientSource, />\{item\.status\}</)
})

test('save actions appear only after a reviewable result exists', () => {
  assert.match(jobStatusClientSource, /const hasReviewableResults = completedPreviewItems\.length > 0/)
  assert.match(jobStatusClientSource, /const hasSaveActivity = hasReviewableResults \|\| savedCount > 0/)
  assert.match(jobStatusClientSource, /\{hasSaveActivity \? \(/)
  assert.match(jobStatusClientSource, /선택한 \{selectedItemIds\.length\}개 저장/)
})

test('saving gives explicit next actions and preserves workspace subject', () => {
  assert.match(jobStatusClientSource, /showSaveSuccessDialog/)
  assert.match(jobStatusClientSource, /계속 검토하기/)
  assert.match(jobStatusClientSource, /영어문제 관리에서 보기/)
  assert.match(jobStatusClientSource, /const purchasedParams = new URLSearchParams/)
  assert.match(jobStatusClientSource, /jobId: job\.id/)
  assert.match(jobStatusClientSource, /subject: workspaceSubject/)
  assert.match(jobStatusClientSource, /const purchasedHref = `\/library\/purchased\?\$\{purchasedParams\.toString\(\)\}`/)
})

test('raw generation and save statuses are never rendered directly', () => {
  assert.doesNotMatch(jobStatusClientSource, />\{isStartingRun \? 'running' : job\.status\}</)
  assert.doesNotMatch(jobStatusClientSource, />\{item\.status\}</)
  assert.doesNotMatch(jobStatusClientSource, />\{item\.save_status\}</)
})

test('terminal generation states render inline banners instead of a completion dialog', () => {
  assert.match(jobStatusClientSource, /문제 .*개가 모두 생성되었습니다/)
  assert.match(jobStatusClientSource, /다시 생성 필요/)
  assert.match(jobStatusClientSource, /생성된 문제가 없습니다/)
  assert.doesNotMatch(jobStatusClientSource, /showCompleteDialog/)
  assert.doesNotMatch(jobStatusClientSource, /setShowCompleteDialog/)
})

test('saved items stay excluded from save candidates', () => {
  assert.match(jobStatusClientSource, /\['unsaved', 'save_failed'\]\.includes\(item\.save_status\)/)
  assert.match(batchPreviewSource, /const isSaved = saveStatus === 'saved'/)
  assert.match(batchPreviewSource, /disabled=\{disableActions \|\| isSaved \|\| isSaving\}/)
})

test('purchased banner describes the whole generation job, not only the latest save request', () => {
  assert.match(purchasedClientSource, /이 생성 작업에서 저장한 문제 \{highlightedSavedCount\}개를 표시 중입니다/)
  assert.doesNotMatch(purchasedClientSource, /방금 저장한 문제 \{highlightedSavedCount\}개/)
})
```

- [ ] **Step 2: 접근성 계약 추가**

`BatchQuestionPreviewCard` source에 이름이 고정된 접근성 subtest를 추가한다.

```js
test('preview card exposes accessible checkbox rating tag controls and save-status copy', () => {
  assert.match(batchPreviewSource, /aria-label=\{`\$\{questionNumber\}번 \$\{problemTypeName\} 문제 선택`\}/)
  assert.match(batchPreviewSource, /aria-label=\{`별점 \$\{star\}점 선택`\}/)
  assert.match(batchPreviewSource, /aria-pressed=\{rating === star\}/)
  assert.match(batchPreviewSource, /aria-label=\{`\$\{tag\} 태그 삭제`\}/)
  assert.match(batchPreviewSource, /저장 재시도 필요/)
})
```

- [ ] **Step 3: 구현 전 실패 확인**

Run:

```bash
node --test tests/listboard-job-progress-ux.test.mjs
```

Expected: 새 문구·progressbar·dialog·ARIA 계약이 아직 없어 `AssertionError`로 실패한다.

**검증 gate:** 새 테스트가 의도한 누락 항목에서 실패해야 한다. 테스트가 처음부터 통과하면 assertion이 약한 것이므로 강화한다.

> 신규 테스트 파일은 이 계획 작성 시점에는 존재하지 않는 것이 정상이다. Phase 1에서 먼저 생성하고 RED를 확인한 뒤 구현한다.

---

### Phase 2: 생성 진행 상태를 교사 친화적으로 재구성

**요청사항 파악**

- API 데이터만으로 `완료/실패/생성 중/대기`를 계산할 수 있다.
- `completed + failed`는 성공률이 아니라 처리 진행률이므로 문구를 `처리`가 아닌 `생성 진행`과 상태별 수치로 분리한다.

**Files:**
- Modify: `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx:62-103,336-445`

- [ ] **Step 1: 화면 파생 상태 추가**

```ts
const resolvedCount = completedCount + failedCount
const queuedCount = items.filter((item) => item.status === 'queued').length
const currentRunningItem = items.find((item) => item.status === 'running') ?? null
const hasReviewableResults = completedPreviewItems.length > 0
const hasSaveActivity = hasReviewableResults || savedCount > 0
```

`progressPercent`는 `resolvedCount / requested_generation_count`를 사용하되, 옆에 `생성 완료 N개`, `다시 생성 필요 N개`를 별도로 표시한다.

- [ ] **Step 2: 동적 page heading과 3단계 안내 추가**

생성 중:

```text
AI가 문제를 만들고 있어요
완성된 문제는 아래에서 먼저 검토하고 저장할 수 있습니다.
```

terminal 상태:

```text
생성된 문제를 검토하고 저장하세요
AI가 만든 문제를 확인한 뒤, 사용할 문제만 영어문제 관리에 저장하세요.
```

단계 표시는 `1 문제 생성`, `2 문제 검토`, `3 영어문제 관리에 저장`으로 고정하고 현재 상태에 따라 text/icon/background를 바꾼다. 단계 숫자와 텍스트를 함께 사용해 색상만으로 상태를 전달하지 않는다.

- [ ] **Step 3: 생성 중에도 비례 progress bar 표시**

현재 spinner-only 분기를 제거하고 progress bar를 항상 렌더한다.

```tsx
<div
  role="progressbar"
  aria-label="문제 생성 진행률"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={progressPercent}
  className="h-3 overflow-hidden rounded-full bg-gray-100"
>
  <div
    className="h-full rounded-full bg-primary transition-[width] duration-500"
    style={{ width: `${progressPercent}%` }}
  />
</div>
```

- [ ] **Step 4: 현재 생성 문항과 대기 수 표시**

`currentRunningItem`이 있으면 다음을 표시한다.

```text
현재 만들고 있는 문제
19번 · 빈칸 추론 문제
```

queued 상태만 있으면 `다음 문제를 준비하고 있어요`를 표시한다. 정확한 시간 데이터가 없으므로 분 단위 ETA는 표시하지 않는다.

- [ ] **Step 5: raw 상태값 렌더 제거**

- `{isStartingRun ? 'running' : job.status}` 직접 표시를 제거한다.
- `{item.status}`, `{item.save_status}` 직접 표시를 제거한다.
- 화면에는 status label map 결과만 사용한다.

- [ ] **Step 6: Phase 2 테스트 실행**

Run:

```bash
node --test \
  --test-name-pattern='job progress|raw generation' \
  tests/listboard-job-progress-ux.test.mjs
```

Expected: 진행/상태 문구 관련 subtest만 선택 실행되어 pass.

**검증 gate:** 진행률 막대, 현재 문항, 한글 상태, raw 상태 미노출 계약이 모두 통과해야 Phase 3로 진행한다.

---

### Phase 3: 결과·저장·실패 행동의 우선순위 재정렬

**요청사항 파악**

- 완료 결과가 없는 동안 선택 저장 toolbar는 불필요하다.
- 완료 결과가 생기면 전체 작업 종료 전에도 저장 가능해야 한다.
- 생성 완료 modal은 이미 결과를 보고 있는 사용자를 방해하므로 inline 상태 안내로 대체한다.

**Files:**
- Modify: `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx:215-234,342-388,447-612`

- [ ] **Step 1: 생성 완료 자동 dialog 제거**

- `hasShownCompleteDialogRef`
- 생성 terminal 감지 후 `setShowCompleteDialog(true)`를 호출하는 effect
- `showCompleteDialog` 생성 완료 dialog

위 항목을 제거한다. terminal 상태는 progress card 내부 inline banner로 표시한다.

- [ ] **Step 2: terminal 상태별 inline banner 추가**

전체 성공:

```text
문제 N개가 모두 생성되었습니다.
아래에서 사용할 문제만 선택해 저장하세요. 생성 완료된 문제는 저장 전까지 영어문제 관리에 표시되지 않습니다.
```

부분 성공:

```text
N개 생성 완료 · M개 다시 생성 필요
완성된 문제는 지금 저장할 수 있고, 생성되지 않은 문제는 다시 시도할 수 있습니다.
```

전체 실패:

```text
생성된 문제가 없습니다.
실패 사유를 확인한 뒤 다시 생성해 주세요.
```

- [ ] **Step 3: 저장 toolbar 조건부 렌더링**

`hasSaveActivity`일 때만 sticky toolbar를 렌더한다. 생성 중이어도 `completedPreviewItems.length > 0`이면 toolbar를 즉시 표시한다.

왼쪽 정보:

```text
검토 가능 N개 · 선택 N개 · 저장 완료 N개
```

Primary CTA:

```text
선택한 N개 저장
```

Secondary CTA는 `savedCount > 0`일 때만 `영어문제 관리에서 보기`로 표시한다.

- [ ] **Step 4: 실패 영역을 행동 중심으로 변경**

- `진행/예외 항목` → 생성 중에는 `문제별 진행 상황`, terminal 상태에서는 `다시 확인이 필요한 문제`
- `최근 실패 사유`는 사용자용 요약을 먼저 표시한다.
- raw 오류 문자열은 `자세한 실패 내용` 영역 안에서만 제공한다.
- 실패 CTA 문구를 `실패 항목 다시 생성`으로 통일한다.

- [ ] **Step 5: 결과 영역을 toolbar 바로 아래 배치**

- `생성 결과` → `검토할 문제`
- 설명: `문제 내용을 확인한 뒤 사용할 문제만 선택하세요.`
- 기존 `BatchQuestionPreviewCard`와 별점·태그·선택·개별 저장 동작은 유지한다.

- [ ] **Step 6: partial-success 회귀 테스트 실행**

Run:

```bash
node --test \
  --test-name-pattern='job progress|save actions|raw generation|terminal generation states' \
  tests/listboard-job-progress-ux.test.mjs
node --test \
  tests/listboard-job-partial-success.test.mjs \
  tests/listboard-job-retry-feedback.test.mjs
```

Expected: Phase 2~3 관련 신규 subtest와 기존 partial-success/retry subtest pass. 저장 dialog·purchased banner·접근성 subtest는 이 gate에서 실행하지 않는다.

**검증 gate:** 생성 중 완료 항목 저장, 부분 성공 저장+retry 동시 제공, 조건부 toolbar가 모두 통과해야 Phase 4로 진행한다.

---

### Phase 4: 저장 완료 다음 행동과 영어문제 관리 연결

**요청사항 파악**

- 저장 성공 toast만으로는 다음 행동이 충분하지 않다.
- 개인지문 흐름처럼 저장 성공 후 `계속 검토`와 `저장 목록 확인`을 제공한다.

**Files:**
- Modify: `src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx:42-60,278-325,380-386,460-466,590-612`
- Modify: `src/app/(dashboard)/library/purchased/purchased-client.tsx:306-318`

- [ ] **Step 1: purchased URL을 한 곳에서 생성**

```ts
const purchasedParams = new URLSearchParams({
  jobId: job.id,
  subject: workspaceSubject,
})
const purchasedHref = `/library/purchased?${purchasedParams.toString()}`
```

기존 purchased 이동 버튼과 신규 dialog가 모두 `purchasedHref`를 사용한다.

- [ ] **Step 2: 저장 성공 상태 추가**

```ts
const [showSaveSuccessDialog, setShowSaveSuccessDialog] = useState(false)
const [lastSavedCount, setLastSavedCount] = useState(0)
```

`handleSaveItems`에서 `data.data.savedCount > 0`일 때 count를 저장하고 dialog를 연다. skipped/failed toast와 `refreshJob(true)`는 유지한다.

- [ ] **Step 3: 저장 완료 dialog 추가**

```text
제목: 선택한 문제 N개가 저장되었습니다
설명: 영어문제 관리에서 이 생성 작업을 통해 저장한 문제를 모아 볼 수 있습니다.
버튼 1: 계속 검토하기
버튼 2: 영어문제 관리에서 보기
```

버튼 1은 dialog만 닫고 현재 선택·스크롤·결과를 유지한다. 버튼 2는 `router.push(purchasedHref)`를 호출한다.

- [ ] **Step 4: purchased banner의 의미를 job 단위로 통일**

`src/app/(dashboard)/library/purchased/purchased-client.tsx`의 highlighted job banner를 다음처럼 변경한다.

```text
이 생성 작업에서 저장한 문제 N개를 표시 중입니다.
현재 생성 작업에서 저장된 결과만 우선 보여주고 있습니다.
```

`jobId` filter는 여러 번 나누어 저장했더라도 해당 job에서 저장된 문제 전체를 보여준다. 이번 저장 요청의 `savedQuestionIds`만 필터링하는 기능은 범위에 포함하지 않는다.

- [ ] **Step 5: 저장·purchased flow 계약 검증**

Run:

```bash
node --test \
  --test-name-pattern='saving gives explicit next actions|purchased banner|saved items stay excluded' \
  tests/listboard-job-progress-ux.test.mjs
node --test tests/listboard-job-retry-feedback.test.mjs
```

Expected: 저장 count, 다음 행동 dialog, `jobId + subject` URL 계약 pass.

**검증 gate:** 저장 성공 후 dialog가 나타나고 두 CTA가 정확히 동작하는 source contract가 통과해야 Phase 5로 진행한다.

---

### Phase 5: 문제 미리보기 카드 문구·접근성·모바일 배치 개선

**요청사항 파악**

- `미저장`, `개별 저장`, 아이콘만 있는 태그 버튼은 비전문 사용자와 보조기기에 불친절하다.
- 카드 기능은 유지하면서 문구와 접근성만 개선한다.

**Files:**
- Modify: `src/components/features/quiz/batch-question-preview-card.tsx:31-43,64-103,108-166`

- [ ] **Step 1: 저장 상태와 버튼 문구 변경**

- `미저장` → `저장 전`
- `저장 중` → `영어문제 관리에 저장 중`
- `저장 완료` → `영어문제 관리에 저장됨`
- `저장 실패` → `저장 재시도 필요`
- `개별 저장` → `이 문제 저장`

- [ ] **Step 2: 접근 가능한 이름 추가**

```tsx
<Checkbox
  aria-label={`${questionNumber}번 ${problemTypeName} 문제 선택`}
  ...
/>

<button
  aria-label={`별점 ${star}점 선택`}
  aria-pressed={rating === star}
  ...
/>

<button aria-label={`${tag} 태그 삭제`} ... />

<Button aria-label="태그 추가" ... />
<Input aria-label="추가할 태그" ... />
```

- [ ] **Step 3: 모바일 카드 header 정리**

- 문항명/상태/저장 버튼이 390px에서 겹치지 않도록 header를 모바일 `flex-col`, `sm:flex-row`로 구성한다.
- 저장 버튼은 모바일에서 `w-full`, `sm:w-auto`를 사용한다.
- 별점과 태그 영역은 모바일에서 줄바꿈을 허용한다.

- [ ] **Step 4: 접근성 계약 테스트 실행**

Run:

```bash
node --test \
  --test-name-pattern='preview card exposes accessible checkbox rating tag controls and save-status copy' \
  tests/listboard-job-progress-ux.test.mjs
```

Expected: 상태 문구, checkbox, 별점, 태그 ARIA subtest 모두 pass.

**검증 gate:** 키보드·스크린리더용 이름과 상태가 source contract에서 확인되어야 Phase 6로 진행한다.

---

### Phase 6: 통합 검증과 시각 검증

**Files:**
- Verify only: 위 변경 파일과 테스트

- [ ] **Step 1: 전체 관련 contract test 실행**

```bash
node --test \
  tests/listboard-job-progress-ux.test.mjs \
  tests/listboard-job-partial-success.test.mjs \
  tests/listboard-job-retry-feedback.test.mjs
```

Expected: 모든 subtest pass, `fail 0`.

- [ ] **Step 2: 변경 파일 scoped lint 실행**

```bash
npx eslint \
  'src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx' \
  'src/components/features/quiz/batch-question-preview-card.tsx' \
  'src/app/(dashboard)/library/purchased/purchased-client.tsx'
```

Expected: exit code 0.

- [ ] **Step 3: 전체 lint 실행**

```bash
npm run lint
```

Expected: exit code 0. 기존 unrelated lint 문제가 있으면 변경 파일 scoped lint 결과와 분리하여 기록하고, 이번 기능 범위 밖 코드는 수정하지 않는다.

- [ ] **Step 4: production build 실행**

```bash
npm run build
```

Expected: Next.js production build exit code 0.

- [ ] **Step 5: 브라우저 검증용 상태 데이터 준비**

필수 실제 흐름은 로그인된 로컬 개발 계정과 3개 문항 job으로 준비한다.

1. `/english/generate/boards/<board-slug>/posts/<post-id>`에서 3개 생성 요청을 시작한다.
2. 새 job URL을 기록하고 생성 중 화면을 확인한다.
3. 생성 종료 후 완료 결과에서 1개만 저장한다.
4. 같은 job에서 나머지 1개를 추가 저장해 purchased 화면이 최신 요청 1개가 아니라 해당 job 누적 저장 결과를 보여주는지 확인한다.

부분 성공/전체 실패는 AI 응답에 따라 비결정적이므로 다음 순서로 검증한다.

1. 테스트 계정에 기존 `partially_completed` 또는 `failed` job이 있으면 해당 job URL로 재진입해 확인한다.
2. 해당 상태 job이 없으면 운영/공유 DB row를 임의 수정하지 않는다.
3. 이 경우 partial/failed는 source-contract와 기존 retry 테스트를 필수 증거로 사용하고, 브라우저 검증은 `미재현(테스트 데이터 없음)`으로 분리 보고한다. 이는 전체 구현 실패로 간주하지 않되 자동 계약 테스트는 반드시 통과해야 한다.

- [ ] **Step 6: 실제 브라우저 상태별 검증**

```bash
npm run dev
```

검증 viewport:

- Mobile: `390x844`
- Tablet: `768x1024`
- Desktop: `1440x900`

상태별 pass 기준:

1. `queued/running`: progress bar와 현재 문항이 보이고 raw 상태값이 없다.
2. `running + completed item`: 완료 카드와 선택 저장 CTA가 즉시 보인다.
3. `completed`: 검토/선택 저장이 primary action이다.
4. `partially_completed`: 성공 저장과 실패 retry가 모두 가능하다.
5. `failed`: 저장 toolbar는 숨고 retry가 primary action이다.
6. `saved`: 저장된 카드는 재저장 불가이며 저장 완료 dialog가 열린다.
7. dialog의 `영어문제 관리에서 보기`: `/library/purchased?jobId=<id>&subject=<subject>`로 이동한다.
8. purchased 화면: `이 생성 작업에서 저장한 문제 N개` banner와 해당 job의 저장 문제만 표시된다.
9. 모든 viewport에서 가로 overflow, 버튼 겹침, 잘린 sticky toolbar가 없다.
10. Tab/Enter/Space로 checkbox, 별점, 태그, 저장, retry, dialog CTA를 조작할 수 있다.

- [ ] **Step 7: 최종 diff 검토**

```bash
git diff --check
git diff --stat
git status --short
```

Expected:

- whitespace error 없음
- 계획에 명시한 source/test/plan 파일만 변경
- `.omx/context/...`는 planning runtime 기록이며 git commit 대상에서 제외
- API/DB/migration 변경 없음

- [ ] **Step 8: 검증 완료 후 구현 commit 생성**

```bash
git add \
  docs/superpowers/plans/2026-07-15-listboard-batch-generation-progress-ux.md \
  'src/app/(dashboard)/generate/boards/[slug]/posts/[postId]/jobs/[jobId]/job-status-client.tsx' \
  'src/components/features/quiz/batch-question-preview-card.tsx' \
  'src/app/(dashboard)/library/purchased/purchased-client.tsx' \
  tests/listboard-job-progress-ux.test.mjs \
  tests/listboard-job-partial-success.test.mjs \
  tests/listboard-job-retry-feedback.test.mjs
git commit -m 'feat: improve batch generation progress UX'
```

**최종 검증 gate:** 관련 테스트, scoped lint, build, 상태별 브라우저 검증, diff check가 모두 통과해야 구현 완료로 판단한다. 전체 lint에 기존 unrelated 실패가 남으면 해당 실패를 별도 증거와 함께 보고한다.

---

## 6. 최종 Acceptance Criteria

1. 사용자는 화면 진입 후 5초 이내에 전체 생성 개수, 완료 개수, 현재 생성 중인 문항을 찾을 수 있다.
2. 화면에 `queued`, `running`, `completed`, `unsaved`, `save_failed` raw 상태 문자열이 표시되지 않는다.
3. 생성 중에도 비례 progress bar가 표시되고 접근 가능한 progressbar 의미를 가진다.
4. 완료된 문제가 하나라도 생기면 전체 job 종료 전에도 미리보기·선택·저장이 가능하다.
5. 완료 결과가 없을 때 비활성 저장 toolbar가 노출되지 않는다.
6. 부분 성공 상태에서 완료 문제 저장과 실패 문제 재시도를 모두 수행할 수 있다.
7. 생성 완료와 영어문제 관리 저장 완료가 문구와 단계에서 명확히 구분된다.
8. 저장 성공 후 `계속 검토하기`와 `영어문제 관리에서 보기`를 제공한다.
9. 영어문제 관리 이동 URL은 `jobId`와 `workspaceSubject`를 모두 보존한다.
10. 저장된 문제는 `/library/purchased`에서 해당 생성 job의 저장 문제 banner와 함께 확인된다.
11. 미리보기 카드의 선택·별점·태그·저장 컨트롤에 접근 가능한 이름이 있다.
12. 390px, 768px, 1440px viewport에서 가로 overflow나 CTA 겹침이 없다.
13. 기존 partial-success 및 retry/save accounting contract test가 계속 통과한다.
14. API, DB schema, AI 생성 로직, 크레딧 로직에는 변경이 없다.

---

## 7. ADR

### Decision

기존 job route와 API/DB 상태 모델을 유지하고, `JobStatusClient`를 상태 기반 단계형 UX로 재구성한다. 생성 완료 안내는 inline으로 제공하고 저장 완료에만 행동 선택 dialog를 사용한다.

### Drivers

- 새로고침·재진입 가능한 durable job URL 유지
- partial-success와 선택 저장 계약 보존
- 최소 변경으로 사용자 인지 부담 감소

### Alternatives considered

- 게시글 화면 내부 FORM/RESULT 전환
- 현재 화면의 문구만 한글화
- API에서 생성 즉시 자동 저장

### Why chosen

채택안만 현재 아키텍처를 유지하면서 개인지문 흐름의 장점인 검토·선택 저장·저장 목록 확인을 제공한다. 자동 저장이나 route 통합은 기존 staging/partial-success 설계를 약화한다.

### Consequences

- `job-status-client.tsx`의 UI 변경 폭은 크지만 서버 계약 변경 위험은 없다.
- 파일 크기 증가 위험을 줄이기 위해 진행 UI에 새 mutable state를 추가하지 않고 기존 job/items에서 파생한다. 생성 완료 dialog 상태를 제거하고 저장 완료 dialog 상태만 추가해 상태 총량을 제한한다.
- source-contract 테스트가 문구에 민감해지므로 문구 변경 시 테스트도 함께 갱신해야 한다.
- source-contract 테스트는 runtime 상호작용을 증명하지 못하므로 Phase 6의 실제 브라우저·키보드·3 viewport 검증을 필수 gate로 둔다.
- 정확한 ETA, 백그라운드 실행 보장, 취소는 별도 후속 과제로 남는다.

### Follow-ups

- 실제 생성 시간 데이터가 축적된 뒤 ETA 제공 여부 재검토
- long-running POST를 queue worker로 이전한 뒤 페이지 이탈 안내 검토
- 취소/환불 정책이 정의된 뒤 cancel API와 UI 별도 계획 수립

---

## 8. 구현 오케스트레이션 권장안

### 사용 가능한 역할

- `designer`: 상태별 UI·카피·반응형 검토
- `executor`: 테스트와 component 구현
- `debugger`: polling/partial-success 회귀 분석
- `test-engineer`: contract test 및 브라우저 시나리오
- `code-reviewer`: 전체 diff 리뷰
- `verifier`: 최종 claim/명령/브라우저 증거 검증
- `critic`: 계획 또는 구현의 누락·위험 도전

### `$ralph` 순차 실행 권장 구성

1. `executor` — Phase 0~5를 순차 구현, reasoning high 권장
2. `code-reviewer` — partial-success/접근성/과도한 변경 검토, reasoning high
3. `verifier` — Phase 6 명령과 브라우저 증거 확인, reasoning high

Launch hint:

```text
$ralph docs/superpowers/plans/2026-07-15-listboard-batch-generation-progress-ux.md 계획을 Phase별 검증 gate를 지키며 구현해줘.
```

### `$team` 병렬 실행 권장 구성

- Lane 1 `executor`: `job-status-client.tsx`와 progress UX
- Lane 2 `executor`: `batch-question-preview-card.tsx` 접근성·반응형
- Lane 3 `executor`(test-engineer 책임): 신규/기존 contract tests와 검증 명령
- 통합 후 `code-reviewer` → `verifier` 순차 검증

파일 소유권을 위처럼 분리하고 공통 파일인 테스트 계약 변경은 Lane 3만 편집한다.

Launch hint:

```bash
omx team 3:executor "docs/superpowers/plans/2026-07-15-listboard-batch-generation-progress-ux.md를 파일 소유권 분리와 Phase gate에 따라 구현"
```

### Team verification path

1. 각 lane이 담당 파일 scoped test/lint 결과를 leader에게 제출한다.
2. leader가 통합 후 세 contract test를 한 번에 실행한다.
3. `code-reviewer`가 API/DB 무변경, partial-success 보존, UI 문구 일관성을 확인한다.
4. `verifier`가 build, 3개 viewport, 저장 후 purchased 이동 증거를 확인한다.
5. 모든 gate 통과 후에만 commit하고 완료 처리한다.
