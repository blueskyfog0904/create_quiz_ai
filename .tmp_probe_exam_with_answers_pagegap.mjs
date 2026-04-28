import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { regressionExamPaper } from './tests/fixtures/exam-paper-two-column-regression.fixture.mjs'

const exportUtilsSource = readFileSync('./src/lib/export-utils.ts', 'utf8')
const layoutContractSource = readFileSync('./src/lib/exam-paper-layout-contract.ts', 'utf8')
const singleColumnLayoutSource = readFileSync('./src/lib/exam-paper-single-column-layout.ts', 'utf8')
const paginationModuleUrl = pathToFileURL('src/lib/exam-paper-pdf-pagination.js').href
const printPaginationModuleUrl = pathToFileURL('src/lib/exam-paper-print-pagination.js').href
const normalizeQuestionFieldModuleUrl = pathToFileURL('src/lib/questions/normalize-question-field.ts').href

async function loadRuntimeLayoutContractModule(source) {
  const tempDir = mkdtempSync(join(tmpdir(), 'probe-layout-'))
  const tempModulePath = join(tempDir, 'exam-paper-layout-contract.runtime.ts')
  const runtimeSource = source
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)
  writeFileSync(tempModulePath, runtimeSource)
  const moduleUrl = `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
  return { moduleUrl, module: await import(moduleUrl) }
}

async function loadRuntimeSingleColumnLayoutModule() {
  const tempDir = mkdtempSync(join(tmpdir(), 'probe-single-'))
  const tempModulePath = join(tempDir, 'exam-paper-single-column-layout.runtime.ts')
  const runtimeSource = singleColumnLayoutSource
    .replace(/@\/lib\/exam-paper-pdf-pagination\.js/g, paginationModuleUrl)
    .replace(/@\/lib\/questions\/normalize-question-field/g, normalizeQuestionFieldModuleUrl)
  writeFileSync(tempModulePath, runtimeSource)
  return `${pathToFileURL(tempModulePath).href}?t=${Date.now()}`
}

async function loadRuntimeExportUtilsModule(layoutContractModuleUrl, singleColumnLayoutModuleUrl) {
  const tempDir = mkdtempSync(join(tmpdir(), 'probe-export-'))
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

async function pageSlackFor(source, examPaper) {
  const { moduleUrl } = await loadRuntimeLayoutContractModule(source)
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
  const exportUtilsModule = await loadRuntimeExportUtilsModule(moduleUrl, singleColumnLayoutModuleUrl)
  const html = exportUtilsModule.buildExamPaperPrintHtml(examPaper)
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(250)
    return await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.preview-page')]
      return pages.map((pageEl) => {
        const pageRect = pageEl.getBoundingClientRect()
        const sectionNodes = [...pageEl.querySelectorAll('[data-section-id]')].map((el) => {
          const rect = el.getBoundingClientRect()
          return Number((rect.bottom - pageRect.top).toFixed(2))
        })
        const maxBottom = sectionNodes.length ? Math.max(...sectionNodes) : 0
        return Number((pageRect.height - maxBottom).toFixed(2))
      })
    })
  } finally {
    await browser.close()
  }
}

const realistic = {
  title: regressionExamPaper.title,
  description: regressionExamPaper.description,
  viewMode: 'exam-with-answers',
  columnLayout: 'double',
  questions: [
    { ...regressionExamPaper.questions[0], questionTextBackward: null },
    regressionExamPaper.questions[1],
  ],
}

const screenshotLike = {
  title: regressionExamPaper.title,
  description: regressionExamPaper.description,
  viewMode: 'exam-with-answers',
  columnLayout: 'double',
  questions: [
    { ...regressionExamPaper.questions[0], questionTextBackward: null },
    regressionExamPaper.questions[2],
  ],
}

const variants = [
  {
    name: 'current',
    patches: [],
  },
  {
    name: 'tight-body',
    patches: [
      ['const DOUBLE_COLUMN_BODY_FRAGMENT_MIN_LENGTH = 180', 'const DOUBLE_COLUMN_BODY_FRAGMENT_MIN_LENGTH = 150'],
      ['const DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS = 220', 'const DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS = 160'],
    ],
  },
  {
    name: 'tight-atomic-answer',
    patches: [
      ['charsPerLine = 40\n    lineUnit = 16\n    baseUnit = isLeadingFragment ? 28 : 8', 'charsPerLine = 34\n    lineUnit = 16\n    baseUnit = isLeadingFragment ? 28 : 6'],
    ],
  },
  {
    name: 'tight-both',
    patches: [
      ['const DOUBLE_COLUMN_BODY_FRAGMENT_MIN_LENGTH = 180', 'const DOUBLE_COLUMN_BODY_FRAGMENT_MIN_LENGTH = 150'],
      ['const DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS = 220', 'const DOUBLE_COLUMN_BODY_FRAGMENT_MAX_CHARS = 160'],
      ['charsPerLine = 40\n    lineUnit = 16\n    baseUnit = isLeadingFragment ? 28 : 8', 'charsPerLine = 34\n    lineUnit = 16\n    baseUnit = isLeadingFragment ? 28 : 6'],
    ],
  },
]

for (const variant of variants) {
  let source = layoutContractSource
  for (const [from, to] of variant.patches) {
    source = source.replace(from, to)
  }
  const realisticPages = await pageSlackFor(source, realistic)
  const screenshotPages = await pageSlackFor(source, screenshotLike)
  console.log(JSON.stringify({ name: variant.name, realisticPages, screenshotPages }))
}
