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
      passageText: 'First paragraph should flow without a paragraph gap.\n\nSecond paragraph should continue like the single-column preview.',
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
    }],
  }
}

test('two-column flow body collapses English passage paragraph breaks to match single-column rhythm', async () => {
  const html = await buildPreviewHtml(createSpacingExamPaper())

  assert.doesNotMatch(
    html,
    /First paragraph should flow without a paragraph gap\.<br><br>\s*Second paragraph should continue/,
    'expected two-column body text not to render blank paragraph breaks inside the English passage'
  )
  assert.match(
    html,
    /Read the following passage\.<br>\s*First paragraph should flow without a paragraph gap\. Second paragraph should continue/,
    'expected prompt-to-passage spacing to use one line break, with passage paragraphs collapsed'
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
})
