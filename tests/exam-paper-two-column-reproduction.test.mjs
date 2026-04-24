import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { answerOnlyDoubleOverflowFixture } from './fixtures/exam-paper-two-column-answer-only-overflow.fixture.mjs'
import { answerOnlyDoubleUnderfillFixture } from './fixtures/exam-paper-two-column-answer-only-underfill.fixture.mjs'
import { examOnlyDoubleSegmentationFixture } from './fixtures/exam-paper-two-column-exam-only-segmentation.fixture.mjs'
import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

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
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-repro-layout-contract-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = layoutContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  const moduleUrl = `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`

  return {
    moduleUrl,
    module: await import(moduleUrl),
  }
}

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-repro-single-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtilsModule(layoutContractModuleUrl, singleColumnLayoutModuleUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-repro-export-utils-'))
  const tempModulePath = join(tempDir, 'export-utils.runtime.ts')
  const runtimeSource = exportUtilsSource
    .replace(
      "import pdfMake from 'pdfmake/build/pdfmake'\n",
      'const pdfMake = {}\n'
    )
    .replace(
      "import * as pdfFonts from 'pdfmake/build/vfs_fonts'\n",
      'const pdfFonts = {}\n'
    )
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
    .replace(
      "import { saveAs } from 'file-saver'\n",
      'const saveAs = () => {}\n'
    )
    .replace(
      /from '@\/lib\/exam-paper-print-pagination\.js'/g,
      `from '${printPaginationModuleUrl}'`
    )
    .replace(
      /from '@\/lib\/exam-paper-layout-contract'/g,
      `from '${layoutContractModuleUrl}'`
    )
    .replace(
      /from '@\/lib\/exam-paper-single-column-layout'/g,
      `from '${singleColumnLayoutModuleUrl}'`
    )
    .replace(
      /from '@\/lib\/questions\/normalize-question-field'/g,
      `from '${normalizeQuestionFieldModuleUrl}'`
    )

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

async function loadRuntimeExportUtils() {
  const {
    moduleUrl: layoutContractModuleUrl,
  } = await loadRuntimeLayoutContractModule()
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
  return loadRuntimeExportUtilsModule(
    layoutContractModuleUrl,
    singleColumnLayoutModuleUrl
  )
}

async function buildPreviewHtml(examPaper, options) {
  const exportUtilsModule = await loadRuntimeExportUtils()

  return exportUtilsModule.buildExamPaperPrintHtml(examPaper, options)
}

async function buildMeasuredTwoColumnPreviewHtml(examPaper) {
  const exportUtilsModule = await loadRuntimeExportUtils()
  const { paginateMeasuredTwoColumnChunks } = await import(paginationModuleUrl)
  const measurementHtml = exportUtilsModule.buildExamPaperTwoColumnMeasurementHtml(examPaper)
  const measured = await measureTwoColumnChunksWithBrowser(measurementHtml)
  const twoColumnMeasuredPages = paginateMeasuredTwoColumnChunks(measured.chunks, {
    firstPageColumnHeightPx: measured.firstPageColumnHeightPx,
    otherPageColumnHeightPx: measured.otherPageColumnHeightPx,
    bottomGuardPx: 8,
  })

  return exportUtilsModule.buildExamPaperPrintHtml(examPaper, {
    twoColumnMeasuredPages,
  })
}

async function measureTwoColumnChunksWithBrowser(html) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => document.fonts?.ready)
    await page.waitForTimeout(250)

    return await page.evaluate(() => {
      const firstPage = document.querySelector('.measurement-first-page')
      const otherPage = document.querySelector('.measurement-other-page')
      const firstColumn = document.querySelector('[data-measurement-column="first"]')
      const otherColumn = document.querySelector('[data-measurement-column="other"]')

      if (!firstPage || !otherPage || !firstColumn || !otherColumn) {
        throw new Error('expected measurement page and column elements')
      }

      const measureOuterHeight = (element) => {
        const rect = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const marginTop = Number.parseFloat(style.marginTop || '0') || 0
        const marginBottom = Number.parseFloat(style.marginBottom || '0') || 0

        return rect.height + marginTop + marginBottom
      }
      const measureUsableColumnHeight = (pageEl, columnEl) => {
        const pageRect = pageEl.getBoundingClientRect()
        const columnRect = columnEl.getBoundingClientRect()
        const pageStyle = getComputedStyle(pageEl)
        const paddingBottom = Number.parseFloat(pageStyle.paddingBottom || '0') || 0

        return Math.max(0, pageRect.bottom - paddingBottom - columnRect.top)
      }
      const normalizeKind = (kind) => (
        ['header', 'body', 'choice', 'answer', 'explanation'].includes(kind)
          ? kind
          : 'body'
      )

      return {
        chunks: [...firstColumn.querySelectorAll('[data-section-id]')]
          .map((element) => ({
            id: element.dataset.sectionId || '',
            estimatedHeight: Number(element.dataset.estimatedHeight || '0'),
            kind: normalizeKind(element.dataset.sectionKind),
            html: element.outerHTML,
            measuredHeightPx: measureOuterHeight(element),
          }))
          .filter((chunk) => chunk.id && chunk.measuredHeightPx > 0),
        firstPageColumnHeightPx: measureUsableColumnHeight(firstPage, firstColumn),
        otherPageColumnHeightPx: measureUsableColumnHeight(otherPage, otherColumn),
      }
    })
  } finally {
    await browser.close()
  }
}

