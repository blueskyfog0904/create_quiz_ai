# 2단 DOM 측정 기반 Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단 시험지/답안 미리보기의 하단 과다 여백을 줄이기 위해, 문자열 길이/`estimatedUnits` 기반 page break를 실제 DOM 측정값 기반 page break로 교체하고 저장/인쇄가 같은 finalized HTML을 사용하게 만든다.

**Architecture:** `exam-paper-layout-contract.ts`는 문제를 선형 fragment list로 분해하는 책임만 가진다. 브라우저 측정 모듈은 최종 CSS와 같은 hidden iframe에서 fragment 실제 outer height와 페이지 usable height를 측정하고, `exam-paper-pdf-pagination.js`의 measured paginator가 px 기준으로 좌/우 컬럼과 페이지를 확정한다. `export-utils.ts`는 측정용 HTML과 최종 HTML을 같은 CSS로 렌더하고, `ExamPaperPdfWorkspace.tsx`가 2-pass 측정→최종 previewHtml 확정→저장/인쇄 재사용을 orchestration한다.

**Tech Stack:** Next.js App Router, React client component, TypeScript, browser DOM measurement, Playwright/Node test runner, existing HTML print preview CSS.

---

## 0. 문제분석 → 개선방안 계획 → 계획검증 Loop

### Loop 1 — FAIL

**문제분석**
- 2단 미리보기는 `buildTwoColumnLayoutPlan()` → `paginateTwoColumnQuestionChunks()`에서 `estimatedUnits`와 고정 slot capacity로 먼저 page/column을 끊는다.
- 실제 DOM 측정은 `ExamPaperPdfWorkspace.tsx`의 debug table 출력용일 뿐 pagination 입력으로 되먹임되지 않는다.

**개선방안 초안**
- `firstPageSlotCapacity`/`otherPageSlotCapacity`를 키우고 `DOUBLE_COLUMN_BOTTOM_GUARD_BAND_UNITS`를 줄인다.

**검증 결과: FAIL**
- 특정 fixture에는 맞을 수 있지만 다른 지문/해설에서는 overflow 또는 sparse page가 재발한다.
- 사용자의 목표는 preview/save/print의 시각적 일치이므로 추정값 보정은 root cause 해결이 아니다.

### Loop 2 — FAIL

**문제분석**
- 실제 DOM 측정 기반으로 전환해야 한다.
- 단일 컬럼처럼 측정 결과를 preview HTML 생성 전에 반영해야 한다.

**개선방안 초안**
- `buildTwoColumnLayoutPlan().pages`를 flatten해 측정 대상 chunk list로 사용한다.
- measured paginator 테스트는 기존 `buildPreviewHtml(examPaper)` 결과를 분석한다.

**검증 결과: FAIL**
- `buildTwoColumnLayoutPlan().pages` 자체가 문제의 legacy estimated paginator 결과이므로, 이를 flatten하면 측정 전부터 순서/분할이 이미 오염된다.
- 기존 `buildPreviewHtml(examPaper)`만 호출하는 테스트는 새 측정 경로를 실행하지 않으므로 measured path 검증이 아니다.
- `page.bottomRemainingPx` 단독 기준은 title/description/padding geometry가 섞여 원인을 분리하기 어렵다.

### Loop 3 — PASS

**문제분석 보정**
- 최종 chunk source는 page plan이 아니라 **question section → fragment 변환 직후의 선형 fragment list**여야 한다.
- 검증은 두 층으로 나눠야 한다.
  1. Node contract: measured pages를 주입하면 renderer가 그 page plan을 그대로 HTML로 렌더하는지 확인
  2. Browser integration: 실제 hidden iframe measurement를 실행해 usable bottom slack과 overflow를 확인
- 하단 여백 검증은 `page.bottomRemainingPx`뿐 아니라 `usableBottomRemainingPx = page bottom - bottom padding - deepest section bottom`을 함께 본다.

**개선방안 확정**
- `buildTwoColumnLinearFragmentPlans()`를 export해 legacy estimated paginator를 우회한다.
- `buildTwoColumnPreviewChunks()`는 선형 fragments를 HTML chunks로 렌더한다.
- hidden iframe에서 chunk outer height와 first/other page usable column height를 측정한다.
- measured paginator가 px 기준으로 pages를 확정한다.
- `buildExamPaperPrintHtml(..., { twoColumnMeasuredPages })`가 measured pages를 우선 렌더한다.
- workspace save/open/print는 finalized `previewHtml`만 사용한다.

**검증 결과: PASS**
- root cause인 estimated pagination 의존을 제거한다.
- 테스트가 실제 measured path를 실행한다.
- 파일 생성/수정 대상이 현재 repo 현실과 맞다.

