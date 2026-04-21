import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const sharedContractPath = new URL('../src/lib/exam-paper-layout-contract.ts', import.meta.url)
const exportUtilsPath = new URL('../src/lib/export-utils.ts', import.meta.url)
const examPaperPdfPath = new URL('../src/lib/exam-paper-pdf.ts', import.meta.url)

const sharedContractExists = existsSync(sharedContractPath)
const sharedContractSource = sharedContractExists
  ? readFileSync(sharedContractPath, 'utf8')
  : ''
const exportUtilsSource = readFileSync(exportUtilsPath, 'utf8')
const examPaperPdfSource = readFileSync(examPaperPdfPath, 'utf8')

const plannerNamePattern = /(buildExamPaperLayoutPlan|planExamPaperLayout|createExamPaperLayoutPlan)/

test('exam paper layout contract module exists', () => {
  assert.equal(
    sharedContractExists,
    true,
    'expected shared layout contract module at src/lib/exam-paper-layout-contract.ts'
  )
})

test('shared layout contract exposes a page-and-column planning surface', () => {
  assert.notEqual(sharedContractSource, '')
  assert.match(
    sharedContractSource,
    /export (type|interface) (ExamPaperLayoutPlan|ExamPaperPagePlan|ExamPaperLayoutContract)/
  )
  assert.match(sharedContractSource, /export (function|const) /)
  assert.match(sharedContractSource, plannerNamePattern)
  assert.match(sharedContractSource, /(sectionId|sectionKey)/)
  assert.match(sharedContractSource, /(pageId|pageIndex)/)
  assert.match(sharedContractSource, /(columnId|columnIndex)/)
})

test('export-utils delegates page and column planning to the shared contract', () => {
  assert.match(
    exportUtilsSource,
    /from ['"]@\/lib\/exam-paper-layout-contract['"]/
  )
  assert.match(exportUtilsSource, plannerNamePattern)
  assert.doesNotMatch(exportUtilsSource, /\bfunction getExamPaperRenderOptions\(/)
})

test('exam-paper-pdf delegates page and column planning to the shared contract', () => {
  assert.match(
    examPaperPdfSource,
    /from ['"]@\/lib\/exam-paper-layout-contract['"]/
  )
  assert.match(examPaperPdfSource, plannerNamePattern)
  assert.doesNotMatch(examPaperPdfSource, /\bfunction getExportOptions\(/)
})
