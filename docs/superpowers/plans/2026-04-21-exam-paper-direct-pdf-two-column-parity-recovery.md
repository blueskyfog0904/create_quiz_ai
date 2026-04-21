# Exam Paper Direct PDF Two-Column Parity Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹 PDF 저장 설정 화면의 2단 미리보기와 direct 저장 PDF가 같은 페이지 그룹/컬럼 배치/박스 배치를 사용하도록 복구한다.

**Architecture:** 현재 문제는 “저장 버튼 경로”보다 더 아래 단계인 2단 섹션 분해, 높이 추정, 페이지 capacity, anchor 결합 규칙이 preview HTML과 pdfMake에서 서로 다르게 유지되는 데서 발생한다. 해결은 `render option` 공유 수준을 넘어서, **같은 section plan + 보정된(shared) density profile + 같은 page planner 입력**을 두 렌더러가 함께 쓰도록 만드는 것이다. 여기서 density/capacity는 새 임의 상수를 만드는 것이 아니라, 현재 preview 경로의 배치 결과를 기준선으로 삼아 보정한다.

**Tech Stack:** Next.js 16, TypeScript, pdfMake, 기존 HTML preview renderer(`src/lib/export-utils.ts`), 공용 paginator(`src/lib/exam-paper-pdf-pagination.js`), Node test runner

---

## Requirements Summary
- 저장 PDF(2단)가 웹 미리보기와 같은 순서/컬럼 그룹을 사용해야 한다.
- page 1 / 3 / 6에서 보이던 대표 회귀(오른쪽 박스 clipping, 과도한 빈 공간, 정답 해설 panel 다음 페이지 밀림)를 재현 가능한 RED 테스트로 고정해야 한다.
- preview HTML과 direct PDF가 **동일한 question-section taxonomy**를 사용해야 한다.
- 높이 추정 및 capacity 기준은 한 곳에서 관리해야 하며, 상수는 preview 기준선에 맞춰 보정되어야 한다.
- critic 검증 전에는 완료로 간주하지 않는다.

## File Structure
- Create: `src/lib/exam-paper-two-column-layout.ts`
  - 2단 공용 section plan, density profile, page-plan 입력 생성
- Create: `src/lib/exam-paper-two-column-calibration.ts`
  - preview 기준선을 direct PDF 공용 units로 환산하는 보정 함수/상수 관리
- Modify: `src/lib/exam-paper-layout-contract.ts`
  - public contract/export surface만 유지, 새 공용 모듈 re-export 또는 얇은 facade 역할
- Modify: `src/lib/export-utils.ts`
  - HTML preview가 공용 section plan을 받아 HTML로 렌더
- Modify: `src/lib/exam-paper-pdf.ts`
  - pdfMake direct save가 같은 section plan을 받아 PDF node로 렌더
- Create: `tests/fixtures/exam-paper-two-column-regression.fixture.mjs`
  - page 1 / 3 / 6 drift를 재현하는 고정 fixture
- Create: `tests/exam-paper-two-column-plan-parity.test.mjs`
  - preview/PDF가 같은 section ordering / page grouping을 쓰는지 검증
- Modify: `tests/exam-paper-layout-contract.test.mjs`
  - shared contract가 실제 shared section planner까지 포함하도록 강화
- Modify: `tests/exam-paper-browser-pdf-viewer.test.mjs`
  - preview가 공용 section planner를 사용한다는 사실을 검증
- Modify: `tests/exam-paper-saved-pdf-parity.test.mjs`
  - pdfMake path가 공용 section planner를 사용하고 anchor/body/answer drift를 없앴는지 검증
- Modify: `scripts/playwright_verify_saved_pdf_profile.cjs`
  - 최대 창 + 저장 후 최신 PDF page 1/3/6 캡처 루프

---

### Task 1: 최신 회귀를 fixture + RED 테스트로 고정

**Files:**
- Create: `tests/fixtures/exam-paper-two-column-regression.fixture.mjs`
- Create: `tests/exam-paper-two-column-plan-parity.test.mjs`
- Modify: `tests/exam-paper-layout-contract.test.mjs`
- Test: `tests/exam-paper-two-column-plan-parity.test.mjs`

