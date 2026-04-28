import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const workspaceSource = readFileSync(
  new URL('../src/components/features/exam-papers/ExamPaperPdfWorkspace.tsx', import.meta.url),
  'utf8'
)

function extractFunctionBody(source, functionName) {
  const start = source.indexOf(`const ${functionName} =`)
  assert.notEqual(start, -1, `${functionName} should exist`)
  const nextFunction = source.indexOf('\n  const ', start + 1)
  return source.slice(start, nextFunction === -1 ? undefined : nextFunction)
}

test('question order drag state uses stable workspace identity instead of displayed number', () => {
  assert.match(workspaceSource, /type WorkspaceQuestion = ExamPaperPdfQuestion & \{\s*workspaceId: string\s*\}/s)
  assert.match(workspaceSource, /toWorkspaceQuestions\(initialQuestions\)/)
  assert.match(workspaceSource, /renumberWorkspaceQuestions/)
  assert.match(workspaceSource, /useState<WorkspaceQuestion\[\]>/)
  assert.match(workspaceSource, /useState<string \| null>\(null\)/)
  assert.match(workspaceSource, /key=\{question\.workspaceId\}/)
  assert.match(workspaceSource, /setDraggingQuestionId\(question\.workspaceId\)/)
  assert.match(workspaceSource, /item\.workspaceId === draggingQuestionId/)
  assert.doesNotMatch(workspaceSource, /key=\{question\.number\}/)
})

test('drag over computes an insertion boundary without mutating question order', () => {
  assert.match(workspaceSource, /dropInsertionIndex/)
  assert.match(workspaceSource, /resolveInsertionIndexFromPointer/)
  assert.match(workspaceSource, /resolveQuestionMoveIndex/)
  assert.match(workspaceSource, /getBoundingClientRect\(\)/)
  assert.match(workspaceSource, /clientY: event\.clientY/)
  assert.match(workspaceSource, /itemTop: rect\.top/)
  assert.match(workspaceSource, /itemHeight: rect\.height/)
  assert.match(workspaceSource, /itemIndex: index/)

  const dragOverBody = extractFunctionBody(workspaceSource, 'handleQuestionDragOver')
  assert.doesNotMatch(dragOverBody, /setQuestions\(/)
  assert.doesNotMatch(dragOverBody, /moveQuestion\(/)

  assert.match(workspaceSource, /\[columnLayout, examPaper\.description, examPaper\.paper_title, questions, viewMode\]/)
})

test('drag UI renders real insertion zones including the list end and hides no-op indicators', () => {
  assert.match(workspaceSource, /QuestionDropIndicator/)
  assert.match(workspaceSource, /여기에 놓기/)
  assert.match(workspaceSource, /bg-violet-500/)
  assert.match(workspaceSource, /text-white/)
  assert.match(workspaceSource, /isNoopQuestionInsertion\(draggingQuestionIndex, insertionIndex\)/)
  assert.match(workspaceSource, /dropInsertionIndex === questions\.length/)
  assert.match(workspaceSource, /data-drop-zone="question-order-end"/)
  assert.match(workspaceSource, /pointer-events-none/)
})

test('drag state is cleared on drop, drag end, reset, sync, and list exit', () => {
  assert.match(workspaceSource, /clearQuestionDragState/)
  assert.match(workspaceSource, /setDraggingQuestionId\(null\)/)
  assert.match(workspaceSource, /setDropInsertionIndex\(null\)/)
  assert.match(workspaceSource, /handleQuestionDrop/)
  assert.match(workspaceSource, /onDragEnd=\{clearQuestionDragState\}/)
  assert.match(workspaceSource, /handleQuestionOrderListDragLeave/)
  assert.match(workspaceSource, /onDragLeave=\{handleQuestionOrderListDragLeave\}/)
})

test('question order list provides keyboard and screen-reader alternatives', () => {
  assert.match(workspaceSource, /aria-live="polite"/)
  assert.match(workspaceSource, /role="list"/)
  assert.match(workspaceSource, /role="listitem"/)
  assert.match(workspaceSource, /aria-label=\{`\$\{question\.number\}번 문제 순서 이동`\}/)
  assert.match(workspaceSource, /aria-label=\{`\$\{question\.number\}번 문제 위로 이동`\}/)
  assert.match(workspaceSource, /aria-label=\{`\$\{question\.number\}번 문제 아래로 이동`\}/)
  assert.match(workspaceSource, />\s*위로\s*</)
  assert.match(workspaceSource, />\s*아래로\s*</)
})
