import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const pdfSource = readFileSync(
  new URL('../src/lib/exam-paper-pdf.ts', import.meta.url),
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

test('exam paper PDF util uses the generated Pretendard TTF VFS bundle', () => {
  assert.match(pdfSource, /exam-paper-pdf-vfs/)
  assert.match(pdfSource, /Pretendard-Regular\.ttf/)
  assert.match(pdfSource, /Pretendard-Bold\.ttf/)
  assert.match(pdfSource, /createPdf\(docDefinition\)\.getBlob/)
  assert.match(pdfSource, /window\.open\(blobUrl, '_blank'\)/)
})

test('library exam-paper export now opens the browser-native PDF viewer flow', () => {
  assert.match(libraryExportButtonsSource, /openExamPaperPdfInNewTab/)
  assert.doesNotMatch(libraryExportButtonsSource, /exportToPDF/)
})

test('dashboard exam-paper export now opens the browser-native PDF viewer flow', () => {
  assert.match(dashboardExportButtonsSource, /openExamPaperPdfInNewTab/)
  assert.doesNotMatch(dashboardExportButtonsSource, /exportToPDF/)
})
