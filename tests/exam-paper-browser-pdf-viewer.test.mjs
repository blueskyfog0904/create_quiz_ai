import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

const pdfSource = readFileSync(
  new URL('../src/lib/exam-paper-pdf.ts', import.meta.url),
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
const singleColumnLayoutSource = readFileSync(
  new URL('../src/lib/exam-paper-single-column-layout.ts', import.meta.url),
  'utf8'
)

const libraryExportButtonsSource = readFileSync(
  new URL('../src/app/(dashboard)/library/exam-papers/[id]/export-buttons.tsx', import.meta.url),
  'utf8'
)

const dashboardExportButtonsSource = readFileSync(
  new URL('../src/app/(dashboard)/exam-papers/[id]/export-buttons.tsx', import.meta.url),
  'utf8'
)

const workspaceSource = readFileSync(
  new URL('../src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx', import.meta.url),
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
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-browser-layout-contract-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = layoutContractSource
    .replace(
      /@\/lib\/exam-paper-pdf-pagination\.js/g,
      paginationModuleUrl
    )
    .replace(
      /@\/lib\/questions\/normalize-question-field/g,
      normalizeQuestionFieldModuleUrl
    )

  writeFileSync(tempModulePath, runtimeSource)

  const moduleUrl = `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`

  return {
    module: await import(moduleUrl),
    moduleUrl,
  }
}

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-browser-single-column-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtilsModule(layoutContractModuleUrl, singleColumnLayoutModuleUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-browser-export-utils-'))
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

function extractPreviewPageSectionIds(html) {
  return [...html.matchAll(/<section class="preview-page">([\s\S]*?)<\/section>/g)].map((pageMatch) => (
    [...pageMatch[1].matchAll(/data-section-id="([^"]+)"/g)].map((sectionMatch) => sectionMatch[1])
  ))
}

function buildExpectedPreviewQuestionPlans(layoutContractModule, examPaper, renderOptions) {
  if (renderOptions.viewMode !== 'exam-with-answers') {
    return examPaper.questions.map((question) =>
      layoutContractModule.buildQuestionSectionPlan(question, renderOptions)
    )
  }

  const questionOptions = {
    ...renderOptions,
    viewMode: 'exam-only',
    showQuestions: true,
    showAnswers: false,
  }
  const answerOptions = {
    ...renderOptions,
    viewMode: 'answer-only',
    showQuestions: false,
    showAnswers: true,
  }

  return [
    ...examPaper.questions.map((question) =>
      layoutContractModule.buildQuestionSectionPlan(question, questionOptions)
    ),
    ...examPaper.questions.map((question) =>
      layoutContractModule.buildQuestionSectionPlan(question, answerOptions)
    ),
  ]
}

test('exam paper PDF util uses the generated Pretendard TTF VFS bundle and shared PDF planner contract', () => {
  assert.match(pdfSource, /exam-paper-pdf-vfs/)
  assert.match(pdfSource, /Pretendard-Regular\.ttf/)
  assert.match(pdfSource, /Pretendard-Bold\.ttf/)
  assert.match(pdfSource, /createPdf\(docDefinition\)\.getBlob/)
  assert.match(pdfSource, /window\.open\(blobUrl, '_blank'\)/)
  assert.match(pdfSource, /columnLayout === 'double'/)
  assert.match(pdfSource, /columns:\s*\[/)
  assert.match(pdfSource, /buildQuestionChunksForTwoColumn/)
  assert.match(pdfSource, /buildTwoColumnLayoutPlan\(\{/)
  assert.match(pdfSource, /profile:\s*'shared-default'/)
  assert.match(pdfSource, /target:\s*'pdf'/)
  assert.match(pdfSource, /hasDescription:\s*Boolean\(examPaper\.description\)/)
  assert.match(pdfSource, /layoutPlan\.pages\.forEach/)
  assert.match(pdfSource, /page\.columns\[0\]\.sectionIds/)
  assert.match(pdfSource, /questionChunkMap\.get\(sectionId\)\?\.node/)
  assert.match(pdfSource, /pageBreak: 'after'/)
  assert.match(pdfSource, /buildPlainAnswerTextStack/)
  assert.doesNotMatch(pdfSource, /buildDecoratedBoxNode/)
})

test('print template builder uses dedicated single-column groups and shared two-column preview output', () => {
  assert.match(exportUtilsSource, /export function buildExamPaperPrintHtml/)
  assert.match(exportUtilsSource, /export function openExamPaperPrintPreview/)
  assert.match(exportUtilsSource, /autoPrint = false/)
  assert.match(exportUtilsSource, /closeAfterPrint = false/)
  assert.match(exportUtilsSource, /buildSingleColumnQuestionGroups/)
  assert.match(exportUtilsSource, /paginateSingleColumnQuestionGroups/)
  assert.match(exportUtilsSource, /preview-page/)
  assert.match(exportUtilsSource, /questions-container/)
  assert.match(exportUtilsSource, /column-count:\s*2/)
})

async function getRuntimePreviewArtifacts(viewMode) {
  const {
    module: layoutContractModule,
    moduleUrl: layoutContractModuleUrl,
  } = await loadRuntimeLayoutContractModule()
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
  const exportUtilsModule = await loadRuntimeExportUtilsModule(
    layoutContractModuleUrl,
    singleColumnLayoutModuleUrl
  )

  const examPaper = {
    ...regressionExamPaper,
    viewMode,
  }
  const renderOptions = layoutContractModule.buildExamPaperRenderOptions(examPaper)
  const questionPlans = buildExpectedPreviewQuestionPlans(layoutContractModule, examPaper, renderOptions)
  const previewPlan = layoutContractModule.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })
  const previewHtml = exportUtilsModule.buildExamPaperPrintHtml(examPaper)

  return {
    previewPlan,
    previewHtml,
  }
}

function createLongAnswerOnlyExamPaper() {
  return {
    ...regressionExamPaper,
    viewMode: 'answer-only',
    questions: [
      {
        number: 1,
        questionText: 'unused in answer-only',
        questionTextForward: null,
        passageText: null,
        questionTextBackward: null,
        choices: [],
        answer: '①',
        explanation: 'Short explanation to seed the page before the continued answer.',
      },
      {
        number: 2,
        questionText: 'unused in answer-only',
        questionTextForward: null,
        passageText: null,
        questionTextBackward: null,
        choices: [],
        answer: '②',
        explanation: Array.from({ length: 48 }, (_, index) => (
          `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
        )).join(' '),
      },
    ],
  }
}

function createFlowBodyExamPaper() {
  const longBody = [
    regressionExamPaper.questions[0].questionTextForward,
    regressionExamPaper.questions[0].passageText,
    regressionExamPaper.questions[0].questionTextBackward,
    regressionExamPaper.questions[0].passageText,
  ].filter(Boolean).join(' ')

  return {
    ...regressionExamPaper,
    viewMode: 'exam-only',
    questions: [
      {
        ...regressionExamPaper.questions[0],
        passageText: longBody,
      },
      ...regressionExamPaper.questions.slice(1, 3),
    ],
  }
}

function createLongExamWithAnswersExamPaper() {
  return {
    ...regressionExamPaper,
    viewMode: 'exam-with-answers',
    questions: [
      regressionExamPaper.questions[0],
      {
        ...regressionExamPaper.questions[1],
        explanation: Array.from({ length: 20 }, (_, index) => (
          `Explanation sentence ${index + 1} explains in detail why the selected option is correct and how the supporting evidence accumulates across the passage.`
        )).join(' '),
      },
      ...regressionExamPaper.questions.slice(2, 5),
    ],
  }
}

async function getRuntimePreviewArtifactsForExamPaper(examPaper) {
  const {
    module: layoutContractModule,
    moduleUrl: layoutContractModuleUrl,
  } = await loadRuntimeLayoutContractModule()
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
  const exportUtilsModule = await loadRuntimeExportUtilsModule(
    layoutContractModuleUrl,
    singleColumnLayoutModuleUrl
  )

  const renderOptions = layoutContractModule.buildExamPaperRenderOptions(examPaper)
  const questionPlans = buildExpectedPreviewQuestionPlans(layoutContractModule, examPaper, renderOptions)
  const previewPlan = layoutContractModule.buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: true,
  })
  const previewHtml = exportUtilsModule.buildExamPaperPrintHtml(examPaper)

  return {
    previewPlan,
    previewHtml,
  }
}

test('two-column preview follows the shared planner page grouping for the regression fixture', async () => {
  const { previewPlan, previewHtml } = await getRuntimePreviewArtifacts('exam-with-answers')

  assert.deepEqual(
    extractPreviewPageSectionIds(previewHtml),
    previewPlan.pages.map((page) => page.columns.flatMap((column) => column.sectionIds))
  )
})


test('answer-only two-column preview prepends the question number inside each answer chunk', async () => {
  const { previewHtml } = await getRuntimePreviewArtifacts('answer-only')

  assert.match(
    previewHtml,
    /data-section-id="question-1-answer-part-1"[\s\S]*?<div class="answer-text-block">[\s\S]*?<div class="answer-text-line answer-text-question">1번<\/div>[\s\S]*?<div class="answer-text-line answer-text-answer">정답:/
  )
  assert.doesNotMatch(previewHtml, /answer-section/)
})

test('answer-only two-column preview can continue a long explanation into later answer fragments', async () => {
  const { previewPlan, previewHtml } = await getRuntimePreviewArtifactsForExamPaper(
    createLongAnswerOnlyExamPaper()
  )

  const allSectionIds = previewPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.ok(allSectionIds.includes('question-2-answer-part-1'))
  assert.ok(allSectionIds.includes('question-2-answer-part-2'))
  assert.match(previewHtml, /data-section-id="question-2-answer-part-1"/)
  assert.match(previewHtml, /data-section-id="question-2-answer-part-2"/)
  assert.match(
    previewHtml,
    /data-section-id="question-2-answer-part-2"[\s\S]*?<div class="answer-text-block">[\s\S]*?<div class="answer-text-line answer-text-explanation">Explanation sentence/
  )
})

test('two-column preview renders merged flow-body fragments without boxed passage wrappers', async () => {
  const { previewPlan, previewHtml } = await getRuntimePreviewArtifactsForExamPaper(
    createFlowBodyExamPaper()
  )
  const allSectionIds = previewPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.equal(allSectionIds.some((sectionId) => sectionId.startsWith('question-1-forward')), false)
  assert.equal(allSectionIds.some((sectionId) => sectionId.startsWith('question-1-passage')), false)
  assert.equal(allSectionIds.some((sectionId) => sectionId.startsWith('question-1-backward')), false)
  assert.equal(allSectionIds.includes('question-1-body-part-1'), true)
  assert.equal(allSectionIds.some((sectionId) => sectionId.startsWith('question-1-body-part-2')), true)
  assert.match(previewHtml, /data-section-id="question-1-body-part-1"/)
  assert.match(previewHtml, /class="question-chunk question-body-chunk(?: chunk-linked-start)?"/)
  assert.match(previewHtml, /class="flow-body-text"/)
  assert.doesNotMatch(previewHtml, /class="text-box/)
})

test('exam-with-answers two-column preview can continue a long answer into multiple fragments', async () => {
  const { previewPlan, previewHtml } = await getRuntimePreviewArtifactsForExamPaper(
    createLongExamWithAnswersExamPaper()
  )
  const allSectionIds = previewPlan.pages.flatMap((page) => page.columns.flatMap((column) => column.sectionIds))

  assert.equal(allSectionIds.includes('question-2-answer'), false)
  assert.equal(allSectionIds.some((sectionId) => sectionId.startsWith('question-2-answer-part-')), true)
  assert.match(previewHtml, /data-section-id="question-2-answer-part-1"/)
  assert.match(previewHtml, /data-section-id="question-2-answer-part-2"/)
})

test('single-column preview renders answer blocks as plain text with question labels', async () => {
  const {
    moduleUrl: layoutContractModuleUrl,
  } = await loadRuntimeLayoutContractModule()
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
  const exportUtilsModule = await loadRuntimeExportUtilsModule(
    layoutContractModuleUrl,
    singleColumnLayoutModuleUrl
  )

  const html = exportUtilsModule.buildExamPaperPrintHtml({
    ...regressionExamPaper,
    columnLayout: 'single',
    viewMode: 'exam-with-answers',
  })

  assert.match(
    html,
    /data-block-id="question-1-answer-part-1"[\s\S]*?<div class="answer-text-block">[\s\S]*?<div class="answer-text-line answer-text-question">1번<\/div>[\s\S]*?<div class="answer-text-line answer-text-answer">정답:/
  )
  assert.doesNotMatch(html, /answer-only-section|answer-section/)
})

test('print preview choice styles do not apply extra left indentation', () => {
  assert.doesNotMatch(exportUtilsSource, /\.choices\s*\{[\s\S]*?margin-left:\s*20px;/)
  assert.doesNotMatch(exportUtilsSource, /\.question-choice-chunk \.choice\s*\{[\s\S]*?margin-left:\s*20px;/)
})

test('PDF save preview choice CSS keeps left indentation at zero and removes row spacing', () => {
  assert.match(
    exportUtilsSource,
    /\.choices\s*\{[^}]*margin-left:\s*0(?:px)?;/s
  )
  assert.match(
    exportUtilsSource,
    /\.question-choice-chunk\s+\.choice\s*\{[^}]*margin-left:\s*0(?:px)?;/s
  )
  assert.match(
    exportUtilsSource,
    /\.choice\s*\{[^}]*margin-bottom:\s*0(?:px)?;/s
  )
})

test('library exam-paper export now opens the PDF workspace', () => {
  assert.match(libraryExportButtonsSource, /ExamPaperPdfWorkspace/)
  assert.match(libraryExportButtonsSource, /setIsPdfWorkspaceOpen\(true\)/)
})

test('dashboard exam-paper export now opens the PDF workspace', () => {
  assert.match(dashboardExportButtonsSource, /ExamPaperPdfWorkspace/)
  assert.match(dashboardExportButtonsSource, /setIsPdfWorkspaceOpen\(true\)/)
})

test('PDF workspace includes option panel controls and iframe preview', () => {
  assert.match(workspaceSource, /표시모드/)
  assert.match(workspaceSource, /레이아웃/)
  assert.match(workspaceSource, /문제 순서/)
  assert.match(workspaceSource, /draggable/)
  assert.match(workspaceSource, /<iframe/)
  assert.match(workspaceSource, /srcDoc=\{previewHtml\}/)
  assert.match(workspaceSource, /buildExamPaperPrintHtml/)
})

test('preview pages keep a fixed A4 height instead of growing by content', () => {
  assert.match(exportUtilsSource, /\.preview-page\s*\{[^}]*height:\s*297mm;/s)
  assert.match(exportUtilsSource, /\.preview-page\s*\{[^}]*overflow:\s*hidden;/s)
})

test('PDF workspace reseeds the preview state from the latest web question order whenever it opens', () => {
  assert.match(
    workspaceSource,
    /const syncWorkspaceToLatestProps = useCallback\(\(\) => \{\s*setViewMode\(initialViewMode\)\s*setColumnLayout\(initialColumnLayout\)\s*setQuestions\(renumberQuestions\(initialQuestions\)\)\s*setDraggingQuestionId\(null\)/s
  )
  assert.match(
    workspaceSource,
    /useEffect\(\(\) => \{\s*if \(!open\) \{\s*return\s*\}\s*syncWorkspaceToLatestProps\(\)/s
  )
})

test('PDF workspace measures single-column pages before building preview HTML', () => {
  assert.match(workspaceSource, /measureSingleColumnPreviewPages/)
  assert.match(workspaceSource, /singleColumnMeasuredPages/)
  assert.match(workspaceSource, /columnLayout === 'single'/)
  assert.match(workspaceSource, /groupAnswerOnlyQuestion:\s*viewMode === 'answer-only'/)
})

test('PDF workspace enters preview-pending mode immediately before the debounce delay elapses', () => {
  assert.match(workspaceSource, /setIsGeneratingPreview\(true\)[\s\S]*?const timeoutId = window\.setTimeout/s)
  assert.match(workspaceSource, /const abortController = new AbortController\(\)/)
  assert.match(workspaceSource, /buildMeasuredTwoColumnPreviewPages/)
  assert.match(workspaceSource, /twoColumnMeasuredPages/)
  assert.match(
    workspaceSource,
    /disabled=\{isGeneratingPreview \|\| isOpeningPdfTab \|\| isSavingPdf\}/
  )
  assert.match(
    workspaceSource,
    /disabled=\{isGeneratingPreview \|\| isSavingPdf \|\| isOpeningPdfTab\}/
  )
  assert.match(
    workspaceSource,
    /<Button[\s\S]*?disabled=\{isGeneratingPreview \|\| !previewHtml\}[\s\S]*?>[\s\S]*?인쇄[\s\S]*?<\/Button>/
  )
})