---

## 1. 현재 원인 요약

### Evidence
- `src/lib/export-utils.ts:431-455` — `buildTwoColumnPreviewPages()`가 `buildTwoColumnLayoutPlan()` 결과를 HTML page로 렌더한다.
- `src/lib/exam-paper-layout-contract.ts:861-887` — 2단 layout plan이 fixed capacity와 guard band를 사용한다.
- `src/lib/exam-paper-pdf-pagination.js:208-219` — 현재 chunk가 remaining보다 크면 실제 DOM 높이를 보지 않고 다음 slot으로 이동한다.
- `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx:249-293` — actual DOM 측정은 debug-only다.
- `tests/exam-paper-two-column-reproduction.test.mjs:334-369` — 실제 DOM 기준 첫 페이지 하단 slack 회귀가 있다.

### Inference
2단 하단 여백은 pdfmake/Chromium 저장 엔진 이전 단계인 **HTML preview pagination 알고리즘 문제**다. 저장이 previewHtml을 그대로 쓰더라도 previewHtml이 덜 채워져 있으면 저장 PDF도 덜 채워진다.

---

## 2. File structure and responsibilities

### Modify: `src/lib/exam-paper-layout-contract.ts`

Responsibility after change:
- semantic section creation
- section → linear fragment list creation
- no final page/column decision for measured preview path

Add export:

```ts
export function buildTwoColumnLinearFragmentPlans(
  questionPlans: TwoColumnQuestionSectionPlan[]
): TwoColumnFragmentPlan[] {
  return questionPlans.flatMap((questionPlan) => (
    questionPlan.sections.flatMap(buildSectionFragments)
  ))
}
```

Keep `buildTwoColumnLayoutPlan()` as legacy/fallback for pdfmake or non-browser paths, but measured preview must not use it as chunk source.

### Modify: `src/lib/export-utils.ts`

Responsibility after change:
- render linear chunks to HTML
- build measurement HTML and final HTML using one shared style function
- accept `twoColumnMeasuredPages` as input

Types to export:

```ts
export interface HtmlPaginationChunk {
  id: string
  estimatedHeight: number
  kind: 'header' | 'body' | 'choice' | 'answer' | 'explanation'
  html: string
}

export interface TwoColumnMeasuredPagePlan {
  pageIndex: number
  columns: [HtmlPaginationChunk[], HtmlPaginationChunk[]]
}
```

### Modify: `src/lib/exam-paper-pdf-pagination.js`

Responsibility after change:
- keep existing estimated paginator for legacy path
- add pure measured-height paginator that accepts `measuredHeightPx` and page capacities in px

### Create: `src/lib/exam-paper-two-column-measurement.ts`

Responsibility:
- create hidden iframe
- write measurement HTML
- wait for fonts/layout
- read actual chunk heights and usable heights
- call measured paginator

### Modify: `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`

Responsibility after change:
- run 2-pass measurement for `columnLayout === 'double'`
- block save/open/print while preview is stale or generating
- save/open/print finalized `previewHtml`

### Create/Modify tests

- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`
- Modify: `tests/exam-paper-browser-pdf-viewer.test.mjs`
- Modify: `tests/exam-paper-direct-pdf-export.test.mjs`
- Create: `tests/exam-paper-print-pdf-route.test.mjs`
- Create: `tests/exam-paper-html-pdf-client.test.mjs`

---

## 3. Implementation tasks

### Task 1: 실패 기준과 measured path 검증 전략 분리

**Files:**
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: 현재 회귀를 재현한다**

Run:

```bash
node --test tests/exam-paper-two-column-reproduction.test.mjs
```

Expected before implementation:

```txt
FAIL exam-with-answers double preview should keep the real fixture pair closer to the bottom margin on page 1
bottomRemainingPx: 187.04
```

- [ ] **Step 2: DOM analysis helper에 usable slack을 추가한다**

In `analyzeDoublePreviewPages()`, add per-page calculation:

```js
const pageStyle = getComputedStyle(pageEl)
const paddingBottom = Number.parseFloat(pageStyle.paddingBottom || '0') || 0
const usableBottomRemainingPx = sectionNodes.length
  ? Number((pageRect.bottom - paddingBottom - Math.max(...sectionNodes.map((section) => section.rectBottom))).toFixed(2))
  : Number((pageRect.height - paddingBottom).toFixed(2))
