# 시험지+답안 문제전체-답안전체 구조 변경 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PDF 저장 설정의 표시모드 `시험지+답안`에서 1단/2단 모두 현재의 `문제1→답안1→문제2→답안2` 구조를 `문제 전체→답안 전체` 구조로 변경한다.

**Architecture:** 기존 렌더러/CSS는 최대한 유지하고, `exam-with-answers` 모드에서만 layout input sequence를 분리한다. 1단은 single-column placement 단계에서 “문제 그룹 전체” 뒤에 “답안 fragment 그룹 전체”가 오도록 하고, 2단은 DOM 측정 전 chunk source가 question-only chunks 뒤에 answer-only chunks를 반환하도록 바꾼다. 이렇게 하면 기존 hidden iframe 측정, HTML PDF route, 인쇄/저장 snapshot 재사용 흐름을 그대로 활용한다.

**Tech Stack:** Next.js App Router, TypeScript, HTML print preview, Playwright/Chromium PDF route, Node test runner, existing exam-paper layout utilities.

---

## 현재 코드 분석

### 요구사항 이해
- 변경 대상은 PDF 저장 설정의 표시모드 `시험지+답안`이다.
- 현재 구조: 각 문항 내부에 답안이 붙는다.
  - 1단: `문제1 본문/선지 → 문제1 답안 → 문제2 본문/선지 → 문제2 답안`
  - 2단: `question-1-* chunks → question-1-answer chunks → question-2-* chunks → question-2-answer chunks`
- 목표 구조:
  - `문제1 본문/선지 → 문제2 본문/선지 → ... → 문제N 본문/선지 → 답안1 → 답안2 → ... → 답안N`
- `시험지` 모드와 `답안` 모드는 기존 동작을 유지한다.

### 코드 근거
- `src/lib/exam-paper-layout-contract.ts`
  - `buildExamPaperRenderOptions()`는 `exam-with-answers`에서 `showQuestions=true`, `showAnswers=true`를 반환한다.
  - `buildQuestionSectionPlan()`은 하나의 question plan 안에 question sections를 먼저 넣고, 마지막에 answer section을 append한다. 따라서 2단의 선형 chunk 순서가 문항별 문제+답안 구조가 된다.
- `src/lib/exam-paper-single-column-layout.ts`
  - `buildSingleColumnQuestionGroups()`는 각 question group 안에 `promptBlocks`, `choiceBlocks`, `answerBlocks`를 함께 만든다.
  - `buildSingleColumnPlacementSteps()`는 기본적으로 `[promptBlocks, choiceBlocks, answerBlocks]` 순서로 배치한다. 따라서 1단도 문항별 문제+답안 구조가 된다.
- `src/lib/export-utils.ts`
  - 1단 `buildSingleColumnPreviewPages()`는 질문별 groups를 만든 뒤 `paginateSingleColumnQuestionGroups()`에 그대로 넘긴다.
  - 2단 `buildTwoColumnPreviewChunks()`는 `buildQuestionSectionPlan()` 결과를 `buildTwoColumnLinearFragmentPlans()`로 flatten한다.
  - 최근 변경된 2단 DOM 측정 경로는 `buildExamPaperTwoColumnMeasurementHtml()` → `buildTwoColumnPreviewChunks()`를 사용하므로, 2단은 chunk source만 바꾸면 측정/저장/인쇄까지 같은 구조를 따른다.