- [ ] **Step 1: 회귀 fixture 작성**

```js
// tests/fixtures/exam-paper-two-column-regression.fixture.mjs
export const regressionExamPaper = {
  title: '테스트 - 시험지',
  description: '테스트',
  viewMode: 'exam-only',
  columnLayout: 'double',
  questions: [
    {
      number: 1,
      questionText: '다음 밑줄 친 부분이 의미하는 바로 가장 적절한 것은? (2개)',
      questionTextForward: null,
      passageText: 'From an organizational viewpoint, one of the most fascinating examples ...',
      questionTextBackward: 'Because departments within an organization inevitably possess ...',
      choices: [
        { label: '①', text: 'have a narrow perspective limited to their own department\'s interests' },
        { label: '②', text: 'develop a physical eye condition that restricts their field of view' },
        { label: '③', text: 'cooperate harmoniously with other divisions to achieve a common goal' },
        { label: '④', text: 'fail to perceive situations from the viewpoints of other departments' },
        { label: '⑤', text: 'strictly follow the vertical hierarchy and rules of the organization' },
      ],
      answer: '①, ④',
      explanation: '정답: ①, ④\n해설: 조직 내 부서들이 편향된 관점을 가지기 때문에 ...',
    },
    // 실제 구현에서는 현재 회귀를 재현하는 6~8번 문항까지 이어서 채운다.
  ],
}
```

- [ ] **Step 2: page 1/3/6 회귀를 직접 겨냥한 RED 테스트 작성**

```js
// tests/exam-paper-two-column-plan-parity.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'
import {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnLayoutPlan,
} from '../src/lib/exam-paper-two-column-layout.ts'

function idsOf(plan) {
  return plan.pages.map((page) => page.columns.map((column) => column.sectionIds))
}

test('preview/pdf use the same section ids and page grouping for the regression fixture', () => {
  const options = buildExamPaperRenderOptions(regressionExamPaper)
  const questionPlans = regressionExamPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, options)
  )

  const previewPlan = buildTwoColumnLayoutPlan({ questionPlans, profile: 'shared-default', target: 'preview', hasDescription: true })
  const pdfPlan = buildTwoColumnLayoutPlan({ questionPlans, profile: 'shared-default', target: 'pdf', hasDescription: true })

  assert.deepEqual(idsOf(pdfPlan), idsOf(previewPlan))
})

test('page 1 keeps question 1 header/body in the left column before choices spill right', () => {
  const options = buildExamPaperRenderOptions(regressionExamPaper)
  const questionPlans = regressionExamPaper.questions.map((question) => buildQuestionSectionPlan(question, options))
  const plan = buildTwoColumnLayoutPlan({ questionPlans, profile: 'shared-default', target: 'pdf', hasDescription: true })

  assert.match(plan.pages[0].columns[0].sectionIds.join(' '), /question-1-header/)
  assert.match(plan.pages[0].columns[0].sectionIds.join(' '), /question-1-passage/)
  assert.doesNotMatch(plan.pages[0].columns[0].sectionIds.join(' '), /question-1-choice/)
})

test('page 3 keeps 4.1 answer panel on the same page group as its prompt', () => {
  const options = buildExamPaperRenderOptions({ ...regressionExamPaper, viewMode: 'exam-with-answers' })
  const questionPlans = regressionExamPaper.questions.map((question) => buildQuestionSectionPlan(question, options))
  const plan = buildTwoColumnLayoutPlan({ questionPlans, profile: 'shared-default', target: 'pdf', hasDescription: true })

  const flat = plan.pages.map((page) => page.columns.flatMap((column) => column.sectionIds))
  const targetPage = flat.findIndex((ids) => ids.some((id) => id.includes('question-4-header')))
  assert.notEqual(targetPage, -1)
  assert.match(flat[targetPage].join(' '), /question-4-answer/)
})
```

