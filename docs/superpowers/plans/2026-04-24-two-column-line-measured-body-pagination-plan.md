# 2단 지문 DOM 라인 측정 Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2단 PDF 미리보기/저장에서 영어 지문이 1단처럼 연속 문단으로 보이도록 하되, pagination은 실제 브라우저 렌더링 높이 기준으로 column/page 경계에서만 안전하게 분할한다.

**Architecture:** 현재 문제의 원인은 Supabase 원본 줄바꿈이 아니라 2단 전용 `splitTextIntoFlowChunks(..., 240)`가 지문을 문장 단위 block chunk로 미리 나누는 구조다. 해결은 2단 body에 한해 measurement iframe에서 실제 line height/DOM height를 측정해 line 단위 chunk로 pagination하고, 최종 렌더에서는 같은 column 안의 연속 body line chunk를 하나의 `.flow-body-text` group으로 병합해 block 경계가 문단처럼 보이지 않게 한다. 기존 header/choice/answer chunk pagination은 유지하고, body만 line-aware measured chunk로 대체한다.

**Tech Stack:** Next.js App Router, TypeScript, Playwright 기반 Node tests, Supabase 원본 데이터, custom HTML PDF renderer, browser `Range`/hidden measurement DOM, existing `paginateMeasuredTwoColumnChunks`.

---

## 문제분석 → 계획수립 → 검증 Loop

### Loop 1 — 문제분석

**직접 확인된 사실**
- Supabase 대상 시험지 `9a554084-ec01-4780-933e-39f4bc9dfa02`의 `questions.passage_text`에는 줄바꿈이 없다. `passage_rows_with_newlines = 0`, `max_passage_newlines = 0`.
- 1단은 `src/lib/exam-paper-single-column-layout.ts`에서 `passageText`를 하나의 body block으로 만들고, `src/lib/export-utils.ts`의 `renderSingleColumnBlockHtml()`에서 하나의 `.single-column-body .flow-body-text`로 렌더링한다.
- 2단은 `src/lib/exam-paper-layout-contract.ts`의 `createBodyFragments()`에서 `DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS = 240` 기준으로 긴 body를 여러 `question-N-body-part-M` fragment로 쪼갠다.
- 2단 최종 HTML은 각 fragment를 별도 `.question-body-chunk` block으로 렌더링하기 때문에, margin을 줄여도 block 경계에서 새 줄이 생기고 문단 구분처럼 보인다.

**원인 결론**
- DB 원본값 문제가 아니라, 2단 body pre-fragmentation + block 렌더링 구조 문제다.

### Loop 1 — 해결책 개선방안 계획수립

**선택한 방향**
- 2단 body를 arbitrary 240자/문장 chunk로 미리 나누지 않는다.
- measurement iframe에서 실제 렌더링 폭과 line-height를 기준으로 body 텍스트를 line 단위 chunk로 변환한다.
- pagination은 line chunk의 실제 높이로 수행한다.
- 최종 HTML 렌더링 시 같은 column 안에서 연속된 body line chunk는 하나의 paragraph group으로 병합한다.

**기각한 방향**
- `display: inline` 또는 `display: contents`만 적용: 현재 `.two-column-column`은 flex column이고 측정 element box가 사라지면 pagination 측정이 깨질 수 있다.
- `MAX_CHARS`를 500/800으로 키우기: 긴 지문에서 여전히 block split이 생기며 근본 해결이 아니다.
- 브라우저 native CSS multi-column에 전부 위임: 현재 PDF 저장/측정/문제 순서 제어 구조와 충돌 범위가 크다.

### Loop 1 — 계획 검증

**통과 기준**
- 계획이 Supabase 원본값을 변경하지 않는다.
- 1단 렌더링 경로를 변경하지 않는다.
- 2단 body만 line-aware measurement로 변경한다.
- 기존 measured pagination 함수가 사용할 수 있는 `measuredHeightPx` 기반 chunk contract를 유지한다.
- 최종 HTML에서 같은 column 내 body fragment가 여러 block 문단처럼 보이지 않는다.
- 테스트가 문자열 정규식뿐 아니라 Playwright DOM 렌더 결과를 검증한다.

**검증 결과**
- 위 조건을 모두 만족하므로 Loop 1 통과. 구현 단계로 진행 가능.

---

## File Structure

### Modify: `src/lib/export-utils.ts`

책임:
- `HtmlPaginationChunk`에 measured body line metadata를 추가한다.
- 2단 body measurement용 HTML에 raw body text를 안전하게 전달한다.
- measured pages 렌더링 시 같은 column 안의 연속 body line chunks를 하나의 flow group으로 병합한다.
- 기존 fallback/non-measured two-column 렌더링은 유지한다.

### Modify: `src/lib/exam-paper-two-column-measurement.ts`

책임:
- measurement iframe에서 body chunk의 실제 rendered line boundaries를 계산한다.
- body chunk를 line-level measured chunks로 변환한다.
- header/choice/answer는 기존 chunk 측정 방식을 유지한다.

### Modify: `src/lib/exam-paper-layout-contract.ts`

책임:
- measured path에서 body를 240자 단위로 pre-fragment하지 않을 수 있는 option을 제공한다.
- 기존 fallback path와 answer continuation path는 유지한다.

### Modify: `src/lib/exam-paper-pdf-pagination.js`

책임:
- `paginateMeasuredTwoColumnChunks()`가 line chunks를 기존 chunk와 동일하게 처리할 수 있게 현재 contract를 유지한다.
- 필요 시 debug payload에 body line metadata를 포함한다.

### Create: `tests/exam-paper-two-column-line-measurement.test.mjs`

