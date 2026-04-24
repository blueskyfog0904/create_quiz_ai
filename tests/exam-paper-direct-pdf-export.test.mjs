import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const workspaceSource = readFileSync(
  new URL('../src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx', import.meta.url),
  'utf8'
)

const htmlPdfSource = readFileSync(
  new URL('../src/lib/exam-paper-html-pdf.ts', import.meta.url),
  'utf8'
)

test('ExamPaperPdfWorkspace saves and opens the finalized preview HTML through the HTML PDF route', () => {
  assert.match(workspaceSource, /from '@\/lib\/exam-paper-html-pdf'/)
  assert.match(workspaceSource, /downloadExamPaperHtmlPdf/)
  assert.match(workspaceSource, /openExamPaperHtmlPdfInNewTab/)
  assert.match(workspaceSource, /assertReadyPreviewHtml/)
  assert.doesNotMatch(workspaceSource, /buildExamPaperPdfBlob\(exportPayload\)/)
  assert.doesNotMatch(workspaceSource, /openExamPaperPdfInNewTab\(exportPayload\)/)

  assert.match(
    workspaceSource,
    /const handleSavePdf = async \(\) => \{[\s\S]*?const html = assertReadyPreviewHtml\(\)[\s\S]*?downloadExamPaperHtmlPdf\(\{ html, fileName: `\$\{previewTitle\}\.pdf` \}\)/
  )
  assert.match(
    workspaceSource,
    /const handlePrint = \(\) => \{[\s\S]*?const html = assertReadyPreviewHtml\(\)[\s\S]*?printWindow\.document\.write/
  )
  assert.match(workspaceSource, /window\.open\('', '_blank'\)/)
  assert.doesNotMatch(workspaceSource, /window\.open\('', '_blank', 'noopener,noreferrer'\)/)
  assert.match(
    workspaceSource,
    /<Button[\s\S]*?onClick=\{handleSavePdf\}[\s\S]*?>[\s\S]*?PDF 저장[\s\S]*?<\/Button>/
  )
})

test('HTML PDF helper posts preview HTML to the print-pdf route', () => {
  assert.match(htmlPdfSource, /fetch\('\/api\/exam-papers\/print-pdf'/)
  assert.match(htmlPdfSource, /JSON\.stringify\(\{ html, fileName, disposition \}\)/)
  assert.match(htmlPdfSource, /saveAs\(blob, fileName\)/)
  assert.match(htmlPdfSource, /const openedWindow = window\.open/)
  assert.match(htmlPdfSource, /팝업이 차단되어 PDF 새 탭을 열 수 없습니다/)
})