- `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
  - 1단 측정은 컴포넌트 안에서 직접 `buildSingleColumnQuestionGroups()`를 호출한다. 따라서 1단 구조 변경은 export-utils뿐 아니라 workspace 측정 입력도 같이 바꿔야 한다.

---

## Loop 1: 문제분석 → 계획 수립 → 계획 검증

### 1. 문제분석
- 단순히 렌더 HTML에서 answer DOM을 뒤로 옮기면 1단 측정 pagination과 2단 DOM-measured pagination이 깨진다.
- 올바른 변경 지점은 “렌더 이후 DOM 재배치”가 아니라 “pagination 이전 block/chunk sequence 생성 단계”다.
- 1단과 2단은 sequence 생성 방식이 다르므로 각각의 공통 helper가 필요하다.

### 2. 해결책 개선방안 계획 수립
- 1단: single-column layout에 `exam-with-answers` 전용 group builder를 추가해 문제 그룹과 답안 그룹을 분리한다.
- 2단: export-utils의 2단 chunk builder에서 `exam-with-answers`일 때 question-only plan과 answer-only plan을 따로 만들고 이어 붙인다.
- 측정 경로: workspace와 measurement HTML이 같은 helper를 사용하게 만든다.
- 테스트: 1단 HTML 순서, 2단 chunk 순서, 2단 measured final HTML 순서를 모두 검증한다.

### 3. 수립된 계획 검증
- PASS 조건:
  - 1단 측정 입력과 최종 HTML이 같은 separated group sequence를 사용한다.
  - 2단 measurement HTML과 final HTML이 같은 separated chunk sequence를 사용한다.
  - `exam-only`, `answer-only` 모드는 기존 builder 경로를 유지한다.
- Loop 1 검증 결과: **부분 FAIL**
  - 1단 답안 영역은 answer-only처럼 fragmentable해야 하는데 기존 `groupAnswerOnlyQuestion`은 전체 paginator에 전역 적용되어 question groups와 answer groups를 함께 다룰 수 없다.
  - 보완 필요: group 단위 placement mode를 추가한다.

---

## Loop 2: 문제분석 → 계획 수립 → 계획 검증

### 1. 문제분석
- 1단에서는 “문제 그룹은 prompt/choice 배치”, “답안 그룹은 answer fragments 배치”가 한 pagination run 안에 공존해야 한다.
- 기존 `groupAnswerOnlyQuestion` boolean은 모든 groups를 answer-only처럼 처리하므로 `exam-with-answers separated`에는 맞지 않는다.

### 2. 해결책 개선방안 계획 수립
- `SingleColumnQuestionGroups`에 `placementMode?: 'default' | 'answer-fragments'`를 추가한다.
- `buildSingleColumnPlacementSteps()`는 `group.placementMode === 'answer-fragments'`이면 해당 group만 answer fragments로 배치한다.
- 새 helper `buildSingleColumnExamWithAnswersSeparatedGroups(questions)`를 만든다.
  - 앞부분: `showQuestions=true, showAnswers=false` question groups
  - 뒷부분: `showQuestions=false, showAnswers=true`, `placementMode='answer-fragments'` answer groups
- export-utils와 workspace 측정 모두 이 helper를 사용한다.

### 3. 수립된 계획 검증
- PASS 조건:
  - 1단 question groups는 기존 문제 pagination을 유지한다.
  - 1단 answer groups는 긴 해설을 page 간 fragment continuation할 수 있다.
  - 2단은 question-only chunks 뒤 answer-only chunks 구조를 가진다.
  - 기존 2단 measured pagination은 chunk order만 바뀌고 알고리즘은 그대로 작동한다.
- Loop 2 검증 결과: **PASS**
  - 구현 단위가 기존 책임 경계를 깨지 않고, 측정 경로와 최종 렌더 경로의 sequence mismatch도 제거한다.

---

## File Structure / Responsibilities

- Modify: `src/lib/exam-paper-single-column-layout.ts`
  - 1단 `exam-with-answers` separated 구조를 만들기 위한 group-level placement mode와 helper 제공.
- Modify: `src/lib/export-utils.ts`
  - 최종 HTML 렌더와 2단 measurement HTML의 source sequence를 `문제 전체→답안 전체`로 변경.
- Modify: `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
  - 1단 측정 입력도 separated groups helper를 사용하게 변경.
