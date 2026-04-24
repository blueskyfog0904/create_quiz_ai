import assert from 'node:assert/strict'
import test from 'node:test'

import {
  loadRuntimeExportUtils,
  runProductionMeasuredPathInBrowser,
  withBrowserPage,
} from './helpers/exam-paper-two-column-runtime-harness.mjs'
import { answerOnlyDoubleOverflowFixture } from './fixtures/exam-paper-two-column-answer-only-overflow.fixture.mjs'
import { answerOnlyDoubleUnderfillFixture } from './fixtures/exam-paper-two-column-answer-only-underfill.fixture.mjs'
import { examOnlyDoubleSegmentationFixture } from './fixtures/exam-paper-two-column-exam-only-segmentation.fixture.mjs'
import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

async function buildPreviewHtml(examPaper, options) {
  const exportUtilsModule = await loadRuntimeExportUtils()

  return exportUtilsModule.buildExamPaperPrintHtml(examPaper, options)
}

async function buildMeasuredTwoColumnPreviewHtml(examPaper) {
  const result = await runProductionMeasuredPathInBrowser(examPaper)
  return result.html
}

async function analyzeDoublePreviewPages(html) {
  return withBrowserPage(async (page) => {
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(250)

    return await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.preview-page')]

      return pages.map((pageEl, pageIndex) => {
        const pageRect = pageEl.getBoundingClientRect()
        const columns = [...pageEl.querySelectorAll('.two-column-column')].map((columnEl, columnIndex) => {
          const columnRect = columnEl.getBoundingClientRect()
          const sections = [...columnEl.querySelectorAll('[data-section-id], .two-column-measured-body-flow')].map((el) => {
            const rect = el.getBoundingClientRect()
            const className = el.getAttribute('class') || ''
            const isMeasuredBodyFlow = el.classList.contains('two-column-measured-body-flow')
            return {
              id: el.getAttribute('data-section-id'),
              kind: isMeasuredBodyFlow ? 'body-flow' : el.getAttribute('data-section-kind'),
              className,
              text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
              overflowPx: Number(Math.max(0, rect.bottom - pageRect.bottom).toFixed(2)),
              bottomRemainingPx: Number((columnRect.bottom - rect.bottom).toFixed(2)),
              pageBottom: Number((rect.bottom - pageRect.top).toFixed(2)),
            }
          })

          return {
            page: pageIndex + 1,
            column: columnIndex + 1,
            sections,
            sectionCount: sections.length,
            firstId: sections.at(0)?.id ?? null,
            firstKind: sections.at(0)?.kind ?? null,
            lastId: sections.at(-1)?.id ?? null,
            maxOverflowPx: sections.length ? Math.max(...sections.map((section) => section.overflowPx)) : 0,
            bottomRemainingPx: sections.length ? sections.at(-1).bottomRemainingPx : Number(columnRect.height.toFixed(2)),
          }
        })

        const sectionNodes = [...pageEl.querySelectorAll('[data-section-id]')].map((el) => {
          const rect = el.getBoundingClientRect()
          return {
            id: el.getAttribute('data-section-id'),
            pageBottom: Number((rect.bottom - pageRect.top).toFixed(2)),
          }
        })
        const maxPageBottom = sectionNodes.length ? Math.max(...sectionNodes.map((section) => section.pageBottom)) : 0

        return {
          page: pageIndex + 1,
          sectionCount: sectionNodes.length,
          bottomRemainingPx: Number((pageRect.height - maxPageBottom).toFixed(2)),
          columns,
        }
      })
    })
  })
}

async function analyzeDoublePreview(html) {
  const pages = await analyzeDoublePreviewPages(html)
  return pages.flatMap((page) => page.columns)
}


function extractOrderedSectionKindsFromHtml(html) {
  return [...html.matchAll(/data-section-id="([^"]+)"[\s\S]*?data-section-kind="([^"]+)"/g)]
    .map((match) => ({ id: match[1], kind: match[2] }))
}

function assertExamWithAnswersSectionsAreSeparated(html) {
  const orderedKinds = extractOrderedSectionKindsFromHtml(html)
  const lastQuestionIndex = Math.max(
    orderedKinds.findLastIndex((item) => item.kind === 'header'),
    orderedKinds.findLastIndex((item) => item.kind === 'body'),
    orderedKinds.findLastIndex((item) => item.kind === 'choice')
  )
  const firstAnswerIndex = orderedKinds.findIndex((item) => item.kind === 'answer')

  assert.ok(firstAnswerIndex > lastQuestionIndex, `expected all answers after all questions: ${JSON.stringify(orderedKinds)}`)
}

