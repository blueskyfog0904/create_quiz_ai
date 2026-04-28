import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { regressionExamPaper } from './tests/fixtures/exam-paper-two-column-regression.fixture.mjs'

const exportUtilsSource = readFileSync(new URL('./src/lib/export-utils.ts', import.meta.url), 'utf8')
const layoutContractSource = readFileSync(new URL('./src/lib/exam-paper-layout-contract.ts', import.meta.url), 'utf8')
const singleColumnLayoutSource = readFileSync(new URL('./src/lib/exam-paper-single-column-layout.ts', import.meta.url), 'utf8')
const paginationModuleUrl = new URL('./src/lib/exam-paper-pdf-pagination.js', import.meta.url).href
const printPaginationModuleUrl = new URL('./src/lib/exam-paper-print-pagination.js', import.meta.url).href
const normalizeQuestionFieldModuleUrl = new URL('./src/lib/questions/normalize-question-field.ts', import.meta.url).href

async function loadRuntimeLayoutContractModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'dbg-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = layoutContractSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)
  writeFileSync(tempModulePath, runtimeSource)
  const moduleUrl = `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
  return { moduleUrl, module: await import(moduleUrl) }
}

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'dbg-single-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)
  writeFileSync(tempModulePath, runtimeSource)
  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtilsModule(layoutContractModuleUrl, singleColumnLayoutModuleUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), 'dbg-export-'))
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
    .replace(/from '@\/lib\/exam-paper-single-column-layout'/g, `from '${singleColumnLayoutModuleUrl}'`)
    .replace(/from '@\/lib\/questions\/normalize-question-field'/g, `from '${normalizeQuestionFieldModuleUrl}'`)
  writeFileSync(tempModulePath, runtimeSource)
  return import(`${pathToFileURL(tempModulePath).href}?t=${Date.now()}`)
}

const examPaper = {
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

const { moduleUrl } = await loadRuntimeLayoutContractModule()
const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
const exportUtilsModule = await loadRuntimeExportUtilsModule(moduleUrl, singleColumnLayoutModuleUrl)
const html = exportUtilsModule.buildExamPaperPrintHtml(examPaper)

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.setContent(html, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(250)

const data = await page.evaluate(() => {
  const pages = [...document.querySelectorAll('.preview-page')]
  return pages.map((pageEl, pageIndex) => {
    const pageRect = pageEl.getBoundingClientRect()
    const columns = [...pageEl.querySelectorAll('.two-column-column')].map((colEl, colIndex) => {
      const colRect = colEl.getBoundingClientRect()
      const sections = [...colEl.querySelectorAll('[data-section-id]')].map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          id: el.getAttribute('data-section-id'),
          top: Number((rect.top - colRect.top).toFixed(2)),
          bottom: Number((rect.bottom - colRect.top).toFixed(2)),
          height: Number(rect.height.toFixed(2)),
          pageBottom: Number((rect.bottom - pageRect.top).toFixed(2)),
        }
      })
      const maxBottom = sections.length ? Math.max(...sections.map((s) => s.bottom)) : 0
      return {
        column: colIndex + 1,
        sectionCount: sections.length,
        lastId: sections.at(-1)?.id ?? null,
        bottomRemainingPx: Number((colRect.height - maxBottom).toFixed(2)),
        sections,
      }
    })
    const maxPageBottom = Math.max(...columns.flatMap((column) => column.sections.map((section) => section.pageBottom)))
    return {
      page: pageIndex + 1,
      bottomRemainingPx: Number((pageRect.height - maxPageBottom).toFixed(2)),
      columns,
    }
  })
})

console.log(JSON.stringify(data, null, 2))
await browser.close()