```

Use section nodes with both relative and absolute bottom:

```js
const sectionNodes = [...pageEl.querySelectorAll('[data-section-id]')].map((el) => {
  const rect = el.getBoundingClientRect()
  return {
    id: el.getAttribute('data-section-id'),
    pageBottom: Number((rect.bottom - pageRect.top).toFixed(2)),
    rectBottom: rect.bottom,
  }
})
```

Return:

```js
return {
  page: pageIndex + 1,
  sectionCount: sectionNodes.length,
  bottomRemainingPx: Number((pageRect.height - maxPageBottom).toFixed(2)),
  usableBottomRemainingPx,
  columns,
}
```

- [ ] **Step 3: Keep legacy failure but do not call it measured**

Rename current underfill tests to make legacy path explicit:

```js
test('legacy estimated exam-with-answers double preview leaves a real fixture first-page gap', async () => {
  const html = await buildPreviewHtml(createRealisticExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assert.equal(
    firstPage.usableBottomRemainingPx > 120,
    true,
    `expected legacy estimated preview to expose usable bottom slack, got ${JSON.stringify(firstPage, null, 2)}`
  )
})
```

Expected before implementation: PASS, documenting the old problem.

### Task 2: Linear fragment source 추가

**Files:**
- Modify: `src/lib/exam-paper-layout-contract.ts`
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: Export linear fragment builder**

Add below `buildQuestionSectionPlan()`:

```ts
export function buildTwoColumnLinearFragmentPlans(
  questionPlans: TwoColumnQuestionSectionPlan[]
): TwoColumnFragmentPlan[] {
  return questionPlans.flatMap((questionPlan) => (
    questionPlan.sections.flatMap(buildSectionFragments)
  ))
}
```

- [ ] **Step 2: Add Node contract test that linear fragments bypass page plan**

In `tests/exam-paper-two-column-reproduction.test.mjs`, after runtime module loader helpers:

```js
test('two-column linear fragments are produced before legacy page pagination', async () => {
  const { module } = await loadRuntimeLayoutContractModule()
  const renderOptions = module.buildExamPaperRenderOptions({
    ...createRealisticExamWithAnswersExamPaper(),
    columnLayout: 'double',
  })
  const questionPlans = createRealisticExamWithAnswersExamPaper().questions.map((question) => (
    module.buildQuestionSectionPlan(question, renderOptions)
  ))
  const fragments = module.buildTwoColumnLinearFragmentPlans(questionPlans)

  assert.equal(fragments.length > 0, true)
  assert.equal(
    fragments.every((fragment, index) => index === 0 || fragment.questionNumber >= fragments[index - 1].questionNumber),
    true,
    `expected linear fragments to preserve question order, got ${fragments.map((fragment) => fragment.id).join(', ')}`
  )
})
```

Expected after Step 1: PASS.

### Task 3: export-utils를 linear chunks + measured page renderer로 분리

**Files:**
- Modify: `src/lib/export-utils.ts`
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: Import new linear builder**

Change import:

```ts
import {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnLayoutPlan,
  buildTwoColumnLinearFragmentPlans,
} from '@/lib/exam-paper-layout-contract'
```

- [ ] **Step 2: Export HTML chunk/page types**

Change `interface HtmlPaginationChunk` to:

```ts
export interface HtmlPaginationChunk {
  id: string
  estimatedHeight: number
  kind: 'header' | 'body' | 'choice' | 'answer' | 'explanation'
  html: string
}
```

Add:

```ts
export interface TwoColumnMeasuredPagePlan {
  pageIndex: number
  columns: [HtmlPaginationChunk[], HtmlPaginationChunk[]]
}
```

- [ ] **Step 3: Extend print preview options**

Change:

```ts
interface ExamPaperPrintPreviewOptions {
  autoPrint?: boolean
  closeAfterPrint?: boolean
  singleColumnMeasuredPages?: SingleColumnPagePlan[] | null
}
```

to:

```ts
interface ExamPaperPrintPreviewOptions {
  autoPrint?: boolean
  closeAfterPrint?: boolean
  singleColumnMeasuredPages?: SingleColumnPagePlan[] | null
  twoColumnMeasuredPages?: TwoColumnMeasuredPagePlan[] | null
}
```

- [ ] **Step 4: Add linear chunk builder that does not call `buildTwoColumnLayoutPlan()`**

Add near `buildTwoColumnPreviewPages()`:

```ts
export function buildTwoColumnPreviewChunks(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions
): HtmlPaginationChunk[] {
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

- [ ] **Step 5: Keep legacy page builder but make its source explicit**

Leave `buildTwoColumnPreviewPages()` as fallback and add comment:

```ts
// Legacy fallback: estimated pagination remains for non-measured callers only.
// Browser preview should pass twoColumnMeasuredPages to buildExamPaperPrintHtml().
```

- [ ] **Step 6: Add measured pages renderer**

Add:

```ts
function renderTwoColumnMeasuredPagesHtml(
  examPaper: ExamPaper,
  pages: TwoColumnMeasuredPagePlan[],
  {
    titleSuffix,
    layoutSuffix,
  }: {
    titleSuffix: string
    layoutSuffix: string
  }
) {
  return pages.map((page, pageIndex) => `
    <section class="preview-page">
      ${pageIndex === 0 ? `
        <h1>${escapeHtml(examPaper.title + titleSuffix + layoutSuffix)}</h1>
        ${examPaper.description ? `<div class="description">${escapeHtml(examPaper.description)}</div>` : ''}
      ` : ''}
      <div class="two-column-layout">
        <div class="two-column-column">
          ${page.columns[0].map((chunk) => chunk.html).join('')}
        </div>
        <div class="two-column-column">
          ${page.columns[1].map((chunk) => chunk.html).join('')}
        </div>
      </div>
    </section>
  `).join('')
}
```

- [ ] **Step 7: Add measurement HTML builder**

Add:

```ts
export function buildExamPaperTwoColumnMeasurementHtml(examPaper: ExamPaper) {
  const renderOptions = buildExamPaperRenderOptions({
    ...examPaper,
    columnLayout: 'double',
  })
  const chunks = buildTwoColumnPreviewChunks(examPaper, renderOptions)

  return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(examPaper.title)} - measurement</title>
      <style>${buildExamPaperPrintStyles(renderOptions)}</style>
    </head>
    <body>
      <div class="preview-shell measurement-shell">
        <section class="preview-page measurement-first-page">
          <h1>${escapeHtml(examPaper.title + renderOptions.titleSuffix + renderOptions.layoutSuffix)}</h1>
          ${examPaper.description ? `<div class="description">${escapeHtml(examPaper.description)}</div>` : ''}
          <div class="two-column-layout measurement-layout">
            <div class="two-column-column measurement-column" data-measurement-column="first">
              ${chunks.map((chunk) => chunk.html).join('')}
            </div>
            <div class="two-column-column measurement-column"></div>
          </div>
        </section>
        <section class="preview-page measurement-other-page">
          <div class="two-column-layout measurement-layout">
            <div class="two-column-column measurement-column" data-measurement-column="other"></div>
            <div class="two-column-column measurement-column"></div>
          </div>
        </section>
      </div>
    </body>
    </html>
  `
}
```

- [ ] **Step 8: Use measured pages first in `buildExamPaperPrintHtml()`**

Destructure:

```ts
const {
  autoPrint = false,
  closeAfterPrint = false,
  singleColumnMeasuredPages = null,
  twoColumnMeasuredPages = null,
} = options
```

Change double rendering branch to:

```ts
${isDoubleColumn
  ? twoColumnMeasuredPages
    ? renderTwoColumnMeasuredPagesHtml(examPaper, twoColumnMeasuredPages, { titleSuffix, layoutSuffix })
    : renderTwoColumnChunkPaginatedHtml(examPaper, twoColumnChunkPages ?? [], { titleSuffix, layoutSuffix })
  : /* existing single-column rendering */ ''}
```

Keep the existing single-column template exactly where the comment indicates; do not remove single-column measurement behavior.

- [ ] **Step 9: Add renderer contract test**

In `tests/exam-paper-two-column-reproduction.test.mjs`:

```js
test('buildExamPaperPrintHtml renders injected measured two-column pages in order', async () => {
  const html = await buildPreviewHtml(createRealisticExamWithAnswersExamPaper(), {
    twoColumnMeasuredPages: [
      {
        pageIndex: 0,
        columns: [
          [{ id: 'left-a', estimatedHeight: 1, kind: 'body', html: '<div data-section-id="left-a">left</div>' }],
          [{ id: 'right-b', estimatedHeight: 1, kind: 'body', html: '<div data-section-id="right-b">right</div>' }],
        ],
      },
    ],
  })

  assert.equal(html.includes('data-section-id="left-a"'), true)
  assert.equal(html.includes('data-section-id="right-b"'), true)
  assert.equal(html.indexOf('left-a') < html.indexOf('right-b'), true)
})
```

Update `buildPreviewHtml(examPaper, options = {})` helper to pass options into `buildExamPaperPrintHtml(examPaper, options)`.

Expected: PASS after renderer changes.

### Task 4: measured px paginator 추가

**Files:**
- Modify: `src/lib/exam-paper-pdf-pagination.js`
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: Add `paginateMeasuredTwoColumnChunks()`**

Add after existing paginator:

```js
export function paginateMeasuredTwoColumnChunks(chunks, options) {
  const {
    firstPageColumnHeightPx,
    otherPageColumnHeightPx,
    bottomGuardPx = 8,
  } = options

  const pages = [createPage()]
  const usage = [{ left: 0, right: 0 }]
  let pageIndex = 0
  let columnKey = 'left'

  const ensurePage = (index) => {
    if (!pages[index]) {
      pages[index] = createPage()
      usage[index] = { left: 0, right: 0 }
    }
  }

  const getCapacity = (index) => Math.max(
    0,
    (index === 0 ? firstPageColumnHeightPx : otherPageColumnHeightPx) - bottomGuardPx
  )

  const moveToNextSlot = () => {
    if (columnKey === 'left') {
      columnKey = 'right'
      return
    }

    pageIndex += 1
    ensurePage(pageIndex)
    columnKey = 'left'
  }

  chunks.forEach((chunk) => {
    ensurePage(pageIndex)
    const height = Math.ceil(chunk.measuredHeightPx || chunk.estimatedHeight || 0)
    const remaining = getCapacity(pageIndex) - usage[pageIndex][columnKey]

    if (usage[pageIndex][columnKey] > 0 && height > remaining) {
      moveToNextSlot()
      ensurePage(pageIndex)
    }

    pages[pageIndex][columnKey].push(chunk)
    usage[pageIndex][columnKey] += height
  })

  return pages
    .filter((page) => page.left.length > 0 || page.right.length > 0)
    .map((page, index) => ({
      pageIndex: index,
      columns: [page.left, page.right],
    }))
}
```

- [ ] **Step 2: Add unit test proving measured height wins over estimated height**

```js
test('measured two-column paginator uses measured px heights instead of estimated slots', async () => {
  const pagination = await import('../src/lib/exam-paper-pdf-pagination.js')
  const pages = pagination.paginateMeasuredTwoColumnChunks([
    { id: 'a', kind: 'body', html: '<div>a</div>', estimatedHeight: 999, measuredHeightPx: 100 },
    { id: 'b', kind: 'body', html: '<div>b</div>', estimatedHeight: 999, measuredHeightPx: 100 },
    { id: 'c', kind: 'body', html: '<div>c</div>', estimatedHeight: 999, measuredHeightPx: 100 },
  ], {
    firstPageColumnHeightPx: 220,
    otherPageColumnHeightPx: 220,
    bottomGuardPx: 0,
  })

  assert.deepEqual(
    pages.map((page) => page.columns.map((column) => column.map((chunk) => chunk.id))),
    [[['a', 'b'], ['c']]]
  )
})
```

Expected: PASS.

### Task 5: DOM measurement module 구현

**Files:**
- Create: `src/lib/exam-paper-two-column-measurement.ts`
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: Create module**

```ts
import type { ExamPaper, HtmlPaginationChunk, TwoColumnMeasuredPagePlan } from '@/lib/export-utils'
import { buildExamPaperTwoColumnMeasurementHtml } from '@/lib/export-utils'
import { paginateMeasuredTwoColumnChunks } from '@/lib/exam-paper-pdf-pagination.js'

interface MeasuredTwoColumnChunk extends HtmlPaginationChunk {
  measuredHeightPx: number
}

interface MeasurementResult {
  chunks: MeasuredTwoColumnChunk[]
  firstPageColumnHeightPx: number
  otherPageColumnHeightPx: number
}

export async function buildMeasuredTwoColumnPreviewPages({
  examPaper,
  signal,
}: {
  examPaper: ExamPaper
  signal?: AbortSignal
}): Promise<TwoColumnMeasuredPagePlan[]> {
  if (typeof document === 'undefined') {
    throw new Error('2단 DOM 측정 pagination은 브라우저 환경에서만 실행할 수 있습니다.')
  }

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '220mm'
  iframe.style.height = '310mm'
  iframe.style.visibility = 'hidden'
  iframe.style.pointerEvents = 'none'

  document.body.appendChild(iframe)

  try {
    await writeMeasurementDocument(iframe, buildExamPaperTwoColumnMeasurementHtml(examPaper), signal)
    const measured = await readMeasurementResult(iframe, signal)

    return paginateMeasuredTwoColumnChunks(measured.chunks, {
      firstPageColumnHeightPx: measured.firstPageColumnHeightPx,
      otherPageColumnHeightPx: measured.otherPageColumnHeightPx,
      bottomGuardPx: 8,
    }) as TwoColumnMeasuredPagePlan[]
  } finally {
    iframe.remove()
  }
}

async function writeMeasurementDocument(
  iframe: HTMLIFrameElement,
  html: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    throw new DOMException('Measurement aborted', 'AbortError')
  }

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve()
    iframe.onerror = () => reject(new Error('2단 측정 iframe 로드에 실패했습니다.'))
    iframe.srcdoc = html
  })

  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('2단 측정 문서에 접근할 수 없습니다.')
  }

  await doc.fonts?.ready
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