책임:
- 실제 브라우저 DOM 측정 기반으로 2단 body가 line chunk로 pagination되고, 최종 HTML에서는 같은 column 안에서 flow group으로 병합되는지 검증한다.

### Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

책임:
- 기존 screenshot-like fixture에서 2단 first page가 overflow 없이 dense하고, body chunk가 문단형 block으로 반복되지 않는지 추가 검증한다.

### Modify: `tests/exam-paper-two-column-spacing.test.mjs`

책임:
- 2단 spacing CSS 회귀 테스트를 line-aware body flow class 기준으로 갱신한다.

---

## Task 1: Measurement용 body pre-fragment 우회 contract 추가

**Files:**
- Modify: `src/lib/exam-paper-layout-contract.ts:150-170`
- Modify: `src/lib/exam-paper-layout-contract.ts:506-554`
- Modify: `src/lib/exam-paper-layout-contract.ts:640-645`
- Modify: `src/lib/export-utils.ts:472-488`
- Test: `tests/exam-paper-two-column-line-measurement.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `tests/exam-paper-two-column-line-measurement.test.mjs` with this initial test. It should fail before implementation because measurement HTML currently contains pre-fragmented `question-1-body-part-*` chunks.

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const exportUtilsSource = readFileSync(
  new URL('../src/lib/export-utils.ts', import.meta.url),
  'utf8'
)
const layoutContractSource = readFileSync(
  new URL('../src/lib/exam-paper-layout-contract.ts', import.meta.url),
  'utf8'
)
const singleColumnLayoutSource = readFileSync(
  new URL('../src/lib/exam-paper-single-column-layout.ts', import.meta.url),
  'utf8'
)
const paginationModuleUrl = new URL(
  '../src/lib/exam-paper-pdf-pagination.js',
  import.meta.url
).href
const printPaginationModuleUrl = new URL(
  '../src/lib/exam-paper-print-pagination.js',
  import.meta.url
).href
const normalizeQuestionFieldModuleUrl = new URL(
  '../src/lib/questions/normalize-question-field.ts',
  import.meta.url
).href

async function loadRuntimeLayoutContractModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-line-layout-contract-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = layoutContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-line-single-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtils() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-line-export-utils-'))
  const tempModulePath = join(tempDir, 'export-utils.runtime.ts')
  const layoutContractModuleUrl = await loadRuntimeLayoutContractModule()
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
  const runtimeSource = exportUtilsSource
    .replace("import pdfMake from 'pdfmake/build/pdfmake'\n", 'const pdfMake = {}\n')
    .replace("import * as pdfFonts from 'pdfmake/build/vfs_fonts'\n", 'const pdfFonts = {}\n')
    .replace(
      "import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, UnderlineType } from 'docx'\n",
      [
        'class Document { constructor(args) { this.args = args } }',
        'const Packer = { toBlob: async () => new Blob() }',
        'class Paragraph { constructor(args) { this.args = args } }',
        'class TextRun { constructor(args) { this.args = args } }',
        "const AlignmentType = { CENTER: 'center' }",
        "const HeadingLevel = { HEADING_1: 'heading-1' }",
        "const UnderlineType = { SINGLE: 'single' }",
        '',
      ].join('\n')
    )
    .replace("import { saveAs } from 'file-saver'\n", 'const saveAs = () => {}\n')
    .replace(/from '@\/lib\/exam-paper-print-pagination\.js'/g, `from '${printPaginationModuleUrl}'`)
    .replace(/from '@\/lib\/exam-paper-layout-contract'/g, `from '${layoutContractModuleUrl}'`)
    .replace(/from '@\/lib\/exam-paper-single-column-layout'/g, `from '${singleColumnLayoutModuleUrl}'`)
    .replace(/from '@\/lib\/questions\/normalize-question-field'/g, `from '${normalizeQuestionFieldModuleUrl}'`)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

function createLongPassageExamPaper() {
  return {
    title: 'Line measurement regression',
    description: undefined,
    viewMode: 'exam-only',
    columnLayout: 'double',
    questions: [{
      number: 1,
      questionText: '다음 글을 읽고 물음에 답하시오.',
      questionTextForward: null,
      passageText: [
        'From an organizational viewpoint, one of the most fascinating examples of how any organization may contain many different types of culture is to recognize the functional operations of different departments within the organization.',
        'The varying departments and divisions within an organization will inevitably view any given situation from their own biased and prejudiced perspective.',
        'A department and its members will [acquire “tunnel vision”] which disallows them to see things as others see them.',
        'The very structure of organizations can create conflict.',
        'The choice of whether the structure is “mechanistic” or “organic” can have a profound influence on conflict management.',
        'A mechanistic structure has a vertical hierarchy with many rules, many procedures, and many levels of management involved in decision making.',
        'Organic structures are more horizontal in nature, where decision making is less centralized and spread across the plane of the organization.',
      ].join(' '),
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'first option' },
        { label: '②', text: 'second option' },
      ],
      answer: '①',
      explanation: 'explanation',
    }],
  }
}

test('two-column measurement HTML keeps body as one raw measurable section before line splitting', async () => {
  const exportUtils = await loadRuntimeExportUtils()
  const html = exportUtils.buildExamPaperTwoColumnMeasurementHtml(createLongPassageExamPaper())

  assert.match(
    html,
    /data-section-id="question-1-body"/,
    'expected measurement HTML to expose the full body section as a single measurable body node'
  )
  assert.doesNotMatch(
    html,
    /data-section-id="question-1-body-part-2"/,
    'expected measurement HTML not to pre-fragment body into sentence-sized block chunks'
  )
  assert.match(
    html,
    /data-body-raw-text="[^"]*organizational viewpoint/,
    'expected measurement body node to carry raw body text for DOM line splitting'
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected:

```txt
not ok ... expected measurement HTML not to pre-fragment body into sentence-sized block chunks
```

- [ ] **Step 3: Add a body fragmentation option to the layout contract**

Modify `src/lib/exam-paper-layout-contract.ts`.

Add this interface near the existing `ExamPaperRenderOptions` definitions:

```ts
interface TwoColumnFragmentBuildOptions {
  splitBody: boolean
}
```

Change `buildSectionFragments()` from a no-argument body split to an option-aware function:

```ts
function buildSectionFragments(
  section: TwoColumnSectionPlan,
  options: TwoColumnFragmentBuildOptions = { splitBody: true }
): TwoColumnFragmentPlan[] {
  if (section.kind === 'body') {
    return options.splitBody
      ? createBodyFragments(section)
      : [createSingleFragmentFromSection(section)]
  }

  if (section.kind === 'answer' && section.allowContinuation) {
    return createAnswerFragments(section)
  }

  return [createSingleFragmentFromSection(section)]
}
```

Change `buildTwoColumnLinearFragmentPlans()` signature:

```ts
export function buildTwoColumnLinearFragmentPlans(
  questionPlans: TwoColumnQuestionSectionPlan[],
  options: TwoColumnFragmentBuildOptions = { splitBody: true }
): TwoColumnFragmentPlan[] {
  return questionPlans.flatMap((questionPlan) => (
    questionPlan.sections.flatMap((section) => buildSectionFragments(section, options))
  ))
}
```

Change `toFragmentQuestionPlan()` so the existing layout planner keeps old behavior:

```ts
function toFragmentQuestionPlan(
  questionPlan: TwoColumnQuestionSectionPlan
): ExamPaperQuestionPlan<TwoColumnFragmentPlan> {
  return {
    questionNumber: questionPlan.questionNumber,
    sections: questionPlan.sections.flatMap((section) => (
      buildSectionFragments(section, { splitBody: true }).map(toLayoutFragment)
    )),
  }
}
```

- [ ] **Step 4: Add raw body text metadata to measurement body nodes**

Modify `src/lib/export-utils.ts`.

Extend `HtmlPaginationChunk`:

```ts
export interface HtmlPaginationChunk {
  id: string
  estimatedHeight: number
  kind: 'header' | 'body' | 'choice' | 'answer' | 'explanation'
  html: string
  sourceSectionId?: string
  questionNumber?: number
  bodyRawText?: string
  bodyLineIndex?: number
  bodyLineCount?: number
  measuredHeightPx?: number
}
```

In `renderPlannedTwoColumnSectionHtml()`, body branch should return metadata and include raw text on the root element:

```ts
return {
  id: sectionPlan.id,
  estimatedHeight: sectionPlan.estimatedUnits,
  kind: 'body',
  sourceSectionId: sectionPlan.sourceSectionId,
  questionNumber: sectionPlan.questionNumber,
  bodyRawText: bodyText,
  html: `
    <div class="question-chunk question-body-chunk${continuationClassName}" ${sectionAttributes} data-body-raw-text="${escapeHtml(bodyText)}">
      <div class="flow-body-text">
        ${renderInlineBracketUnderlineHtml(bodyText)}
      </div>
    </div>
  `,
}
```

Change `buildExamPaperTwoColumnMeasurementHtml()` to request unsplit body fragments:

```ts
const chunks = buildTwoColumnPreviewChunks(examPaper, renderOptions, {
  splitBody: false,
})
```

Change `buildTwoColumnPreviewChunks()` signature and calls:

```ts
function buildTwoColumnPreviewChunks(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions,
  fragmentOptions: { splitBody: boolean } = { splitBody: true }
): HtmlPaginationChunk[] {
  if (renderOptions.viewMode === 'exam-with-answers') {
    return buildSeparatedExamWithAnswersTwoColumnChunks(examPaper, renderOptions, fragmentOptions)
  }

  const questionPlans = examPaper.questions.map((question) => (
    buildQuestionSectionPlan(question, renderOptions)
  ))
  const fragments = buildTwoColumnLinearFragmentPlans(questionPlans, fragmentOptions)

  return fragments.map((fragment) => renderPlannedTwoColumnSectionHtml(
    fragment,
    renderOptions.showQuestions
  ))
}
```

Change separated helper signature similarly:

```ts
function buildSeparatedExamWithAnswersTwoColumnChunks(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions,
  fragmentOptions: { splitBody: boolean } = { splitBody: true }
): HtmlPaginationChunk[] {
  const { questionPlans, answerPlans } = buildSeparatedExamWithAnswersQuestionPlans(
    examPaper,
    renderOptions
  )

  const questionFragments = buildTwoColumnLinearFragmentPlans(questionPlans, fragmentOptions)
  const answerFragments = buildTwoColumnLinearFragmentPlans(answerPlans, fragmentOptions)

  return [
    ...questionFragments.map((fragment) => renderPlannedTwoColumnSectionHtml(fragment, true)),
    ...answerFragments.map((fragment) => renderPlannedTwoColumnSectionHtml(fragment, false)),
  ]
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected:

```txt
# pass 1
# fail 0
```

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/exam-paper-layout-contract.ts src/lib/export-utils.ts tests/exam-paper-two-column-line-measurement.test.mjs
git commit -m "Prepare two-column body measurement without pre-fragmenting"
```

---

## Task 2: Browser line measurement으로 body chunk를 line chunks로 변환

**Files:**
- Modify: `src/lib/exam-paper-two-column-measurement.ts:81-134`
- Test: `tests/exam-paper-two-column-line-measurement.test.mjs`

- [ ] **Step 1: Add failing Playwright DOM test**

Append this test to `tests/exam-paper-two-column-line-measurement.test.mjs`:

```js
test('measured two-column preview converts a long body into measured line chunks', async () => {
  const exportUtils = await loadRuntimeExportUtils()
  const measurementHtml = exportUtils.buildExamPaperTwoColumnMeasurementHtml(createLongPassageExamPaper())
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent(measurementHtml, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForTimeout(100)

    const result = await page.evaluate(() => {
      const body = document.querySelector('[data-section-id="question-1-body"]')
      if (!body) throw new Error('missing question body')
      const rect = body.getBoundingClientRect()
      const style = getComputedStyle(body.querySelector('.flow-body-text'))
      const lineHeight = Number.parseFloat(style.lineHeight || '0')

      return {
        bodyHeight: rect.height,
        lineHeight,
        visualLineCount: Math.round(rect.height / lineHeight),
      }
    })

    assert.equal(result.visualLineCount > 3, true, `expected multiple rendered lines, got ${JSON.stringify(result)}`)
  } finally {
    await browser.close()
  }
})
```

This test only proves the fixture creates multiple visual lines. The next step adds module-level assertions after implementation.

- [ ] **Step 2: Run test to verify current fixture renders multiple lines**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected:

```txt
# pass 2
# fail 0
```

- [ ] **Step 3: Export underline renderer for measurement probe reuse**

Modify `src/lib/export-utils.ts` by changing:

```ts
function renderInlineBracketUnderlineHtml(text: string | null | undefined): string {
```

to:

```ts
export function renderInlineBracketUnderlineHtml(text: string | null | undefined): string {
```

This keeps measurement and final rendering aligned for bracket underline text.

- [ ] **Step 4: Add line splitting helpers in measurement module**

Modify `src/lib/exam-paper-two-column-measurement.ts`.

Change import:

```ts
import type { ExamPaper, HtmlPaginationChunk, TwoColumnMeasuredPagePlan } from '@/lib/export-utils'
import { buildExamPaperTwoColumnMeasurementHtml, renderInlineBracketUnderlineHtml } from '@/lib/export-utils'
```

Add these helpers below `normalizeChunkKind()`:

```ts
function measureTextHeight(
  probe: HTMLElement,
  text: string
) {
  probe.innerHTML = renderInlineBracketUnderlineHtml(text)
  const rect = probe.getBoundingClientRect()
  return rect.height
}

function findLargestFittingOffset({
  probe,
  text,
  minOffset,
  maxOffset,
  maxHeight,
}: {
  probe: HTMLElement
  text: string
  minOffset: number
  maxOffset: number
  maxHeight: number
}) {
  let low = minOffset
  let high = maxOffset
  let best = minOffset

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = text.slice(0, mid)
    const height = measureTextHeight(probe, candidate)

    if (height <= maxHeight + 1) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return best
}

function snapOffsetToWordBoundary(text: string, offset: number, minOffset: number) {
  if (offset >= text.length) {
    return text.length
  }

  const slice = text.slice(minOffset, offset)
  const lastSpace = slice.search(/\s+\S*$/)

  if (lastSpace <= 0) {
    return offset
  }

  return minOffset + lastSpace
}

function createBodyLineProbe(element: HTMLElement) {
  const doc = element.ownerDocument
  const flowBody = element.querySelector<HTMLElement>('.flow-body-text')
  if (!flowBody) {
    throw new Error('body chunk is missing .flow-body-text')
  }

  const probe = doc.createElement('div')
  const flowStyle = doc.defaultView?.getComputedStyle(flowBody)
  const elementRect = flowBody.getBoundingClientRect()

  probe.className = 'flow-body-text measurement-line-probe'
  probe.style.position = 'absolute'
  probe.style.left = '-10000px'
  probe.style.top = '0'
  probe.style.width = `${elementRect.width}px`
  probe.style.font = flowStyle?.font ?? ''
  probe.style.fontSize = flowStyle?.fontSize ?? ''
  probe.style.fontFamily = flowStyle?.fontFamily ?? ''
  probe.style.fontWeight = flowStyle?.fontWeight ?? ''
  probe.style.letterSpacing = flowStyle?.letterSpacing ?? ''
  probe.style.lineHeight = flowStyle?.lineHeight ?? ''
  probe.style.color = 'transparent'
  probe.style.margin = '0'
  probe.style.padding = '0'
  probe.style.visibility = 'hidden'
  doc.body.appendChild(probe)

  return probe
}

function splitBodyElementIntoMeasuredLineChunks(
  element: HTMLElement,
  baseChunk: MeasuredTwoColumnChunk
): MeasuredTwoColumnChunk[] {
  const rawText = element.dataset.bodyRawText?.trim() ?? ''
  const flowBody = element.querySelector<HTMLElement>('.flow-body-text')

  if (!rawText || !flowBody) {
    return [baseChunk]
  }

  const style = element.ownerDocument.defaultView?.getComputedStyle(flowBody)
  const lineHeight = Number.parseFloat(style?.lineHeight ?? '0') || 23.4
  const totalHeight = flowBody.getBoundingClientRect().height
  const lineCount = Math.max(1, Math.round(totalHeight / lineHeight))
  const probe = createBodyLineProbe(element)
  const chunks: MeasuredTwoColumnChunk[] = []
  let startOffset = 0

  try {
    for (let lineIndex = 0; lineIndex < lineCount && startOffset < rawText.length; lineIndex += 1) {
      const isLastLine = lineIndex === lineCount - 1
      const unsnappedEndOffset = isLastLine
        ? rawText.length
        : findLargestFittingOffset({
          probe,
          text: rawText.slice(startOffset),
          minOffset: 1,
          maxOffset: rawText.length - startOffset,
          maxHeight: lineHeight,
        }) + startOffset
      const endOffset = isLastLine
        ? rawText.length
        : Math.max(startOffset + 1, snapOffsetToWordBoundary(rawText, unsnappedEndOffset, startOffset))
      const lineText = rawText.slice(startOffset, endOffset).trim()

      if (lineText) {
        chunks.push({
          ...baseChunk,
          id: `${baseChunk.id}-line-${chunks.length + 1}`,
          sourceSectionId: baseChunk.sourceSectionId || baseChunk.id,
          bodyRawText: lineText,
          bodyLineIndex: chunks.length,
          bodyLineCount: lineCount,
          measuredHeightPx: lineHeight,
          html: '',
        })
      }

      startOffset = endOffset
      while (rawText[startOffset] === ' ') {
        startOffset += 1
      }
    }
  } finally {
    probe.remove()
  }

  return chunks.length > 0 ? chunks : [baseChunk]
}
```

- [ ] **Step 5: Use body line splitting in measurement result**

Modify `readMeasurementResult()` chunks mapping in `src/lib/exam-paper-two-column-measurement.ts`:

```ts
const measuredChunks = [...firstColumn.querySelectorAll<HTMLElement>('[data-section-id]')]
  .flatMap((element) => {
    const chunk: MeasuredTwoColumnChunk = {
      id: element.dataset.sectionId ?? '',
      estimatedHeight: Number(element.dataset.estimatedHeight ?? '0'),
      kind: normalizeChunkKind(element.dataset.sectionKind),
      html: element.outerHTML,
      sourceSectionId: element.dataset.sourceSectionId ?? element.dataset.sectionId ?? '',
      questionNumber: Number(element.dataset.questionNumber ?? '0') || undefined,
      bodyRawText: element.dataset.bodyRawText ?? undefined,
      measuredHeightPx: measureOuterHeight(element),
    }

    if (!chunk.id || chunk.measuredHeightPx <= 0) {
      return []
    }

    if (chunk.kind === 'body') {
      return splitBodyElementIntoMeasuredLineChunks(element, chunk)
    }

    return [chunk]
  })
```

Return `chunks: measuredChunks`.

- [ ] **Step 6: Add deterministic runtime browser test for the production measurement module**

Append this helper and test to `tests/exam-paper-two-column-line-measurement.test.mjs`. The helper transpiles the actual TypeScript source files with import paths rewritten to temporary runtime modules, then executes `buildMeasuredTwoColumnPreviewPages()` inside Chromium where `document`, `iframe`, fonts, and layout APIs are real.

```js
import ts from 'typescript'

const measurementSource = readFileSync(
  new URL('../src/lib/exam-paper-two-column-measurement.ts', import.meta.url),
  'utf8'
)

function transpileRuntimeTs(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText
}

async function createBrowserRuntimeModules() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-line-browser-runtime-'))
  const layoutPath = join(tempDir, 'exam-paper-layout-contract.js')
  const singlePath = join(tempDir, 'exam-paper-single-column-layout.js')
  const exportPath = join(tempDir, 'export-utils.js')
  const measurementPath = join(tempDir, 'exam-paper-two-column-measurement.js')

  writeFileSync(layoutPath, transpileRuntimeTs(layoutContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)))
  writeFileSync(singlePath, transpileRuntimeTs(singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)))
  writeFileSync(exportPath, transpileRuntimeTs(exportUtilsSource
    .replace("import pdfMake from 'pdfmake/build/pdfmake'\n", 'const pdfMake = {}\n')
    .replace("import * as pdfFonts from 'pdfmake/build/vfs_fonts'\n", 'const pdfFonts = {}\n')
    .replace("import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, UnderlineType } from 'docx'\n", [
      'class Document { constructor(args) { this.args = args } }',
      'const Packer = { toBlob: async () => new Blob() }',
      'class Paragraph { constructor(args) { this.args = args } }',
      'class TextRun { constructor(args) { this.args = args } }',
      "const AlignmentType = { CENTER: 'center' }",
      "const HeadingLevel = { HEADING_1: 'heading-1' }",
      "const UnderlineType = { SINGLE: 'single' }",
      '',
    ].join('\n'))
    .replace("import { saveAs } from 'file-saver'\n", 'const saveAs = () => {}\n')
    .replace(/from '@\/lib\/exam-paper-print-pagination\.js'/g, `from '${printPaginationModuleUrl}'`)
    .replace(/from '@\/lib\/exam-paper-layout-contract'/g, `from '${pathToFileURL(layoutPath).href}'`)
    .replace(/from '@\/lib\/exam-paper-single-column-layout'/g, `from '${pathToFileURL(singlePath).href}'`)
    .replace(/from '@\/lib\/questions\/normalize-question-field'/g, `from '${normalizeQuestionFieldModuleUrl}'`)))
  writeFileSync(measurementPath, transpileRuntimeTs(measurementSource
    .replace(/from '@\/lib\/export-utils'/g, `from '${pathToFileURL(exportPath).href}'`)
    .replace(/from '@\/lib\/exam-paper-pdf-pagination\.js'/g, `from '${paginationModuleUrl}'`)))

  return {
    exportUtilsUrl: pathToFileURL(exportPath).href,
    measurementUrl: pathToFileURL(measurementPath).href,
  }
}

