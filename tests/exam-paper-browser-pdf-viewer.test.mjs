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

const workspaceSource = readFileSync(
  new URL('../src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx', import.meta.url),
  'utf8'
)

test('exam paper PDF util uses the generated Pretendard TTF VFS bundle', () => {
  assert.match(pdfSource, /exam-paper-pdf-vfs/)
  assert.match(pdfSource, /Pretendard-Regular\.ttf/)
  assert.match(pdfSource, /Pretendard-Bold\.ttf/)
  assert.match(pdfSource, /createPdf\(docDefinition\)\.getBlob/)
  assert.match(pdfSource, /window\.open\(blobUrl, '_blank'\)/)
  assert.match(pdfSource, /columnLayout === 'double'/)
  assert.match(pdfSource, /columns:\s*\[/)
  assert.match(pdfSource, /splitQuestionNodesForDoubleColumn/)
  assert.match(pdfSource, /\{\s*stack: leftColumn\s*\}/)
  assert.match(pdfSource, /\{\s*stack: rightColumn\s*\}/)
  assert.match(pdfSource, /keepQuestionTogether = columnLayout === 'single'/)
  assert.match(pdfSource, /unbreakable: keepQuestionTogether/)
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
})