async function readMeasurementResult(
  iframe: HTMLIFrameElement,
  signal?: AbortSignal
): Promise<MeasurementResult> {
  if (signal?.aborted) {
    throw new DOMException('Measurement aborted', 'AbortError')
  }

  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('2단 측정 문서에 접근할 수 없습니다.')
  }

  const firstPage = doc.querySelector<HTMLElement>('.measurement-first-page')
  const otherPage = doc.querySelector<HTMLElement>('.measurement-other-page')
  const firstColumn = doc.querySelector<HTMLElement>('[data-measurement-column="first"]')
  const otherColumn = doc.querySelector<HTMLElement>('[data-measurement-column="other"]')

  if (!firstPage || !otherPage || !firstColumn || !otherColumn) {
    throw new Error('2단 측정 DOM 구조가 올바르지 않습니다.')
  }

  return {
    chunks: [...firstColumn.querySelectorAll<HTMLElement>('[data-section-id]')]
      .map((element) => ({
        id: element.dataset.sectionId ?? '',
        estimatedHeight: Number(element.dataset.estimatedHeight ?? '0'),
        kind: normalizeChunkKind(element.dataset.sectionKind),
        html: element.outerHTML,
        measuredHeightPx: measureOuterHeight(element),
      }))
      .filter((chunk) => chunk.id && chunk.measuredHeightPx > 0),
    firstPageColumnHeightPx: measureUsableColumnHeight(firstPage, firstColumn),
    otherPageColumnHeightPx: measureUsableColumnHeight(otherPage, otherColumn),
  }
}