- Modify: `tests/exam-paper-single-column-regression.test.mjs` 또는 Create: `tests/exam-paper-exam-with-answers-separated.test.mjs`
  - 1단 HTML 순서 회귀 테스트.
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs` 또는 Create: `tests/exam-paper-exam-with-answers-separated.test.mjs`
  - 2단 chunk/DOM 순서 회귀 테스트.
- Modify if needed: `tests/exam-paper-browser-pdf-viewer.test.mjs`
  - workspace 측정 입력이 새 helper를 사용하는 source contract 검증.

---

## Implementation Tasks

### Task 1: 1단 separated group model 추가

**Files:**
- Modify: `src/lib/exam-paper-single-column-layout.ts`
- Test: `tests/exam-paper-exam-with-answers-separated.test.mjs`

- [ ] **Step 1: failing test 작성 — 1단 block order는 모든 문제 뒤 모든 답안이어야 한다**

Create or update `tests/exam-paper-exam-with-answers-separated.test.mjs` with this runtime import helper so Node can resolve the repo's `@/` aliases:

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const singleColumnLayoutSource = readFileSync(
  new URL('../src/lib/exam-paper-single-column-layout.ts', import.meta.url),
  'utf8'
)
const paginationModuleUrl = new URL(
  '../src/lib/exam-paper-pdf-pagination.js',
  import.meta.url
).href
const normalizeQuestionFieldModuleUrl = new URL(
  '../src/lib/questions/normalize-question-field.ts',
  import.meta.url
).href

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-separated-single-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

const examPaperQuestions = [
  {
    number: 1,
    questionText: 'Question one?',
    questionTextForward: null,
    passageText: 'Passage one.',
    questionTextBackward: null,
    choices: [{ label: '①', text: 'A' }],
    answer: '①',
    explanation: 'Answer one explanation.',
  },
  {
    number: 2,
    questionText: 'Question two?',
    questionTextForward: null,
    passageText: 'Passage two.',
    questionTextBackward: null,
    choices: [{ label: '①', text: 'B' }],
    answer: '①',
    explanation: 'Answer two explanation.',
  },
]

test('single-column exam-with-answers separates all questions before all answers', async () => {
  const {
    buildSingleColumnExamWithAnswersSeparatedGroups,
    paginateSingleColumnQuestionGroups,
  } = await loadRuntimeSingleColumnLayoutModule()
  const groups = buildSingleColumnExamWithAnswersSeparatedGroups(examPaperQuestions)
  const pages = paginateSingleColumnQuestionGroups({
    questionGroups: groups,
    hasDescription: false,
  })
  const blockKinds = pages.flatMap((page) => page.blocks.map((block) => `${block.questionNumber}:${block.kind}`))

  assert.deepEqual(blockKinds, [
    '1:header',
    '1:body',
    '1:choice-row',
    '2:header',
    '2:body',
    '2:choice-row',
    '1:answer',
    '2:answer',
  ])
})
```

- [ ] **Step 2: test failure 확인**

Run:

```bash
node --test tests/exam-paper-exam-with-answers-separated.test.mjs
```

Expected: FAIL because `buildSingleColumnExamWithAnswersSeparatedGroups` does not exist.

- [ ] **Step 3: minimal implementation**

Modify `src/lib/exam-paper-single-column-layout.ts`:

```ts
export interface SingleColumnQuestionGroups {
  questionNumber: number
  promptBlocks: SingleColumnBlock[]
  choiceBlocks: SingleColumnBlock[]
  answerBlocks: SingleColumnBlock[]
  placementMode?: 'default' | 'answer-fragments'
}

export function buildSingleColumnExamWithAnswersSeparatedGroups(
  questions: SingleColumnQuestionLike[]
): SingleColumnQuestionGroups[] {
  const questionGroups = questions.map((question) => (
    buildSingleColumnQuestionGroups(question, {
      showQuestions: true,
      showAnswers: false,
    })
  ))

  const answerGroups = questions.map((question) => ({
    ...buildSingleColumnQuestionGroups(question, {
      showQuestions: false,
      showAnswers: true,
    }),
    placementMode: 'answer-fragments' as const,
  }))

  return [...questionGroups, ...answerGroups]
}

export function buildSingleColumnPlacementSteps(
  group: SingleColumnQuestionGroups,
  { groupAnswerOnlyQuestion = false }: SingleColumnPlacementOptions = {}
): SingleColumnPlacementStep[] {
  if (group.placementMode === 'answer-fragments' || groupAnswerOnlyQuestion) {
    return [{
      type: 'answer-fragments',
      blocks: group.answerBlocks,
    }]
  }

  return [
    { type: 'atomic-group', blocks: group.promptBlocks },
    { type: 'choice-rows', blocks: group.choiceBlocks },
    { type: 'atomic-group', blocks: group.answerBlocks },
  ]
}
```

- [ ] **Step 4: test pass 확인**

Run:

```bash
node --test tests/exam-paper-exam-with-answers-separated.test.mjs
```

Expected: PASS.

---

### Task 2: 1단 최종 HTML과 측정 입력을 separated groups로 연결