- [ ] **Step 3: contract test를 “render option 공유”에서 “shared section planner 공유”까지 강화**

```js
// tests/exam-paper-layout-contract.test.mjs
assert.match(sharedContractSource, /buildQuestionSectionPlan/)
assert.match(sharedContractSource, /buildTwoColumnLayoutPlan/)
assert.match(exportUtilsSource, /buildQuestionSectionPlan/)
assert.match(exportUtilsSource, /buildTwoColumnLayoutPlan/)
assert.match(examPaperPdfSource, /buildQuestionSectionPlan/)
assert.match(examPaperPdfSource, /buildTwoColumnLayoutPlan/)
```

- [ ] **Step 4: RED 확인**

Run: `node --test tests/exam-paper-two-column-plan-parity.test.mjs tests/exam-paper-layout-contract.test.mjs`

Expected: FAIL with one or more of:
- `buildQuestionSectionPlan is not defined`
- `buildTwoColumnLayoutPlan is not defined`
- `preview/pdf section ids differ`

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/exam-paper-two-column-regression.fixture.mjs tests/exam-paper-two-column-plan-parity.test.mjs tests/exam-paper-layout-contract.test.mjs
git commit -m "Lock the direct PDF two-column regression with shared-plan red tests"
```

---

### Task 2: preview 기준선으로 density/capacity 보정값 확정

**Files:**
- Create: `src/lib/exam-paper-two-column-calibration.ts`
- Create: `tests/exam-paper-two-column-density-calibration.test.mjs`
- Test: `tests/exam-paper-two-column-density-calibration.test.mjs`

- [ ] **Step 1: preview 기준선과 PDF 기준선의 unit 차이를 고정하는 RED 테스트 작성**

```js
// tests/exam-paper-two-column-density-calibration.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PREVIEW_TWO_COLUMN_BASELINE,
  calibrateTwoColumnUnits,
} from '../src/lib/exam-paper-two-column-calibration.ts'

test('pdf capacity and section units are derived from the preview baseline', () => {
  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf: {
      bodyLineUnit: 4.8,
      choiceLineUnit: 5,
      answerBaseUnit: 18,
      firstPageCapacity: 245,
      otherPageCapacity: 280,
    },
  })

  assert.equal(calibration.profile.firstPageCapacity, PREVIEW_TWO_COLUMN_BASELINE.firstPageCapacity)
  assert.equal(calibration.profile.otherPageCapacity, PREVIEW_TWO_COLUMN_BASELINE.otherPageCapacity)
  assert.ok(calibration.scaleRatio > 1)
})
```

- [ ] **Step 2: 보정 모듈 구현**

```ts
// src/lib/exam-paper-two-column-calibration.ts
export const PREVIEW_TWO_COLUMN_BASELINE = {
  firstPageCapacity: 1280,
  otherPageCapacity: 1280,
  bodyLineUnit: 23,
  choiceLineUnit: 22,
  answerBaseUnit: 156,
}

export function calibrateTwoColumnUnits({ preview, pdf }) {
  const scaleRatio = preview.bodyLineUnit / pdf.bodyLineUnit

  return {
    scaleRatio,
    profile: {
      firstPageCapacity: preview.firstPageCapacity,
      otherPageCapacity: preview.otherPageCapacity,
      bodyBaseUnit: Math.round(6 * scaleRatio),
      choiceBaseUnit: Math.round(5 * (preview.choiceLineUnit / pdf.choiceLineUnit)),
      answerBaseUnit: preview.answerBaseUnit,
    },
  }
}
```

- [ ] **Step 3: 보정 테스트 실행**

Run: `node --test tests/exam-paper-two-column-density-calibration.test.mjs`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/exam-paper-two-column-calibration.ts tests/exam-paper-two-column-density-calibration.test.mjs
git commit -m "Calibrate direct PDF two-column units against the preview baseline"
```

---

### Task 3: 공용 section planner + shared density profile 추출

**Files:**
- Create: `src/lib/exam-paper-two-column-layout.ts`
- Modify: `src/lib/exam-paper-layout-contract.ts`
- Test: `tests/exam-paper-two-column-plan-parity.test.mjs`