function measureUsableColumnHeight(page: HTMLElement, column: HTMLElement) {
  const pageRect = page.getBoundingClientRect()
  const columnRect = column.getBoundingClientRect()
  const pageStyle = page.ownerDocument.defaultView?.getComputedStyle(page)
  const paddingBottom = Number.parseFloat(pageStyle?.paddingBottom ?? '0') || 0

  return Math.max(0, pageRect.bottom - paddingBottom - columnRect.top)
}

function measureOuterHeight(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const marginTop = Number.parseFloat(style?.marginTop ?? '0') || 0
  const marginBottom = Number.parseFloat(style?.marginBottom ?? '0') || 0

  return rect.height + marginTop + marginBottom
}

function normalizeChunkKind(kind: string | undefined): HtmlPaginationChunk['kind'] {
  if (kind === 'header' || kind === 'body' || kind === 'choice' || kind === 'answer' || kind === 'explanation') {
    return kind
  }

  return 'body'
}
```

- [ ] **Step 2: Add browser integration test that actually runs measurement**

In `tests/exam-paper-two-column-reproduction.test.mjs`, add a runtime loader for the measurement module and a Playwright test:

```js
test('DOM-measured two-column preview reduces usable first-page slack for the real fixture pair', async () => {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    const examPaper = createRealisticExamWithAnswersExamPaper()
    const html = await buildMeasuredPreviewHtmlInBrowser(page, examPaper)
    const pages = await analyzeDoublePreviewPages(html)
    const firstPage = pages[0]

    assert.ok(firstPage, 'expected first measured preview page')
    assert.equal(
      firstPage.usableBottomRemainingPx < 96,
      true,
      `expected measured usable bottom slack under 96px, got ${JSON.stringify(firstPage, null, 2)}`
    )
    assert.equal(
      firstPage.columns.every((column) => column.maxOverflowPx === 0),
      true,
      `expected no measured first-page overflow, got ${JSON.stringify(firstPage, null, 2)}`
    )
  } finally {
    await browser.close()
  }
})
```

Implement `buildMeasuredPreviewHtmlInBrowser(page, examPaper)` in the test by exposing/importing the runtime modules inside Playwright. The function must call `buildMeasuredTwoColumnPreviewPages({ examPaper })`, then `buildExamPaperPrintHtml(examPaper, { twoColumnMeasuredPages })`; it must not call plain `buildExamPaperPrintHtml(examPaper)`.

Expected before workspace wiring but after module implementation: PASS for module-level browser integration.

### Task 6: Workspace 2-pass 측정 경로 연결

**Files:**
- Modify: `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
- Modify: `tests/exam-paper-browser-pdf-viewer.test.mjs`

