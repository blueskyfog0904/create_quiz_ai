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
const exportUtilsSource = readFileSync(
  new URL('../src/lib/export-utils.ts', import.meta.url),
  'utf8'
)
const layoutContractSource = readFileSync(
  new URL('../src/lib/exam-paper-layout-contract.ts', import.meta.url),
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

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-separated-single-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

async function loadRuntimeLayoutContractModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-separated-layout-contract-'))
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

async function loadRuntimeSingleColumnLayoutModuleUrl() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-separated-single-layout-url-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtilsModule(layoutContractModuleUrl, singleColumnLayoutModuleUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-separated-export-utils-'))
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
  const { moduleUrl: layoutContractModuleUrl } = await loadRuntimeLayoutContractModule()
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModuleUrl()

  return loadRuntimeExportUtilsModule(layoutContractModuleUrl, singleColumnLayoutModuleUrl)
}

async function buildPreviewHtml(examPaper, options) {
  const exportUtils = await loadRuntimeExportUtils()

  return exportUtils.buildExamPaperPrintHtml(examPaper, options)
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

test('single-column separated answer fragments keep deterministic part ids for long explanations', async () => {
  const {
    buildSingleColumnExamWithAnswersSeparatedGroups,
    paginateSingleColumnQuestionGroups,
  } = await loadRuntimeSingleColumnLayoutModule()
  const groups = buildSingleColumnExamWithAnswersSeparatedGroups([
    {
      ...examPaperQuestions[0],
      explanation: Array.from({ length: 18 }, (_, index) => (
        `Long explanation sentence ${index + 1} keeps enough text to split into multiple answer fragments.`
      )).join(' '),
    },
  ])
  const pages = paginateSingleColumnQuestionGroups({
    questionGroups: groups,
    hasDescription: false,
  })
  const answerBlockIds = pages
    .flatMap((page) => page.blocks)
    .filter((block) => block.kind === 'answer')
    .map((block) => block.id)

  assert.ok(answerBlockIds.length > 1, `expected split answer fragments, got ${answerBlockIds.join(', ')}`)
  assert.deepEqual(
    answerBlockIds,
    answerBlockIds.map((_, index) => `question-1-answer-part-${index + 1}`)
  )
})

test('single-column exam-with-answers HTML renders all answers after the last question choice', async () => {
  const html = await buildPreviewHtml({
    title: 'Separated single',
    description: undefined,
    viewMode: 'exam-with-answers',
    columnLayout: 'single',
    questions: examPaperQuestions,
  })

  const question2ChoiceIndex = html.indexOf('data-block-id="question-2-choice-row-1"')
  const answer1Index = html.indexOf('data-block-id="question-1-answer')
  const answer2Index = html.indexOf('data-block-id="question-2-answer')

  assert.ok(question2ChoiceIndex > -1, 'expected question 2 choice block')
  assert.ok(answer1Index > question2ChoiceIndex, 'expected answer 1 after all question blocks')
  assert.ok(answer2Index > answer1Index, 'expected answer 2 after answer 1')
})

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

async function buildMeasuredTwoColumnPreviewHtml(examPaper) {
  const exportUtils = await loadRuntimeExportUtils()
  const { paginateMeasuredTwoColumnChunks } = await import(paginationModuleUrl)
  const measurementHtml = exportUtils.buildExamPaperTwoColumnMeasurementHtml(examPaper)
  const measured = await measureTwoColumnChunksWithBrowser(measurementHtml)
  const twoColumnMeasuredPages = paginateMeasuredTwoColumnChunks(measured.chunks, {
    firstPageColumnHeightPx: measured.firstPageColumnHeightPx,
    otherPageColumnHeightPx: measured.otherPageColumnHeightPx,
    bottomGuardPx: 8,
  })

  return exportUtils.buildExamPaperPrintHtml(examPaper, {
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
