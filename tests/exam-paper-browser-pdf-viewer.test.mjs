import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const pdfSource = readFileSync(
  new URL('../src/lib/exam-paper-pdf.ts', import.meta.url),
  'utf8'
)

const exportUtilsSource = readFileSync(
  new URL('../src/lib/export-utils.ts', import.meta.url),
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
  assert.match(pdfSource, /paginateTwoColumnQuestionChunks/)
  assert.match(pdfSource, /buildQuestionChunksForTwoColumn/)
  assert.match(pdfSource, /firstPageSlotCapacity/)
  assert.match(pdfSource, /pageBreak: 'after'/)
  assert.match(pdfSource, /splitTextIntoFlowChunks/)
  assert.match(pdfSource, /otherPageSlotCapacity:\s*280/)
})

test('legacy print template builder is extracted for shared preview and print output', () => {
  assert.match(exportUtilsSource, /export function buildExamPaperPrintHtml/)
  assert.match(exportUtilsSource, /export function openExamPaperPrintPreview/)
  assert.match(exportUtilsSource, /autoPrint = false/)
  assert.match(exportUtilsSource, /closeAfterPrint = false/)
  assert.match(exportUtilsSource, /paginateExamPaperQuestions/)
  assert.match(exportUtilsSource, /preview-page/)
  assert.match(exportUtilsSource, /renderTwoColumnHtmlPages/)
  assert.match(exportUtilsSource, /paginateTwoColumnQuestionChunks/)
  assert.match(exportUtilsSource, /two-column-layout/)
  assert.match(exportUtilsSource, /two-column-column/)
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
  assert.match(workspaceSource, /srcDoc=\{previewHtml\}/)
  assert.match(workspaceSource, /buildExamPaperPrintHtml/)
})

test('PDF workspace reseeds the preview state from the latest web question order whenever it opens', () => {
  assert.match(
    workspaceSource,
    /const syncWorkspaceToLatestProps = useCallback\(\(\) => \{\s*setViewMode\(initialViewMode\)\s*setColumnLayout\(initialColumnLayout\)\s*setQuestions\(renumberQuestions\(initialQuestions\)\)\s*setDraggingQuestionId\(null\)/s
  )
  assert.match(
    workspaceSource,
    /useEffect\(\(\) => \{\s*if \(!open\) \{\s*return\s*\}\s*syncWorkspaceToLatestProps\(\)/s
  )
})