function assertNoDoublePreviewOverflow(pages) {
  assert.equal(
    pages.every((page) => page.columns.every((column) => column.maxOverflowPx === 0)),
    true,
    `expected no two-column overflow, got ${JSON.stringify(pages, null, 2)}`
  )
}

const weakBodyTailRegex = /\b(?:a|an|the|of|to|in|on|for|with|and|or|but|as|by|from)\b$/i

function assertNoWeakBodyTailAtColumnBreak(pages) {
  const weakTailColumns = pages.flatMap((page) => (
    page.columns.flatMap((column) => {
      const lastSection = column.sections.at(-1)
      const isMeasuredBodyFlow = lastSection?.className?.includes('two-column-measured-body-flow')
      const isBodyTail = lastSection && (lastSection.kind === 'body' || isMeasuredBodyFlow)

      if (!isBodyTail) {
        return []
      }

      const normalizedTail = (lastSection.text || '')
        .replace(/["'”’)\]]+$/g, '')
        .trim()

      if (!weakBodyTailRegex.test(normalizedTail)) {
        return []
      }

      return [{
        page: page.page,
        column: column.column,
        id: lastSection.id,
        kind: lastSection.kind,
        className: lastSection.className,
        tail: normalizedTail.slice(-80),
      }]
    })
  ))

  assert.equal(
    weakTailColumns.length,
    0,
    `expected no weak body tail at a column break, got ${JSON.stringify(weakTailColumns, null, 2)}`
  )
}

function assertNoRepeatedBodyPartBlocks(pages) {
  const repeatedBodyPartSections = pages.flatMap((page) => (
    page.columns.flatMap((column) => (
      column.sections.filter((section) => /question-\d+-body-part-\d+/.test(section.id ?? ''))
        .map((section) => ({
          page: page.page,
          column: column.column,
          ...section,
        }))
    ))
  ))

  assert.equal(
    repeatedBodyPartSections.length,
    0,
    `expected measured preview DOM to avoid old sentence-sized body-part blocks, got ${JSON.stringify(repeatedBodyPartSections, null, 2)}`
  )
}

function assertHeaderStartingColumnsAreDense(page, maxSlackPx) {
  const headerStartingColumns = page.columns.filter((column) => (
    column.sectionCount > 0 && column.firstKind === 'header'
  ))

  assert.ok(
    headerStartingColumns.length > 0,
    `expected at least one header-starting column to validate, got ${JSON.stringify(page, null, 2)}`
  )
  assert.equal(
    headerStartingColumns.every((column) => column.bottomRemainingPx < maxSlackPx),
    true,
    `expected every header-starting column to stay dense with slack under ${maxSlackPx}px, got ${JSON.stringify(headerStartingColumns, null, 2)}`
  )
}

function createScreenshotLikeExamWithAnswersExamPaper() {
  return {
    title: regressionExamPaper.title,
    description: regressionExamPaper.description,
    viewMode: 'exam-with-answers',
    columnLayout: 'double',
    questions: [
      {
        ...regressionExamPaper.questions[0],
        questionTextBackward: null,
      },
      regressionExamPaper.questions[2],
    ],
  }
}

function createRealisticExamWithAnswersExamPaper() {
  return {
    title: regressionExamPaper.title,
    description: regressionExamPaper.description,
    viewMode: 'exam-with-answers',
    columnLayout: 'double',
    questions: [
      {
        ...regressionExamPaper.questions[0],
        questionTextBackward: null,
      },
      regressionExamPaper.questions[1],
    ],
  }
}

test('answer-only double preview should not over-fragment a single long explanation', async () => {
  const html = await buildPreviewHtml(answerOnlyDoubleOverflowFixture)
  const columns = await analyzeDoublePreview(html)
  const totalSections = columns.reduce((sum, column) => sum + column.sectionCount, 0)

  assert.equal(
    totalSections <= 12,
    true,
    `expected long explanation to stay within 12 continuation pieces, got ${JSON.stringify(columns, null, 2)}`
  )
})

test('answer-only double preview should not leave large non-terminal blank areas for the underfill fixture', async () => {
  const html = await buildPreviewHtml(answerOnlyDoubleUnderfillFixture)
  const columns = await analyzeDoublePreview(html)
  const hasEmptyTrailingColumn = columns.some((column, index) => (
    column.sectionCount === 0 && columns.slice(0, index).some((previous) => previous.sectionCount > 0)
  ))

  assert.equal(
    hasEmptyTrailingColumn,
    false,
    `expected no empty trailing columns, got ${JSON.stringify(columns, null, 2)}`
  )
  assert.equal(
    columns.every((column, index) => index === columns.length - 1 || column.bottomRemainingPx < 160),
    true,
    `expected non-terminal columns to stay dense, got ${JSON.stringify(columns, null, 2)}`
  )
})

test('exam-only double preview should keep segmentation bounded for the segmentation fixture', async () => {
  const html = await buildPreviewHtml(examOnlyDoubleSegmentationFixture)
  const columns = await analyzeDoublePreview(html)

  assert.equal(
    columns.every((column) => column.maxOverflowPx === 0),
    true,
    `expected no overflow for segmentation fixture, got ${JSON.stringify(columns, null, 2)}`
  )
})

test('answer-only double preview should not leave a large final-page bottom gap', async () => {
  const html = await buildPreviewHtml({
    ...answerOnlyDoubleUnderfillFixture,
    questions: [
      ...answerOnlyDoubleUnderfillFixture.questions,
      {
        number: 3,
        questionText: 'unused',
        questionTextForward: null,
        questionTextBackward: null,
        passageText: null,
        choices: [],
        answer: '③',
        explanation: Array.from({ length: 10 }, (_, index) => (
          `Explanation sentence ${index + 1} extends the final answer-only page enough to expose large bottom whitespace if the last fragments spill too early.`
        )).join(' '),
      },
    ],
  })
  const pages = await analyzeDoublePreviewPages(html)
  const lastPage = pages.at(-1)

  assert.ok(lastPage, 'expected at least one preview page')
  assert.equal(
    lastPage.bottomRemainingPx < 320,
    true,
    `expected final answer-only double preview page to keep bottom slack under 320px, got ${JSON.stringify(lastPage, null, 2)}`
  )
})

test('exam-with-answers double preview should not leave a screenshot-like first-page bottom gap', async () => {
  const html = await buildMeasuredTwoColumnPreviewHtml(createScreenshotLikeExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assertNoRepeatedBodyPartBlocks(pages)
  assertHeaderStartingColumnsAreDense(firstPage, 80)
})

test('exam-with-answers double preview places realistic answers after all question chunks without overflow', async () => {
  const html = await buildMeasuredTwoColumnPreviewHtml(createRealisticExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assertExamWithAnswersSectionsAreSeparated(html)
  assertNoDoublePreviewOverflow(pages)
  assertNoRepeatedBodyPartBlocks(pages)
  assertNoWeakBodyTailAtColumnBreak(pages)
  assertHeaderStartingColumnsAreDense(firstPage, 80)
})

test('exam-with-answers double preview keeps the screenshot-like real fixture pair separated without overflow', async () => {
  const html = await buildPreviewHtml({
    title: regressionExamPaper.title,
    description: regressionExamPaper.description,
    viewMode: 'exam-with-answers',
    columnLayout: 'double',
    questions: [
      {
        ...regressionExamPaper.questions[0],
        questionTextBackward: null,
      },
      regressionExamPaper.questions[1],
    ],
  })
  const pages = await analyzeDoublePreviewPages(html)

  assert.ok(pages[0], 'expected a first preview page')
  assertExamWithAnswersSectionsAreSeparated(html)
  assertNoDoublePreviewOverflow(pages)
})

test('measured two-column preview should use rendered DOM heights before final pagination', async () => {
  const examPaper = createRealisticExamWithAnswersExamPaper()
  const estimatedHtml = await buildPreviewHtml(examPaper)
  const measuredHtml = await buildMeasuredTwoColumnPreviewHtml(examPaper)
  const estimatedPages = await analyzeDoublePreviewPages(estimatedHtml)
  const measuredPages = await analyzeDoublePreviewPages(measuredHtml)
  const estimatedFirstPage = estimatedPages[0]
  const measuredFirstPage = measuredPages[0]

  assert.ok(estimatedFirstPage, 'expected estimated preview to have a first page')
  assert.ok(measuredFirstPage, 'expected measured preview to have a first page')
  assert.equal(
    measuredPages.every((page) => (
      page.columns.every((column) => column.maxOverflowPx === 0)
    )),
    true,
    `expected measured pagination to avoid column overflow, got ${JSON.stringify(measuredPages, null, 2)}`
  )
  assertNoWeakBodyTailAtColumnBreak(measuredPages)
  assert.equal(
    measuredFirstPage.bottomRemainingPx < estimatedFirstPage.bottomRemainingPx,
    true,
    `expected measured first page to be denser than estimated pagination, got estimated=${JSON.stringify(estimatedFirstPage, null, 2)} measured=${JSON.stringify(measuredFirstPage, null, 2)}`
  )
  assert.equal(
    measuredFirstPage.bottomRemainingPx < 180,
    true,
    `expected measured first page bottom slack under 180px, got ${JSON.stringify(measuredFirstPage, null, 2)}`
  )
})