**Files:**
- Modify: `src/lib/export-utils.ts`
- Modify: `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
- Test: `tests/exam-paper-exam-with-answers-separated.test.mjs`
- Test: `tests/exam-paper-browser-pdf-viewer.test.mjs`

- [ ] **Step 1: failing test 작성 — export HTML에서 답안은 마지막 문제 뒤에 나와야 한다**

Add test:

```js
test('single-column exam-with-answers HTML renders all answers after the last question choice', async () => {
  const html = await buildPreviewHtml({
    title: 'Separated single',
    description: undefined,
    viewMode: 'exam-with-answers',
    columnLayout: 'single',
    questions: examPaperQuestions,
  })

  const question2ChoiceIndex = html.indexOf('data-block-id="question-2-choice-0"')
  const answer1Index = html.indexOf('data-block-id="question-1-answer')
  const answer2Index = html.indexOf('data-block-id="question-2-answer')

  assert.ok(question2ChoiceIndex > -1, 'expected question 2 choice block')
  assert.ok(answer1Index > question2ChoiceIndex, 'expected answer 1 after all question blocks')
  assert.ok(answer2Index > answer1Index, 'expected answer 2 after answer 1')
})
```

- [ ] **Step 2: test failure 확인**

Run:

```bash
node --test tests/exam-paper-exam-with-answers-separated.test.mjs
```

Expected: FAIL because current HTML has answer 1 before question 2.

- [ ] **Step 3: export-utils 연결**

Modify imports and `buildSingleColumnPreviewPages()` in `src/lib/export-utils.ts`:

```ts
import {
  buildSingleColumnExamWithAnswersSeparatedGroups,
  buildSingleColumnQuestionGroups,
  paginateSingleColumnQuestionGroups,
  type SingleColumnBlock,
  type SingleColumnPagePlan,
} from '@/lib/exam-paper-single-column-layout'

function buildSingleColumnPreviewPages(
  examPaper: ExamPaper,
  {
    showQuestions,
    showAnswers,
    groupAnswerOnlyQuestion,
    separateExamWithAnswers = false,
  }: {
    showQuestions: boolean
    showAnswers: boolean
    groupAnswerOnlyQuestion: boolean
    separateExamWithAnswers?: boolean
  }
) {
  const questionGroups = separateExamWithAnswers
    ? buildSingleColumnExamWithAnswersSeparatedGroups(examPaper.questions)
    : examPaper.questions.map((question) => (
      buildSingleColumnQuestionGroups(question, {
        showQuestions,
        showAnswers,
      })
    ))

  return paginateSingleColumnQuestionGroups({
    questionGroups,
    hasDescription: Boolean(examPaper.description),
    groupAnswerOnlyQuestion,
  })
}
```

And pass the flag in `buildExamPaperPrintHtml()`:

```ts
const singleColumnPages = !isDoubleColumn
  ? singleColumnMeasuredPages ?? buildSingleColumnPreviewPages(examPaper, {
    showQuestions,
    showAnswers,
    groupAnswerOnlyQuestion: !showQuestions && showAnswers,
    separateExamWithAnswers: renderOptions.viewMode === 'exam-with-answers',
  })
  : null
```

- [ ] **Step 4: workspace 1단 measurement 입력 연결**

Modify `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx` import:

```ts
import {
  buildSingleColumnExamWithAnswersSeparatedGroups,
  buildSingleColumnQuestionGroups,
} from '@/lib/exam-paper-single-column-layout'
```

Replace measurement questionGroups expression:

```ts
questionGroups: viewMode === 'exam-with-answers'
  ? buildSingleColumnExamWithAnswersSeparatedGroups(exportPayload.questions)
  : exportPayload.questions.map((question) => (
    buildSingleColumnQuestionGroups(question, {
      showQuestions: viewMode !== 'answer-only',
      showAnswers: viewMode !== 'exam-only',
    })
  )),
