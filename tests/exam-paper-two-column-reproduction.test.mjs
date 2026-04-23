import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { answerOnlyDoubleOverflowFixture } from './fixtures/exam-paper-two-column-answer-only-overflow.fixture.mjs'
import { answerOnlyDoubleUnderfillFixture } from './fixtures/exam-paper-two-column-answer-only-underfill.fixture.mjs'
import { examOnlyDoubleSegmentationFixture } from './fixtures/exam-paper-two-column-exam-only-segmentation.fixture.mjs'

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

async function buildPreviewHtml(examPaper) {
  const {
    moduleUrl: layoutContractModuleUrl,
  } = await loadRuntimeLayoutContractModule()
  const singleColumnLayoutModuleUrl = await loadRuntimeSingleColumnLayoutModule()
  const exportUtilsModule = await loadRuntimeExportUtilsModule(
    layoutContractModuleUrl,
    singleColumnLayoutModuleUrl
  )

  return exportUtilsModule.buildExamPaperPrintHtml(examPaper)
}

async function analyzeDoublePreview(html) {
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

        return {
          page: pageIndex + 1,
          columns,
        }
      }).flatMap((page) => page.columns)
    })
  } finally {
    await browser.close()
  }
}

test('answer-only double preview should not over-fragment a single long explanation', async () => {
  const html = await buildPreviewHtml(answerOnlyDoubleOverflowFixture)
  const columns = await analyzeDoublePreview(html)
  const totalSections = columns.reduce((sum, column) => sum + column.sectionCount, 0)

  assert.equal(
    totalSections <= 8,
    true,
    `expected long explanation to stay within 8 continuation pieces, got ${JSON.stringify(columns, null, 2)}`
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