async function runProductionMeasuredPathInBrowser(examPaper) {
  const { chromium } = await import('playwright')
  const { exportUtilsUrl, measurementUrl } = await createBrowserRuntimeModules()
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent('<!doctype html><html><body></body></html>', { waitUntil: 'domcontentloaded' })
    return await page.evaluate(async ({ examPaper, exportUtilsUrl, measurementUrl }) => {
      const measurement = await import(measurementUrl)
      const exportUtils = await import(exportUtilsUrl)
      const twoColumnMeasuredPages = await measurement.buildMeasuredTwoColumnPreviewPages({ examPaper })
      const html = exportUtils.buildExamPaperPrintHtml(examPaper, { twoColumnMeasuredPages })

      return {
        twoColumnMeasuredPages,
        html,
        bodyLineChunkCount: twoColumnMeasuredPages
          .flatMap((page) => page.columns.flat())
          .filter((chunk) => chunk.kind === 'body' && typeof chunk.bodyLineIndex === 'number')
          .length,
      }
    }, { examPaper, exportUtilsUrl, measurementUrl })
  } finally {
    await browser.close()
  }
}

test('production measured path returns line-level body chunks in Chromium', async () => {
  const result = await runProductionMeasuredPathInBrowser(createLongPassageExamPaper())

  assert.equal(
    result.bodyLineChunkCount > 3,
    true,
    `expected production measurement path to emit multiple body line chunks, got ${JSON.stringify(result.twoColumnMeasuredPages, null, 2)}`
  )
})
```

- [ ] **Step 7: Run tests**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected:

```txt
# pass 3
# fail 0
```

- [ ] **Step 8: Commit Task 2**

```bash
git add src/lib/export-utils.ts src/lib/exam-paper-two-column-measurement.ts tests/exam-paper-two-column-line-measurement.test.mjs
git commit -m "Measure two-column body text at rendered line boundaries"
```

---

## Task 3: 최종 measured HTML에서 같은 column body lines를 flow group으로 병합

**Files:**
- Modify: `src/lib/export-utils.ts:567-589`
- Modify: `src/lib/export-utils.ts:760-795`
- Test: `tests/exam-paper-two-column-line-measurement.test.mjs`

- [ ] **Step 1: Add failing final HTML grouping test**

Append this test to `tests/exam-paper-two-column-line-measurement.test.mjs`:

```js
test('final measured two-column HTML groups adjacent body line chunks into one visual flow block', async () => {
  const exportUtilsSourceText = readFileSync(
    new URL('../src/lib/export-utils.ts', import.meta.url),
    'utf8'
  )

  assert.match(
    exportUtilsSourceText,
    /renderMeasuredColumnChunksHtml/,
    'expected measured column renderer to group line chunks before HTML output'
  )
  assert.match(
    exportUtilsSourceText,
    /two-column-measured-body-flow/,
    'expected final grouped body flow class for measured line chunks'
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected:

```txt
not ok ... expected measured column renderer to group line chunks before HTML output
```

- [ ] **Step 3: Add measured body group renderer**

Modify `src/lib/export-utils.ts` before `renderTwoColumnMeasuredPagesHtml()`:

```ts
function isMeasuredBodyLineChunk(chunk: HtmlPaginationChunk) {
  return chunk.kind === 'body' &&
    typeof chunk.bodyLineIndex === 'number' &&
    Boolean(chunk.sourceSectionId) &&
    typeof chunk.bodyRawText === 'string'
}

function renderMeasuredBodyLineGroupHtml(chunks: HtmlPaginationChunk[]) {
  const first = chunks[0]
  const text = chunks
    .map((chunk) => chunk.bodyRawText ?? '')
    .filter(Boolean)
    .join(' ')

  return `
    <div class="question-chunk question-body-chunk two-column-measured-body-flow" data-source-section-id="${escapeHtml(first.sourceSectionId ?? first.id)}" data-question-number="${first.questionNumber ?? ''}" data-line-count="${chunks.length}">
      <div class="flow-body-text">
        ${renderInlineBracketUnderlineHtml(text)}
      </div>
    </div>
  `
}

function renderMeasuredColumnChunksHtml(chunks: HtmlPaginationChunk[]) {
  const htmlParts: string[] = []
  let index = 0

  while (index < chunks.length) {
    const chunk = chunks[index]

    if (!isMeasuredBodyLineChunk(chunk)) {
      htmlParts.push(chunk.html)
      index += 1
      continue
    }

    const group: HtmlPaginationChunk[] = [chunk]
    index += 1

    while (
      index < chunks.length &&
      isMeasuredBodyLineChunk(chunks[index]) &&
      chunks[index].sourceSectionId === chunk.sourceSectionId
    ) {
      group.push(chunks[index])
      index += 1
    }

    htmlParts.push(renderMeasuredBodyLineGroupHtml(group))
  }

  return htmlParts.join('')
}
```

Change `renderTwoColumnMeasuredPagesHtml()` column rendering:

```ts
<div class="two-column-column">
  ${renderMeasuredColumnChunksHtml(page.columns[0])}
</div>
<div class="two-column-column">
  ${renderMeasuredColumnChunksHtml(page.columns[1])}
</div>
```

- [ ] **Step 4: Add CSS for grouped body flow**

Modify `buildExamPaperPrintStyles()` in `src/lib/export-utils.ts`:

```css
.two-column-measured-body-flow {
  margin-bottom: 0;
}
.two-column-measured-body-flow .flow-body-text {
  margin-bottom: 0;
}
.question-chunk-anchor + .two-column-measured-body-flow .flow-body-text {
  margin-top: 0;
}
```

Keep existing `.question-body-chunk.chunk-linked-*` rules for non-measured fallback.

- [ ] **Step 5: Run grouping test**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected:

```txt
# pass 4
# fail 0
```

- [ ] **Step 6: Commit Task 3**

```bash
git add src/lib/export-utils.ts tests/exam-paper-two-column-line-measurement.test.mjs
git commit -m "Group measured two-column body lines into visual flow blocks"
```

---

## Task 4: 실제 브라우저 DOM에서 문단형 block break 제거 검증

**Files:**
- Modify: `tests/exam-paper-two-column-line-measurement.test.mjs`
- Modify: `tests/exam-paper-two-column-reproduction.test.mjs`

- [ ] **Step 1: Add end-to-end measured preview DOM test**

Append this test to `tests/exam-paper-two-column-line-measurement.test.mjs`. It uses `runProductionMeasuredPathInBrowser()` from Task 2, so it executes the same `buildMeasuredTwoColumnPreviewPages()` path used by `ExamPaperPdfWorkspace.tsx:160-171`.

```js
test('final measured preview does not render repeated body-part paragraph blocks for one passage', async () => {
  const { html, bodyLineChunkCount } = await runProductionMeasuredPathInBrowser(createLongPassageExamPaper())

  assert.equal(
    bodyLineChunkCount > 3,
    true,
    `expected production measurement path to create line chunks before final rendering, got ${bodyLineChunkCount}`
  )
  assert.doesNotMatch(
    html,
    /question-1-body-part-2/,
    'expected final measured preview not to render old sentence-sized body part blocks'
  )
  assert.match(
    html,
    /two-column-measured-body-flow[\s\S]*From an organizational viewpoint[\s\S]*The varying departments/,
    'expected adjacent passage sentences to be inside a measured body flow block'
  )
})
```

- [ ] **Step 2: Run test to verify it fails before full integration**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs
```

Expected before final integration:

```txt
not ok ... expected final measured preview not to render old sentence-sized body part blocks
```

Expected after Task 1-3 integration:

```txt
# pass 5
# fail 0
```

- [ ] **Step 3: Strengthen reproduction test with body-flow DOM metrics**

Modify `tests/exam-paper-two-column-reproduction.test.mjs` inside `analyzeDoublePreviewPages()` column mapper. Extend sections with class metadata:

```js
const sections = [...columnEl.querySelectorAll('[data-section-id], .two-column-measured-body-flow')].map((el) => {
  const rect = el.getBoundingClientRect()
  return {
    id: el.getAttribute('data-section-id') || el.getAttribute('data-source-section-id'),
    kind: el.getAttribute('data-section-kind') || (el.classList.contains('two-column-measured-body-flow') ? 'body-flow' : null),
    className: el.getAttribute('class') || '',
    overflowPx: Number(Math.max(0, rect.bottom - pageRect.bottom).toFixed(2)),
    bottomRemainingPx: Number((columnRect.bottom - rect.bottom).toFixed(2)),
    pageBottom: Number((rect.bottom - pageRect.top).toFixed(2)),
  }
})
```

Add helper:

```js
function assertNoRepeatedBodyPartBlocks(pages) {
  const bodyPartBlocks = pages.flatMap((page) => (
    page.columns.flatMap((column) => (
      column.sections?.filter((section) => /question-\d+-body-part-\d+/.test(section.id ?? '')) ?? []
    ))
  ))

  assert.equal(
    bodyPartBlocks.length,
    0,
    `expected no old sentence-sized body part blocks in measured preview, got ${JSON.stringify(bodyPartBlocks, null, 2)}`
  )
}
```

Add `sections` to returned column object:

```js
return {
  page: pageIndex + 1,
  column: columnIndex + 1,
  sectionCount: sections.length,
  sections,
  firstId: sections.at(0)?.id ?? null,
  firstKind: sections.at(0)?.kind ?? null,
  lastId: sections.at(-1)?.id ?? null,
  maxOverflowPx: sections.length ? Math.max(...sections.map((section) => section.overflowPx)) : 0,
  bottomRemainingPx: sections.length ? sections.at(-1).bottomRemainingPx : Number(columnRect.height.toFixed(2)),
}
```

Call `assertNoRepeatedBodyPartBlocks(pages)` in these tests:

```js
test('exam-with-answers double preview should not leave a screenshot-like first-page bottom gap', async () => {
  const html = await buildPreviewHtml(createScreenshotLikeExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assertHeaderStartingColumnsAreDense(firstPage, 80)
  assertNoRepeatedBodyPartBlocks(pages)
})
```

and:

```js
test('exam-with-answers double preview places realistic answers after all question chunks without overflow', async () => {
  const html = await buildPreviewHtml(createRealisticExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assertExamWithAnswersSectionsAreSeparated(html)
  assertNoDoublePreviewOverflow(pages)
  assertHeaderStartingColumnsAreDense(firstPage, 80)
  assertNoRepeatedBodyPartBlocks(pages)
})
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
node --test tests/exam-paper-two-column-line-measurement.test.mjs tests/exam-paper-two-column-reproduction.test.mjs
```

Expected:

```txt
# fail 0
```

- [ ] **Step 5: Commit Task 4**

```bash
git add tests/exam-paper-two-column-line-measurement.test.mjs tests/exam-paper-two-column-reproduction.test.mjs
git commit -m "Verify two-column measured body flow in browser DOM"
```

---

## Task 5: Existing tests 업데이트 및 전체 검증

**Files:**
- Modify: `tests/exam-paper-two-column-spacing.test.mjs`
- Modify: `tests/exam-paper-browser-pdf-viewer.test.mjs` only if existing string assertions reference old `question-N-body-part-M` behavior
- Run only: `src/lib/export-utils.ts`, `src/lib/exam-paper-layout-contract.ts`, `src/lib/exam-paper-two-column-measurement.ts`, `src/lib/exam-paper-pdf-pagination.js`

- [ ] **Step 1: Update spacing test assertions**

Modify `tests/exam-paper-two-column-spacing.test.mjs` so CSS assertions check the new grouped measured body class in addition to existing fallback rules:

```js
assert.match(
  html,
  /\.two-column-measured-body-flow\s*\{\s*margin-bottom:\s*0;/,
  'expected measured two-column body flow groups not to add paragraph-like bottom spacing'
)
assert.match(
  html,
  /\.two-column-measured-body-flow \.flow-body-text\s*\{\s*margin-bottom:\s*0;/,
  'expected measured two-column body flow text not to add paragraph-like bottom spacing'
)
```

Keep the existing `question boundaries include one explicit br separator` test.

- [ ] **Step 2: Run focused PDF preview tests**

Run:

```bash
node --test --test-concurrency=1 \
  tests/exam-paper-two-column-line-measurement.test.mjs \
  tests/exam-paper-two-column-spacing.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs \
  tests/exam-paper-browser-pdf-viewer.test.mjs \
  tests/exam-paper-exam-with-answers-separated.test.mjs \
  tests/exam-paper-single-column-regression.test.mjs
```

Expected:

```txt
# fail 0
```

If `tests/exam-paper-exam-with-answers-separated.test.mjs` has intermittent Playwright timing failure, run it once alone:

```bash
node --test tests/exam-paper-exam-with-answers-separated.test.mjs
```

Expected:

```txt
# fail 0
```

- [ ] **Step 3: Run TypeScript check**

Run:

```bash
npx tsc --noEmit --pretty false
```

Expected: no output and exit code `0`.

- [ ] **Step 4: Run targeted lint**

Run:

```bash
npx eslint \
  src/lib/export-utils.ts \
  src/lib/exam-paper-layout-contract.ts \
  src/lib/exam-paper-two-column-measurement.ts \
  tests/exam-paper-two-column-line-measurement.test.mjs \
  tests/exam-paper-two-column-spacing.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs
```

Expected: exit code `0`. Existing `baseline-browser-mapping` warning is acceptable.

- [ ] **Step 5: Run production build**

Run:

```bash
npm run build
```

Expected:

```txt
✓ Compiled successfully
```

Existing warnings about multiple lockfiles, middleware/proxy convention, and `baseline-browser-mapping` are acceptable if build exits `0`.

- [ ] **Step 6: Optional authenticated visual probe**

If an authenticated local session is available at `localhost:4000`, open:

```txt
http://localhost:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02
```

Manual acceptance checks:
- 2단 시험지 mode에서 1번 지문의 English passage가 임의 문장 단위 paragraph처럼 끊기지 않는다.
- Column/page 경계에서만 자연스럽게 다음 column/page로 이어진다.
- 문제 1과 문제 2 사이에는 한 줄 간격이 있다.
- 1단 모드는 기존처럼 지문이 연속 표시된다.

If no authenticated session is available, record this as `Not-tested` in the commit message.

- [ ] **Step 7: Final commit**

```bash
git add \
  src/lib/export-utils.ts \
  src/lib/exam-paper-layout-contract.ts \
  src/lib/exam-paper-two-column-measurement.ts \
  tests/exam-paper-two-column-line-measurement.test.mjs \
  tests/exam-paper-two-column-spacing.test.mjs \
  tests/exam-paper-two-column-reproduction.test.mjs

git commit -m "Paginate two-column passages from measured line flow" \
  -m "Two-column previews previously split long passages into 240-character sentence blocks before measurement, so the output looked like paragraph-separated chunks even when Supabase passage_text had no newlines. This changes body pagination to measure rendered line flow and groups adjacent measured body lines back into a visual paragraph per column." \
  -m "Constraint: PDF save must match the web preview while preserving deterministic column/page pagination" \
  -m "Rejected: CSS display:inline/display:contents only | flex item boundaries and DOM measurement boxes can break pagination" \
  -m "Rejected: Increase body chunk max chars | only delays the same block-boundary artifact" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Directive: Do not reintroduce character-count body block fragmentation for measured two-column previews" \
  -m "Tested: node --test --test-concurrency=1 targeted exam-paper tests" \
  -m "Tested: npx tsc --noEmit --pretty false" \
  -m "Tested: targeted npx eslint" \
  -m "Tested: npm run build" \
  -m "Not-tested: Authenticated live browser screenshot comparison if no logged-in local session is available"
```

---

## Plan Self-Review

### 1. Spec coverage

- Supabase 원본값 확인: 문제분석 섹션에 포함.
- 1단/2단 구현 차이 분석: 문제분석 섹션 및 File Structure에 포함.
- pagination이 꼬이지 않는 방향: DOM line measurement + existing measured chunk pagination 유지로 반영.
- 2단 지문이 1단처럼 이어져 보이게 하기: Task 3 final grouped rendering으로 반영.
- 검증에서 통과되어야 loop 종료: Task 5 전체 검증과 Loop 1 통과 기준에 반영.

### 2. Placeholder scan

Placeholder scan passed. Every task includes exact file paths, code blocks, commands, and expected outcomes.

### 3. Type consistency

- `HtmlPaginationChunk.bodyRawText`, `sourceSectionId`, `bodyLineIndex`, `bodyLineCount`, `measuredHeightPx` are introduced once in Task 1 and reused consistently in Tasks 2-4.
- `renderMeasuredColumnChunksHtml()` consumes the same metadata produced by `splitBodyElementIntoMeasuredLineChunks()`.
- Existing `kind: 'body'` is retained, so `paginateMeasuredTwoColumnChunks()` does not need a new kind union.