- [ ] **Step 1: 새 공용 모듈에 section plan type과 profile 연결부 정의**

```ts
// src/lib/exam-paper-two-column-layout.ts
import { buildExamPaperRenderOptions } from './exam-paper-layout-contract'
import { calibrateTwoColumnUnits } from './exam-paper-two-column-calibration'

export type TwoColumnSectionKind = 'header' | 'body' | 'choice' | 'answer'

export interface TwoColumnSectionPlan {
  id: string
  questionNumber: number
  kind: TwoColumnSectionKind
  sectionKey: string
  estimatedUnits: number
}
```

- [ ] **Step 2: shared question-section builder 구현**

```ts
export function buildQuestionSectionPlan(question, options) {
  const sections = []

  if (options.showQuestions) {
    sections.push({ id: `question-${question.number}-header`, questionNumber: question.number, kind: 'header', sectionKey: 'header', estimatedUnits: estimateHeaderUnits(question.questionText) })
    if (question.questionTextForward?.trim()) sections.push(createBodySection(question.number, 'forward', question.questionTextForward))
    if (question.passageText?.trim()) sections.push(createBodySection(question.number, 'passage', question.passageText))
    if (question.questionTextBackward?.trim()) sections.push(createBodySection(question.number, 'backward', normalizeQuestionTextBackward(question.questionTextBackward)))
    if (question.choices.length) sections.push(createChoiceSection(question))
  }

  if (options.showAnswers) sections.push(createAnswerSection(question))

  return { questionNumber: question.number, sections }
}
```

- [ ] **Step 3: shared layout planner 구현**

```ts
export function buildTwoColumnLayoutPlan({ questionPlans, hasDescription }) {
  const calibration = calibrateTwoColumnUnits({
    preview: PREVIEW_TWO_COLUMN_BASELINE,
    pdf: { bodyLineUnit: 4.8, choiceLineUnit: 5, answerBaseUnit: 18, firstPageCapacity: 245, otherPageCapacity: 280 },
  })

  return buildExamPaperLayoutPlan({
    questionPlans: questionPlans.map((questionPlan) => ({
      questionNumber: questionPlan.questionNumber,
      sections: questionPlan.sections.map((section) => ({
        id: section.id,
        estimatedHeight: section.estimatedUnits,
        kind: section.kind,
        payload: section,
      })),
    })),
    viewMode: 'exam-only',
    columnLayout: 'double',
    firstPageSlotCapacity: hasDescription ? calibration.profile.firstPageCapacity - 80 : calibration.profile.firstPageCapacity,
    otherPageSlotCapacity: calibration.profile.otherPageCapacity,
  })
}
```

- [ ] **Step 4: `exam-paper-layout-contract.ts`를 facade로 정리**

```ts
export {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnLayoutPlan,
} from './exam-paper-two-column-layout'
```

- [ ] **Step 5: GREEN 확인**

Run: `node --test tests/exam-paper-two-column-plan-parity.test.mjs tests/exam-paper-layout-contract.test.mjs tests/exam-paper-two-column-density-calibration.test.mjs`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/exam-paper-two-column-layout.ts src/lib/exam-paper-layout-contract.ts tests/exam-paper-two-column-plan-parity.test.mjs tests/exam-paper-layout-contract.test.mjs tests/exam-paper-two-column-density-calibration.test.mjs
git commit -m "Create a calibrated shared two-column section planner"
```

---

### Task 4: HTML preview를 shared section plan으로 전환

**Files:**
- Modify: `src/lib/export-utils.ts`
- Modify: `tests/exam-paper-browser-pdf-viewer.test.mjs`
- Test: `tests/exam-paper-browser-pdf-viewer.test.mjs`

- [ ] **Step 1: HTML chunk builder를 shared plan 소비 구조로 교체**

```ts
// src/lib/export-utils.ts
const questionPlans = examPaper.questions.map((question) =>
  buildQuestionSectionPlan(question, { showQuestions, showAnswers })
)