- [ ] **Step 1: Import measurement helper**

```ts
import { buildMeasuredTwoColumnPreviewPages } from '@/lib/exam-paper-two-column-measurement'
```

- [ ] **Step 2: Mark preview stale immediately before debounce completes**

At the start of the preview effect:

```tsx
let cancelled = false
const abortController = new AbortController()
setIsGeneratingPreview(true)
```

Cleanup:

```tsx
return () => {
  cancelled = true
  abortController.abort()
  window.clearTimeout(timeoutId)
}
```

- [ ] **Step 3: Build measured two-column pages**

In the effect body, before building final HTML:

```tsx
const twoColumnMeasuredPages = columnLayout === 'double'
  ? await buildMeasuredTwoColumnPreviewPages({
    examPaper: exportPayload,
    signal: abortController.signal,
  })
  : null

const html = buildExamPaperPrintHtml(exportPayload, {
  singleColumnMeasuredPages: measuredPages,
  twoColumnMeasuredPages,
})
```

- [ ] **Step 4: Add browser-viewer source assertion**

In `tests/exam-paper-browser-pdf-viewer.test.mjs`, assert source includes:

```js
assert.match(source, /buildMeasuredTwoColumnPreviewPages/)
assert.match(source, /twoColumnMeasuredPages/)
assert.match(source, /setIsGeneratingPreview\(true\)/)
```

