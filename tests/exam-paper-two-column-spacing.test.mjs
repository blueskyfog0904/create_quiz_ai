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
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-spacing-layout-contract-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = layoutContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-spacing-single-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtils() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-spacing-export-utils-'))
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

async function buildPreviewHtml(examPaper) {
  const exportUtils = await loadRuntimeExportUtils()

  return exportUtils.buildExamPaperPrintHtml(examPaper)
}

function createSpacingExamPaper() {
  return {
    title: 'Spacing regression',
    description: undefined,
    viewMode: 'exam-only',
    columnLayout: 'double',
    questions: [{
      number: 1,
      questionText: '다음 글을 읽고 물음에 답하시오.',
      questionTextForward: 'Read the following passage.',
      passageText: 'First paragraph should flow without a paragraph gap. Second paragraph should continue like the single-column preview.',
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'first option' },
        { label: '②', text: 'second option' },
        { label: '③', text: 'third option' },
        { label: '④', text: 'fourth option' },
        { label: '⑤', text: 'fifth option' },
      ],
      answer: '①',
      explanation: 'explanation',
    }, {
      number: 2,
      questionText: '두 번째 문제입니다.',
      questionTextForward: null,
      passageText: 'Second question passage.',
      questionTextBackward: null,
      choices: [
        { label: '①', text: 'second first option' },
      ],
      answer: '①',
      explanation: 'second explanation',
    }],
  }
}

test('two-column flow body does not add artificial paragraph breaks for contiguous Supabase passage text', async () => {
  const html = await buildPreviewHtml(createSpacingExamPaper())

  assert.doesNotMatch(
    html,
    /First paragraph should flow without a paragraph gap\.<br><br>\s*Second paragraph should continue/,
    'expected two-column body text not to add blank paragraph breaks when source text has no paragraph breaks'
  )
  assert.match(
    html,
    /First paragraph should flow without a paragraph gap\. Second paragraph should continue/,
    'expected contiguous passage text to remain contiguous'
  )
})

test('two-column forward and backward body text render with subtle divider styling', async () => {
  const html = await buildPreviewHtml({
    ...createSpacingExamPaper(),
    questions: [{
      ...createSpacingExamPaper().questions[0],
      questionTextBackward: 'Choose the best answer based on the passage.',
    }],
  })

  assert.match(
    html,
    /flow-body-segment flow-body-segment-forward flow-body-supplemental[\s\S]*?Read the following passage\./,
    'expected question_text_forward to be rendered as a supplemental body segment'
  )
  assert.match(
    html,
    /flow-body-segment flow-body-segment-passage[\s\S]*?First paragraph should flow without a paragraph gap\. Second paragraph should continue/,
    'expected passage_text to stay as the normal passage segment'
  )
  assert.match(
    html,
    /flow-body-segment flow-body-segment-backward flow-body-supplemental[\s\S]*?Choose the best answer based on the passage\./,
    'expected question_text_backward to be rendered as a supplemental body segment'
  )
  assert.match(
    html,
    /\.flow-body-supplemental\s*\{[\s\S]*?border-top:\s*1px solid #d1d5db;[\s\S]*?border-bottom:\s*1px solid #d1d5db;/,
    'expected supplemental segments to use subtle divider lines, not boxes'
  )
})

test('two-column choices and header chunks use single-column vertical rhythm', async () => {
  const html = await buildPreviewHtml(createSpacingExamPaper())

  assert.match(
    html,
    /\.question-choice-chunk\s*\{\s*margin-bottom:\s*0;/,
    'expected fragmented two-column choices not to add extra chunk margin between options'
  )
  assert.match(
    html,
    /\.question-chunk-anchor\s*\{\s*margin-bottom:\s*0;/,
    'expected two-column header chunk not to double the question-text margin before body text'
  )
  assert.match(
    html,
    /\.two-column-measured-body-flow\s*\{\s*margin-bottom:\s*0;/,
    'expected measured two-column body flow groups not to add extra chunk margin'
  )
  assert.match(
    html,
    /\.two-column-measured-body-flow \.flow-body-text\s*\{\s*margin-bottom:\s*0;/,
    'expected measured two-column body text not to render line groups as separated paragraphs'
  )
})

test('question boundaries include one explicit br separator', async () => {
  const html = await buildPreviewHtml(createSpacingExamPaper())

  assert.match(
    html,
    /data-section-id="question-2-header"[\s\S]*?<br class="question-separator-br">[\s\S]*?<div class="question-text">/,
    'expected a one-line br separator before the next two-column question header'
  )
  assert.match(
    html,
    /\.two-column-column > \.question-chunk-anchor:first-child > \.question-separator-br\s*\{\s*display:\s*none;/,
    'expected the br separator to be hidden when a question header starts a column'
  )
})

test('single-column question spacing does not receive the two-column br separator', async () => {
  const html = await buildPreviewHtml({
    ...createSpacingExamPaper(),
    columnLayout: 'single',
  })

  assert.doesNotMatch(
    html,
    /single-column-header[\s\S]*?<br class="question-separator-br">/,
    'expected single-column spacing to keep its existing margin-based rhythm'
  )
})

test('single-column forward body text also uses subtle divider styling', async () => {
  const html = await buildPreviewHtml({
    ...createSpacingExamPaper(),
    columnLayout: 'single',
  })

  assert.match(
    html,
    /single-column-body[\s\S]*?flow-body-segment flow-body-segment-forward flow-body-supplemental[\s\S]*?Read the following passage\./,
    'expected single-column question_text_forward to use the same subtle divider styling'
  )
})