const pagePlan = buildTwoColumnLayoutPlan({
  questionPlans,
  profile: DEFAULT_TWO_COLUMN_LAYOUT_PROFILE,
  hasDescription: Boolean(examPaper.description),
})

const twoColumnChunkPages = pagePlan.pages.map((page) => ({
  left: page.columns[0].sections.map((section) => renderSectionHtml(section.payload, questionMap)),
  right: page.columns[1].sections.map((section) => renderSectionHtml(section.payload, questionMap)),
}))
```

- [ ] **Step 2: preview 전용 anchor/body 합성 제거**

```ts
function renderSectionHtml(sectionPlan, question) {
  switch (sectionPlan.kind) {
    case 'header':
      return {
        id: sectionPlan.id,
        estimatedHeight: sectionPlan.estimatedUnits,
        kind: 'header',
        html: `<div class="question-chunk question-chunk-anchor"><div class="question-text">${question.number}. ${escapeHtml(question.questionText)}</div></div>`,
      }
    case 'body':
      return buildBodyHtmlChunk(sectionPlan, question)
    case 'choice':
      return buildChoiceHtmlChunk(sectionPlan, question)
    case 'answer':
      return buildAnswerHtmlChunk(sectionPlan, question)
  }
}
```

- [ ] **Step 3: preview test를 shared planner 기준으로 강화**

```js
assert.match(exportUtilsSource, /buildQuestionSectionPlan/)
assert.match(exportUtilsSource, /buildTwoColumnLayoutPlan/)
assert.doesNotMatch(exportUtilsSource, /const textBoxChunks = \[/)
```

- [ ] **Step 4: 테스트 실행**

Run: `node --test tests/exam-paper-browser-pdf-viewer.test.mjs tests/exam-paper-two-column-plan-parity.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/export-utils.ts tests/exam-paper-browser-pdf-viewer.test.mjs
git commit -m "Make the two-column preview consume the shared section planner"
```

---

### Task 5: direct PDF renderer를 같은 section plan으로 전환

**Files:**
- Modify: `src/lib/exam-paper-pdf.ts`
- Modify: `tests/exam-paper-saved-pdf-parity.test.mjs`
- Test: `tests/exam-paper-saved-pdf-parity.test.mjs`

- [ ] **Step 1: pdfMake 전용 `buildQuestionChunksForTwoColumn`를 section-plan consumer로 교체**

```ts
const questionPlans = examPaper.questions.map((question) =>
  buildQuestionSectionPlan(question, { showQuestions, showAnswers })
)

const pagePlan = buildTwoColumnLayoutPlan({
  questionPlans,
  profile: DEFAULT_TWO_COLUMN_LAYOUT_PROFILE,
  hasDescription: Boolean(examPaper.description),
})

const contentPages = pagePlan.pages.map((page) => ({
  columns: [
    { stack: page.columns[0].sections.map((section) => renderSectionPdfNode(section.payload, questionMap)) },
    { stack: page.columns[1].sections.map((section) => renderSectionPdfNode(section.payload, questionMap)) },
  ],
  columnGap: 18,
}))
```

- [ ] **Step 2: PDF에서만 존재하던 anchor + firstBody 결합 제거**

```ts
function renderSectionPdfNode(sectionPlan, question) {
  if (sectionPlan.kind === 'header') {
    return {
      id: `question-body-${question.number}-header`,
      text: `${question.number}. ${question.questionText}`,
      style: 'questionText',
      margin: [0, 0, 0, 12],
    }
  }

  if (sectionPlan.kind === 'body') {
    return buildDecoratedBoxNode({
      text: buildInlineSegments(resolveBodyText(sectionPlan, question)),
      fontSize: 13,
      lineHeight: 1.8,
      color: '#374151',
    })
  }

  if (sectionPlan.kind === 'choice') {
    return {
      stack: question.choices.map((choice) => ({
        text: `${choice.label} ${choice.text}`,
        margin: [0, 0, 0, 8],
        fontSize: 13,
        lineHeight: 1.8,
      })),
    }
  }

  return buildAnswerSectionNode(buildAnswerStack(question), 10)
}
```

- [ ] **Step 3: saved-PDF parity test를 새 구조에 맞게 수정**

```js
assert.match(examPaperPdfSource, /buildQuestionSectionPlan/)
assert.match(examPaperPdfSource, /buildTwoColumnLayoutPlan/)
assert.doesNotMatch(examPaperPdfSource, /const anchorStack = firstBodyChunk/)
assert.doesNotMatch(examPaperPdfSource, /const bodyChunks = \[/)
```

- [ ] **Step 4: 테스트 실행**

Run: `node --test tests/exam-paper-saved-pdf-parity.test.mjs tests/exam-paper-two-column-plan-parity.test.mjs`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/exam-paper-pdf.ts tests/exam-paper-saved-pdf-parity.test.mjs
git commit -m "Make direct PDF consume the shared two-column section planner"
```

---

### Task 6: overflow-safe paginator 검증 가드 추가

**Files:**
- Modify: `src/lib/exam-paper-pdf-pagination.js`
- Create: `tests/exam-paper-pdf-pagination-regression.test.mjs`
- Test: `tests/exam-paper-pdf-pagination-regression.test.mjs`

- [ ] **Step 1: oversized chunk가 `Math.min(...)`으로 묻히지 않도록 RED 테스트 작성**

```js
// tests/exam-paper-pdf-pagination-regression.test.mjs
import assert from 'node:assert/strict'
import test from 'node:test'
import { paginateTwoColumnQuestionChunks } from '../src/lib/exam-paper-pdf-pagination.js'

test('oversized chunks still advance page usage with their true estimated height', () => {
  const pages = paginateTwoColumnQuestionChunks([
    {
      questionNumber: 1,
      chunks: [
        { id: 'q1-header', kind: 'header', estimatedHeight: 200, node: {} },
        { id: 'q1-body', kind: 'body', estimatedHeight: 900, node: {} },
        { id: 'q1-answer', kind: 'answer', estimatedHeight: 500, node: {} },
      ],
    },
  ], {
    firstPageSlotCapacity: 600,
    otherPageSlotCapacity: 600,
  })

  assert.ok(pages.length >= 2)
  assert.notDeepEqual(pages[0].left.map((x) => x.id), ['q1-header', 'q1-body', 'q1-answer'])
})
```

- [ ] **Step 2: paginator 수정**

```js
// src/lib/exam-paper-pdf-pagination.js
if (currentUsage > 0 && chunk.estimatedHeight > remaining) {
  moveToNextSlot()
  placeChunk(chunk)
  return
}

pages[pageIndex][columnKey].push(chunk)
usage[pageIndex][columnKey] += chunk.estimatedHeight
```

- [ ] **Step 3: 테스트 실행**

Run: `node --test tests/exam-paper-pdf-pagination-regression.test.mjs`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/exam-paper-pdf-pagination.js tests/exam-paper-pdf-pagination-regression.test.mjs
git commit -m "Stop hiding oversized two-column chunks in pagination math"
```

---

### Task 7: 최대 창 저장 검증 + critic gate

**Files:**
- Modify: `scripts/playwright_verify_saved_pdf_profile.cjs`
- Test: manual screenshots + critic review

- [ ] **Step 1: 저장 검증 스크립트를 최신 목표에 맞게 보강**

```js
// scripts/playwright_verify_saved_pdf_profile.cjs
const pagesToCapture = [1, 3, 6]

await page.setViewportSize({ width: 1728, height: 1117 })
await openPdfWorkspace(page)
await page.screenshot({ path: 'output_gui_pdf_workspace_maximized.png', fullPage: true })

await saveButton.click()
const latestPdf = await waitForLatestPdf(startedAt)
await capturePdfPages(context, latestPdf.absolutePath, pagesToCapture)
```

- [ ] **Step 2: 통합 검증 명령 실행**

Run:
```bash
node --test tests/exam-paper-two-column-plan-parity.test.mjs tests/exam-paper-layout-contract.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs tests/exam-paper-saved-pdf-parity.test.mjs tests/exam-paper-pdf-pagination-regression.test.mjs
npm run lint -- src/lib/exam-paper-two-column-layout.ts src/lib/exam-paper-layout-contract.ts src/lib/export-utils.ts src/lib/exam-paper-pdf.ts src/lib/exam-paper-pdf-pagination.js tests/exam-paper-two-column-plan-parity.test.mjs tests/exam-paper-layout-contract.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs tests/exam-paper-saved-pdf-parity.test.mjs tests/exam-paper-pdf-pagination-regression.test.mjs
npx tsc --noEmit --pretty false --project tsconfig.json
node scripts/playwright_verify_saved_pdf_profile.cjs http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02
```

Expected:
- 모든 test PASS
- lint exit code 0
- tsc exit code 0
- `output_gui_pdf_workspace_maximized.png`
- `output_saved_pdf_page1.png`
- `output_saved_pdf_page3.png`
- `output_saved_pdf_page6.png`
생성

- [ ] **Step 3: critic review 요청**

```text
Review the new direct-PDF two-column parity changes against the regression screenshots.
Verify that:
1. page 1 no longer starts with a blank left region,
2. page 3 no longer leaves the right answer panel on the wrong page,
3. page 6 no longer produces a near-empty page,
4. preview and saved-PDF now share the same section plan and capacity profile.
Return PASS / REVISE / REJECT.
```

- [ ] **Step 4: 최종 Commit**

```bash
git add src/lib/exam-paper-two-column-layout.ts src/lib/exam-paper-layout-contract.ts src/lib/export-utils.ts src/lib/exam-paper-pdf.ts src/lib/exam-paper-pdf-pagination.js tests/exam-paper-two-column-plan-parity.test.mjs tests/exam-paper-layout-contract.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs tests/exam-paper-saved-pdf-parity.test.mjs tests/exam-paper-pdf-pagination-regression.test.mjs scripts/playwright_verify_saved_pdf_profile.cjs
git commit -m "Restore two-column parity between preview and direct saved PDFs"
```

---

## Risks and Mitigations
- **위험:** HTML과 pdfMake의 실제 줄바꿈은 완전히 같지 않을 수 있음  
  **완화:** section plan / capacity profile / paginator 입력을 통일하고, renderer는 표현만 다르게 유지한다.
- **위험:** oversized chunk가 여전히 실제 렌더 높이를 초과할 수 있음  
  **완화:** paginator regression test를 추가하고, `usage += true estimated height`로 보정한다.
- **위험:** 기존 테스트가 문자열 정규식 수준에 머물 수 있음  
  **완화:** fixture 기반 page-plan parity test를 핵심 acceptance test로 둔다.

## Verification Steps
1. RED: shared planner 부재 또는 preview/pdf page id mismatch를 먼저 확인한다.
2. GREEN: shared section planner + shared capacity profile 도입 후 parity test를 녹인다.
3. REGRESSION: stale regex test 대신 section plan / overflow behavior / direct save wiring을 보호한다.
4. VISUAL: 최대 창 기준으로 page 1/3/6 저장물 캡처 후 critic PASS를 받는다.

## Acceptance Criteria
- `buildQuestionSectionPlan`과 `buildTwoColumnLayoutPlan`이 preview/PDF 모두의 단일 source of truth다.
- preview와 direct saved PDF가 같은 section id ordering / page grouping을 사용한다.
- page 1에서 `question-1-header`와 `question-1-passage`가 같은 left column 그룹에 남고, choice는 그 뒤에 이어진다.
- page 3에서 `question-4-header`와 `question-4-answer`가 같은 page group에 남는다.
- `Math.min(chunk.estimatedHeight, capacity)` 기반의 oversized chunk 왜곡이 제거된다.
- page 1 / 3 / 6 수동 캡처에서 사용자가 제기한 회귀(빈 영역, 잘린 박스, 잘못 밀린 answer panel)가 재현되지 않는다.