Expected: PASS.

### Task 7: Save/open/print finalized previewHtml로 통일

**Files:**
- Modify: `src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx`
- Create: `src/lib/exam-paper-html-pdf.ts`
- Modify: `src/app/api/exam-papers/print-pdf/route.ts`
- Modify: `tests/exam-paper-direct-pdf-export.test.mjs`
- Create: `tests/exam-paper-print-pdf-route.test.mjs`
- Create: `tests/exam-paper-html-pdf-client.test.mjs`

- [ ] **Step 1: Add ready guard**

```tsx
const assertReadyPreviewHtml = () => {
  if (isGeneratingPreview || !previewHtml) {
    throw new Error('PDF 미리보기가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.')
  }

  return previewHtml
}
```

- [ ] **Step 2: Save/open call HTML PDF helper with previewHtml**

Save:

```tsx
const html = assertReadyPreviewHtml()
await downloadExamPaperHtmlPdf({ html, fileName: `${previewTitle}.pdf` })
```

Open:

```tsx
const html = assertReadyPreviewHtml()
await openExamPaperHtmlPdfInNewTab({ html, fileName: `${previewTitle}.pdf` })
```

- [ ] **Step 3: Create client helper**

`src/lib/exam-paper-html-pdf.ts`:

```ts
import { saveAs } from 'file-saver'

export async function requestExamPaperHtmlPdf({
  html,
  fileName,
  disposition = 'attachment',
}: {
  html: string
  fileName: string
  disposition?: 'attachment' | 'inline'
}) {
  const response = await fetch('/api/exam-papers/print-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html, fileName, disposition }),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.message || payload?.error || 'PDF 생성 요청에 실패했습니다.')
  }

  return response.blob()
}

export async function downloadExamPaperHtmlPdf({ html, fileName }: { html: string; fileName: string }) {
  const blob = await requestExamPaperHtmlPdf({ html, fileName, disposition: 'attachment' })
  saveAs(blob, fileName)
}

export async function openExamPaperHtmlPdfInNewTab({ html, fileName }: { html: string; fileName: string }) {
  const blob = await requestExamPaperHtmlPdf({ html, fileName, disposition: 'inline' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
```

- [ ] **Step 4: Strengthen route contract test**

Create `tests/exam-paper-print-pdf-route.test.mjs` asserting route source contains:

```js
assert.match(source, /html:\s*z\.string\(\)\.min\(1\)/)
assert.match(source, /fileName:\s*z\.string\(\)\.optional\(\)/)
assert.match(source, /disposition:\s*z\.enum\(\['attachment', 'inline'\]\)\.optional\(\)/)
assert.match(source, /preferCSSPageSize:\s*true/)
assert.match(source, /page\.route\('.*\*\*\/\*'/)
```

- [ ] **Step 5: Update direct export test contract**

In `tests/exam-paper-direct-pdf-export.test.mjs`, replace old “must not fetch `/api/exam-papers/print-pdf`” expectation with:

```js
assert.match(source, /downloadExamPaperHtmlPdf/)
assert.match(source, /openExamPaperHtmlPdfInNewTab/)
assert.match(source, /assertReadyPreviewHtml/)
assert.doesNotMatch(source, /buildExamPaperPdfBlob\(exportPayload\)/)
```

Expected: PASS after workspace/helper changes.

### Task 8: Fragment granularity tuning for measured fill