```

- [ ] **Step 5: tests pass 확인**

Run:

```bash
node --test tests/exam-paper-exam-with-answers-separated.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs
```

Expected: PASS.

---

### Task 3: 2단 chunk source를 문제전체→답안전체로 변경

**Files:**
- Modify: `src/lib/export-utils.ts`
- Test: `tests/exam-paper-exam-with-answers-separated.test.mjs`
- Test: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: failing test 작성 — 2단 preview chunks에서 answer chunks는 모든 question chunks 뒤에 있어야 한다**

Add test:

```js
test('two-column exam-with-answers chunks place all answers after all question chunks', async () => {
  const exportUtils = await loadRuntimeExportUtils()
  const layout = await loadRuntimeLayoutContractModule()
  const examPaper = {
    title: 'Separated double',
    viewMode: 'exam-with-answers',
    columnLayout: 'double',
    questions: examPaperQuestions,
  }
  const renderOptions = layout.module.buildExamPaperRenderOptions(examPaper)
  const chunks = exportUtils.buildTwoColumnPreviewChunks(examPaper, renderOptions)
  const ids = chunks.map((chunk) => chunk.id)

  assert.deepEqual(ids.filter((id) => id.includes('-answer')), [
    'question-1-answer',
    'question-2-answer',
  ])
  assert.ok(
    ids.indexOf('question-1-answer') > ids.indexOf('question-2-choice'),
    `expected first answer after last question choice, got ${ids.join(', ')}`
  )
})
```

- [ ] **Step 2: test failure 확인**

Run:

```bash
node --test tests/exam-paper-exam-with-answers-separated.test.mjs
```

Expected: FAIL because current `buildTwoColumnPreviewChunks()` emits question 1 answer before question 2.

- [ ] **Step 3: 2단 separated chunk helper 추가**

Modify `src/lib/export-utils.ts`:

```ts
function buildSeparatedExamWithAnswersTwoColumnChunks(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions
): HtmlPaginationChunk[] {
  const questionOptions: ExamPaperRenderOptions = {
    ...renderOptions,
    viewMode: 'exam-only',
    showQuestions: true,
    showAnswers: false,
  }
  const answerOptions: ExamPaperRenderOptions = {
    ...renderOptions,
    viewMode: 'answer-only',
    showQuestions: false,
    showAnswers: true,
  }

  const questionFragments = buildTwoColumnLinearFragmentPlans(
    examPaper.questions.map((question) => buildQuestionSectionPlan(question, questionOptions))
  )
  const answerFragments = buildTwoColumnLinearFragmentPlans(
    examPaper.questions.map((question) => buildQuestionSectionPlan(question, answerOptions))
  )

  return [
    ...questionFragments.map((fragment) => renderPlannedTwoColumnSectionHtml(fragment, true)),
    ...answerFragments.map((fragment) => renderPlannedTwoColumnSectionHtml(fragment, false)),
  ]
}

export function buildTwoColumnPreviewChunks(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions
): HtmlPaginationChunk[] {
  if (renderOptions.viewMode === 'exam-with-answers') {
    return buildSeparatedExamWithAnswersTwoColumnChunks(examPaper, renderOptions)
  }

  const questionPlans = examPaper.questions.map((question) => (
    buildQuestionSectionPlan(question, renderOptions)
  ))
  const fragments = buildTwoColumnLinearFragmentPlans(questionPlans)

  return fragments.map((fragment) => renderPlannedTwoColumnSectionHtml(
    fragment,
    renderOptions.showQuestions
  ))
}
```

- [ ] **Step 4: legacy fallback 2단 pages도 같은 순서로 맞추기**

Modify `buildTwoColumnPreviewPages()` so non-measured fallback does not reintroduce interleaving:

```ts
function buildSeparatedTwoColumnPreviewPages(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions
) {
  const questionOptions: ExamPaperRenderOptions = {
    ...renderOptions,
    viewMode: 'exam-only',
    showQuestions: true,
    showAnswers: false,
  }
  const answerOptions: ExamPaperRenderOptions = {
    ...renderOptions,
    viewMode: 'answer-only',
    showQuestions: false,
    showAnswers: true,
  }
  const questionPlans = examPaper.questions.map((question) => buildQuestionSectionPlan(question, questionOptions))
  const answerPlans = examPaper.questions.map((question) => buildQuestionSectionPlan(question, answerOptions))
  const layoutPlan = buildTwoColumnLayoutPlan({
    questionPlans: [...questionPlans, ...answerPlans],
    profile: 'shared-default',
    target: 'preview',
    hasDescription: Boolean(examPaper.description),
  })

  return layoutPlan.pages.map((page) => {
    const [left, right] = page.columns.map((column) => (
      mapPlannedSectionsToHtmlChunks(column.sections, renderOptions.showQuestions)
    )) as [HtmlPaginationChunk[], HtmlPaginationChunk[]]

    return { left, right }
  })
}

function buildTwoColumnPreviewPages(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions
) {
  if (renderOptions.viewMode === 'exam-with-answers') {
    return buildSeparatedTwoColumnPreviewPages(examPaper, renderOptions)
  }

  // existing implementation remains here
}
```

- [ ] **Step 5: tests pass 확인**

Run:

```bash
node --test tests/exam-paper-exam-with-answers-separated.test.mjs tests/exam-paper-two-column-reproduction.test.mjs
```

Expected: PASS.

---

### Task 4: 2단 measured final HTML 순서 검증

**Files:**
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs` or `tests/exam-paper-exam-with-answers-separated.test.mjs`

