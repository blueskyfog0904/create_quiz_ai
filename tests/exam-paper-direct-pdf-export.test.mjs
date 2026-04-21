import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const workspaceSource = readFileSync(
  new URL('../src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx', import.meta.url),
  'utf8'
)

const examPaperPdfSource = readFileSync(
  new URL('../src/lib/exam-paper-pdf.ts', import.meta.url),
  'utf8'
)

test('ExamPaperPdfWorkspace separates direct PDF save from browser print preview', () => {
  assert.match(workspaceSource, /from '@\/lib\/exam-paper-pdf'/)
  assert.match(workspaceSource, /buildExamPaperPdfBlob/)
  assert.match(workspaceSource, /buildExamPaperPdfFileName/)
  assert.match(workspaceSource, /downloadExamPaperPdf/)
  assert.doesNotMatch(workspaceSource, /fetch\('\/api\/exam-papers\/print-pdf'/)

  assert.match(
    workspaceSource,
    /const handleSavePdf = async \(\) => \{[\s\S]*?buildExamPaperPdfFileName\(exportPayload\)[\s\S]*?buildExamPaperPdfBlob\(exportPayload\)[\s\S]*?downloadExamPaperPdf\(blob, fileName\)/
  )
  assert.match(
    workspaceSource,
    /<Button[\s\S]*?onClick=\{handleSavePdf\}[\s\S]*?>[\s\S]*?PDF 저장[\s\S]*?<\/Button>/
  )
  assert.match(
    workspaceSource,
    /const handlePrint = \(\) => \{[\s\S]*?openExamPaperPrintPreview\(exportPayload, \{[\s\S]*?autoPrint:\s*true[\s\S]*?closeAfterPrint:\s*true/
  )
  assert.match(
    workspaceSource,
    /<Button[\s\S]*?onClick=\{handlePrint\}[\s\S]*?>[\s\S]*?인쇄[\s\S]*?<\/Button>/
  )
})

test('saved PDF two-column flow stays chunk-aware even without combined question-and-answer mode', () => {
  assert.match(examPaperPdfSource, /buildExamPaperLayoutPlan/)
  assert.match(examPaperPdfSource, /buildQuestionChunksForTwoColumn/)
  assert.match(
    examPaperPdfSource,
    /if \(columnLayout === 'double'\) \{[\s\S]*?buildExamPaperLayoutPlan/
  )
  assert.doesNotMatch(
    examPaperPdfSource,
    /columnLayout === 'double' && showQuestions && showAnswers/
  )
})