**Files:**
- Modify: `src/lib/exam-paper-layout-contract.ts`
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: Reduce body/answer fragment sizes**

Change constants:

```ts
const ANSWER_ONLY_DOUBLE_EXPLANATION_FRAGMENT_MAX_CHARS = 220
const EXAM_WITH_ANSWERS_DOUBLE_EXPLANATION_FRAGMENT_MAX_CHARS = 220
const DOUBLE_COLUMN_BODY_FRAGMENT_MIN_LENGTH = 240
const DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS = 240
```

- [ ] **Step 2: Preserve atomic header and choice-row splitting**

Do not split headers. Keep `createChoiceFragments()` one choice row per fragment.

- [ ] **Step 3: Verify no overflow and usable slack target**

Run:

```bash
node --test tests/exam-paper-two-column-reproduction.test.mjs
```

Expected: measured browser integration passes with `usableBottomRemainingPx < 96` and no overflow. If not, return to Task 5 and split body/answer chunks more finely before touching capacity numbers.

### Task 9: Final verification gates

**Files:**
- Modify: `scripts/playwright_verify_pdf_workspace_route_profile.cjs`
- Modify: `scripts/playwright_verify_saved_pdf_profile.cjs`
- Create: `tests/pdf-save-verification-script.test.mjs`

- [ ] **Step 1: Scripts accept route/mode/layout args**

Required command shape:

```bash
node scripts/playwright_verify_pdf_workspace_route_profile.cjs http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02 exam-with-answers double
node scripts/playwright_verify_saved_pdf_profile.cjs http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02 exam-with-answers double
```

- [ ] **Step 2: Run automated checks**

```bash
node --test tests/exam-paper-two-column-reproduction.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs tests/exam-paper-direct-pdf-export.test.mjs tests/exam-paper-print-pdf-route.test.mjs tests/exam-paper-html-pdf-client.test.mjs tests/pdf-save-verification-script.test.mjs
npx tsc --noEmit --pretty false
npx eslint src/lib/export-utils.ts src/lib/exam-paper-layout-contract.ts src/lib/exam-paper-pdf-pagination.js src/lib/exam-paper-two-column-measurement.ts src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx src/app/api/exam-papers/print-pdf/route.ts tests/exam-paper-two-column-reproduction.test.mjs tests/exam-paper-browser-pdf-viewer.test.mjs tests/exam-paper-direct-pdf-export.test.mjs tests/exam-paper-print-pdf-route.test.mjs tests/exam-paper-html-pdf-client.test.mjs tests/pdf-save-verification-script.test.mjs
```

Expected:

```txt
node --test: all listed tests pass
tsc: no errors
eslint: no errors
```

- [ ] **Step 3: Manual visual acceptance**

Run:

```bash
npm run dev
```

Open:

```txt
/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02
viewMode: 시험지+답안
layout: 2단
```

Acceptance:
- 첫 페이지 하단 usable content slack이 기존보다 명확히 줄어든다.
- 문제/선택지/정답/해설 순서가 유지된다.
- 내용 overflow가 없다.
- PDF 저장 결과의 page break가 오른쪽 preview와 일치한다.

---

## 4. Plan validation checklist

- [x] `buildTwoColumnLayoutPlan().pages` flatten을 금지하고 linear fragment source를 추가했다.
- [x] measured path 테스트가 실제 측정 모듈을 실행하도록 분리했다.
- [x] page-level slack과 usable bottom slack을 구분했다.
- [x] 현재 존재하지 않는 route/helper tests는 Create로 표시했다.
- [x] 기존 direct PDF test의 old contract 변경을 task로 명시했다.
- [x] 저장/새 탭/인쇄가 finalized previewHtml을 공유하도록 포함했다.
- [x] 검증 실패 시 capacity 튜닝이 아니라 chunk granularity/measurement로 되돌아가도록 루프를 정의했다.

## 5. Remaining risks

1. **Measurement iframe CSS drift**
   - 대응: measurement/final HTML 모두 `buildExamPaperPrintStyles()`를 공유한다.

2. **Font timing**
   - 대응: `doc.fonts.ready`와 `requestAnimationFrame` 이후 측정한다.

3. **Very large atomic header**
   - 대응: header는 atomic으로 유지하되 overflow test로 감시한다. header가 실제로 overflow하면 별도 product/design decision으로 문제 제목 줄바꿈/축약을 다룬다.

4. **Performance**
   - 대응: 200ms debounce, `AbortController`, stale preview action disable을 적용한다.

5. **Visual page-level slack target ambiguity**
   - 대응: automated gate는 usable slack과 overflow를 기준으로 삼고, 최종 수동 visual check로 실제 하단 여백 체감을 확인한다.