async function analyzeDoublePreviewPages(html) {
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(250)

    return await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.preview-page')]

      return pages.map((pageEl, pageIndex) => {
        const pageRect = pageEl.getBoundingClientRect()
        const columns = [...pageEl.querySelectorAll('.two-column-column')].map((columnEl, columnIndex) => {
          const columnRect = columnEl.getBoundingClientRect()
          const sections = [...columnEl.querySelectorAll('[data-section-id]')].map((el) => {
            const rect = el.getBoundingClientRect()
            return {
              id: el.getAttribute('data-section-id'),
              kind: el.getAttribute('data-section-kind'),
              overflowPx: Number(Math.max(0, rect.bottom - pageRect.bottom).toFixed(2)),
              bottomRemainingPx: Number((columnRect.bottom - rect.bottom).toFixed(2)),
              pageBottom: Number((rect.bottom - pageRect.top).toFixed(2)),
            }
          })

          return {
            page: pageIndex + 1,
            column: columnIndex + 1,
            sectionCount: sections.length,
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
  } finally {
    await browser.close()
  }
}

async function analyzeDoublePreview(html) {
  const pages = await analyzeDoublePreviewPages(html)
  return pages.flatMap((page) => page.columns)
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
  const html = await buildPreviewHtml(createScreenshotLikeExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assert.equal(
    firstPage.bottomRemainingPx < 320,
    true,
    `expected screenshot-like exam-with-answers first page bottom slack under 320px, got ${JSON.stringify(firstPage, null, 2)}`
  )
})

test('exam-with-answers double preview should not orphan a realistic short answer onto a sparse next page', async () => {
  const html = await buildPreviewHtml(createRealisticExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]
  const secondPage = pages[1]

  assert.ok(firstPage, 'expected a first preview page')
  assert.equal(
    firstPage.bottomRemainingPx < 220,
    true,
    `expected realistic exam-with-answers first page bottom slack under 220px, got ${JSON.stringify(firstPage, null, 2)}`
  )

  if (secondPage) {
    assert.equal(
      secondPage.bottomRemainingPx < 1000,
      true,
      `expected realistic exam-with-answers sparse follow-up page slack under 1000px, got ${JSON.stringify(secondPage, null, 2)}`
    )
  }
})

test('exam-with-answers double preview should keep the real fixture pair closer to the bottom margin on page 1', async () => {
  const html = await buildPreviewHtml(createRealisticExamWithAnswersExamPaper())
  const pages = await analyzeDoublePreviewPages(html)
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assert.equal(
    firstPage.bottomRemainingPx < 220,
    true,
    `expected real exam-with-answers pair to keep first-page bottom slack under 220px, got ${JSON.stringify(firstPage, null, 2)}`
  )
})

test('exam-with-answers double preview should not leave a screenshot-like first-page bottom gap for the real fixture pair', async () => {
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
  const firstPage = pages[0]

  assert.ok(firstPage, 'expected a first preview page')
  assert.equal(
    firstPage.bottomRemainingPx < 220,
    true,
    `expected screenshot-like exam-with-answers first page bottom slack under 220px, got ${JSON.stringify(firstPage, null, 2)}`
  )
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
