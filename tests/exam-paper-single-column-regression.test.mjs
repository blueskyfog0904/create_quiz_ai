import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from './fixtures/exam-paper-two-column-regression.fixture.mjs'

const exportUtilsSource = readFileSync(
  new URL('../src/lib/export-utils.ts', import.meta.url),
  'utf8'
)
const examPaperPdfSource = readFileSync(
  new URL('../src/lib/exam-paper-pdf.ts', import.meta.url),
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

async function loadRuntimeLayoutContractModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-single-layout-contract-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = layoutContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)

  writeFileSync(tempModulePath, runtimeSource)

  const moduleUrl = `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`

  return {
    module: await import(moduleUrl),
    moduleUrl,
  }
}

async function loadRuntimeExportUtilsModule(layoutContractModuleUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-single-export-utils-'))
  const tempModulePath = join(tempDir, 'export-utils.runtime.ts')

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
    .replace(/from '@\/lib\/questions\/normalize-question-field'/g, `from '${normalizeQuestionFieldModuleUrl}'`)

  writeFileSync(tempModulePath, runtimeSource)

  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

async function loadRuntimePdfHarness() {
  const tempDir = mkdtempSync(join(tmpdir(), 'exam-paper-single-pdf-runtime-'))
  const runtimeLayoutContractPath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimePdfPath = join(tempDir, 'exam-paper-pdf.runtime.ts')

  writeFileSync(join(tempDir, 'pdfmake.stub.mjs'), [
    'export default {',
    '  createPdf(docDefinition) {',
    '    return {',
    '      getBlob(callback) {',
    '        callback(new Blob([JSON.stringify(docDefinition)], { type: "application/pdf" }))',
    '      },',
    '    }',
    '  },',
    '}',
    '',
  ].join('\n'))
  writeFileSync(join(tempDir, 'vfs-fonts.stub.mjs'), 'export const pdfMake = { vfs: {} }\nexport default { pdfMake: { vfs: {} } }\n')
  writeFileSync(join(tempDir, 'exam-paper-pdf-vfs.stub.mjs'), 'export default {}\n')
  writeFileSync(join(tempDir, 'file-saver.stub.mjs'), 'export function saveAs() {}\n')

  writeFileSync(
    runtimeLayoutContractPath,
    layoutContractSource
      .replace(/'@\/lib\/exam-paper-pdf-pagination\.js'/g, `'${paginationModuleUrl}'`)
      .replace(/'@\/lib\/questions\/normalize-question-field'/g, `'${normalizeQuestionFieldModuleUrl}'`)
  )

  const runtimePdfSource = examPaperPdfSource
    .replace(/'pdfmake\/build\/pdfmake'/g, "'./pdfmake.stub.mjs'")
    .replace(/'pdfmake\/build\/vfs_fonts'/g, "'./vfs-fonts.stub.mjs'")
    .replace(/'@\/lib\/exam-paper-pdf-vfs'/g, "'./exam-paper-pdf-vfs.stub.mjs'")
    .replace(/'file-saver'/g, "'./file-saver.stub.mjs'")
    .replace(/'@\/lib\/exam-paper-layout-contract'/g, "'./exam-paper-layout-contract.runtime.ts'")
    .replace(/'@\/lib\/questions\/normalize-question-field'/g, `'${normalizeQuestionFieldModuleUrl}'`)
    .concat('\nexport { buildPdfDocumentDefinition as buildExamPaperPdfDocumentDefinition }\n')

  writeFileSync(runtimePdfPath, runtimePdfSource)

  const pdfModule = await import(`${pathToFileURL(runtimePdfPath).href}?t=${Date.now()}`)
  return { buildExamPaperPdfDocumentDefinition: pdfModule.buildExamPaperPdfDocumentDefinition }
}

test('single-column HTML preview stays on the legacy question stack path', async () => {
  const {
    moduleUrl: layoutContractModuleUrl,
  } = await loadRuntimeLayoutContractModule()
  const exportUtilsModule = await loadRuntimeExportUtilsModule(layoutContractModuleUrl)

  const html = exportUtilsModule.buildExamPaperPrintHtml({
    ...regressionExamPaper,
    columnLayout: 'single',
    viewMode: 'exam-with-answers',
  })

  assert.match(html, /class="question"/)
  assert.doesNotMatch(html, /class="two-column-layout"/)
  assert.doesNotMatch(html, /data-section-id="[^"]*-part-/)
  assert.match(html, /정답:/)
})

test('single-column PDF document keeps question stacks unbreakable and does not use fragment column pages', async () => {
  const runtime = await loadRuntimePdfHarness()
  const docDefinition = runtime.buildExamPaperPdfDocumentDefinition({
    ...regressionExamPaper,
    columnLayout: 'single',
    viewMode: 'exam-with-answers',
  })

  const questionNode = docDefinition.content[2]

  assert.equal(Array.isArray(questionNode.stack), true)
  assert.equal(questionNode.unbreakable, true)
  assert.equal(questionNode.columns, undefined)
})
