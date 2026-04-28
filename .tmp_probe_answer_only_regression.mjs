import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { regressionExamPaper } from '/Users/mac/Documents/project/create_quiz_ai/tests/fixtures/exam-paper-two-column-regression.fixture.mjs'

const exportUtilsSource = readFileSync('/Users/mac/Documents/project/create_quiz_ai/src/lib/export-utils.ts', 'utf8')
const layoutContractSource = readFileSync('/Users/mac/Documents/project/create_quiz_ai/src/lib/exam-paper-layout-contract.ts', 'utf8')
const singleColumnLayoutSource = readFileSync('/Users/mac/Documents/project/create_quiz_ai/src/lib/exam-paper-single-column-layout.ts', 'utf8')
const paginationModuleUrl = pathToFileURL('/Users/mac/Documents/project/create_quiz_ai/src/lib/exam-paper-pdf-pagination.js').href
const printPaginationModuleUrl = pathToFileURL('/Users/mac/Documents/project/create_quiz_ai/src/lib/exam-paper-print-pagination.js').href
const normalizeQuestionFieldModuleUrl = pathToFileURL('/Users/mac/Documents/project/create_quiz_ai/src/lib/questions/normalize-question-field.ts').href

async function loadRuntimeLayoutContractModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'probe-layout-'))
  const tempModulePath = join(tempDir, 'layout.runtime.ts')
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
  const tempDir = mkdtempSync(join(tmpdir(), 'probe-single-'))
  const tempModulePath = join(tempDir, 'single.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)
  writeFileSync(tempModulePath, runtimeSource)
  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtilsModule(layoutContractModuleUrl, singleColumnLayoutModuleUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), 'probe-export-'))
  const tempModulePath = join(tempDir, 'export.runtime.ts')
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

const { moduleUrl: layoutContractModuleUrl } = await loadRuntimeLayoutContractModule()
const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
const exportUtilsModule = await loadRuntimeExportUtilsModule(
  layoutContractModuleUrl,
  singleColumnLayoutModuleUrl
)

const html = exportUtilsModule.buildExamPaperPrintHtml({
  ...regressionExamPaper,
  viewMode: 'answer-only',
  columnLayout: 'double',
})

const { chromium } = await import('playwright')
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(250)
  const data = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.preview-page')]
    return pages.map((pageEl, pageIndex) => {
      const columns = [...pageEl.querySelectorAll('.two-column-column')].map((columnEl, columnIndex) => {
        const columnRect = columnEl.getBoundingClientRect()
        const sections = [...columnEl.querySelectorAll('[data-section-id]')].map((el) => {
          const rect = el.getBoundingClientRect()
          return {
            id: el.getAttribute('data-section-id'),
            bottomRemainingPx: Number((columnRect.bottom - rect.bottom).toFixed(2)),
          }
        })
        return {
          column: columnIndex + 1,
          sectionCount: sections.length,
          bottomRemainingPx: sections.length
            ? sections.at(-1).bottomRemainingPx
            : Number(columnRect.height.toFixed(2)),
          ids: sections.map((section) => section.id),
        }
      })
      return {
        page: pageIndex + 1,
        columns,
      }
    })
  })
  console.log(JSON.stringify(data, null, 2))
} finally {
  await browser.close()
}