- [ ] **Step 1: final DOM order test 추가**

Add Playwright-based DOM order assertion:

```js
test('measured two-column exam-with-answers final HTML renders answer section after all questions', async () => {
  const examPaper = {
    title: 'Measured separated double',
    viewMode: 'exam-with-answers',
    columnLayout: 'double',
    questions: examPaperQuestions,
  }
  const html = await buildMeasuredTwoColumnPreviewHtml(examPaper)
  const orderedKinds = await extractOrderedSectionKinds(html)
  const lastQuestionIndex = Math.max(
    orderedKinds.findLastIndex((item) => item.kind === 'header'),
    orderedKinds.findLastIndex((item) => item.kind === 'body'),
    orderedKinds.findLastIndex((item) => item.kind === 'choice')
  )
  const firstAnswerIndex = orderedKinds.findIndex((item) => item.kind === 'answer')

  assert.ok(firstAnswerIndex > lastQuestionIndex, `expected all answers after all questions: ${JSON.stringify(orderedKinds)}`)
})
```

Helper:

```js
async function extractOrderedSectionKinds(html) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(250)

    return await page.evaluate(() => (
      [...document.querySelectorAll('[data-section-id]')].map((element) => ({
        id: element.getAttribute('data-section-id'),
        kind: element.getAttribute('data-section-kind'),
        questionNumber: Number(element.getAttribute('data-question-number')),
      }))
    ))
  } finally {
    await browser.close()
  }
}
```

- [ ] **Step 2: test pass 확인**

Run:

```bash
node --test tests/exam-paper-two-column-reproduction.test.mjs tests/exam-paper-exam-with-answers-separated.test.mjs
```

Expected: PASS.

---

### Task 5: 전체 회귀 검증

**Files:**
- No source file changes unless verification fails.

- [ ] **Step 1: targeted tests 실행**

Run:

```bash
node --test \
  tests/exam-paper-exam-with-answers-separated.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs \
  tests/exam-paper-browser-pdf-viewer.test.mjs \
  tests/exam-paper-direct-pdf-export.test.mjs \
  tests/exam-paper-print-pdf-route.test.mjs \
  tests/exam-paper-single-column-regression.test.mjs
```

Expected: PASS.

- [ ] **Step 2: TypeScript 확인**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: exit code 0.

- [ ] **Step 3: targeted ESLint 확인**

Run:

```bash
npx eslint \
  src/lib/exam-paper-single-column-layout.ts \
  src/lib/export-utils.ts \
  src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx \
  tests/exam-paper-exam-with-answers-separated.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs \
  tests/exam-paper-browser-pdf-viewer.test.mjs
```

Expected: exit code 0, except known baseline-browser-mapping warning if emitted.

- [ ] **Step 4: production build 확인**

Run:

```bash
npm run build
```

Expected: build PASS. Existing warnings about baseline-browser-mapping / workspace root / middleware convention may remain.

---

## 계획 검증 체크리스트

- [x] `시험지+답안` 요구사항을 1단과 2단 모두 포함했다.
- [x] `시험지`, `답안` 모드의 기존 구조를 바꾸지 않는다.
- [x] 1단 측정 입력과 최종 HTML 입력이 같은 separated groups helper를 공유한다.
- [x] 2단 measurement HTML과 final measured pagination이 같은 separated chunks helper를 공유한다.
- [x] 긴 답안/해설이 답안 전체 영역에서도 page/column continuation될 수 있다.
- [x] saved PDF/print는 기존 finalized previewHtml snapshot 흐름을 그대로 사용한다.
- [x] 검증 기준은 source-regex만이 아니라 block/chunk/DOM order를 직접 확인한다.

## Remaining Risks

- 기존 `src/lib/exam-paper-pdf.ts`의 legacy pdfmake 직접 생성 경로가 UI에서 다시 사용되는 곳이 있다면 별도 동기화가 필요하다. 최근 PDF workspace 저장은 HTML route를 사용하므로 이번 계획의 1차 범위는 HTML preview/save/print 경로다.
- HWPX/Word export까지 동일 구조를 요구한다면 `src/lib/hwpx-generator.ts`와 Word export path를 별도 계획으로 확장해야 한다.
