import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const examPaperPdfSource = readFileSync(
  new URL('../src/lib/exam-paper-pdf.ts', import.meta.url),
  'utf8'
)

const buildBoxedTextChunksSource = examPaperPdfSource.match(
  /function buildBoxedTextChunks\([\s\S]*?\n}\n/
)?.[0] ?? ''

const buildChoiceChunksSource = examPaperPdfSource.match(
/function buildChoiceChunks\([\s\S]*?\n}\n/
)?.[0] ?? ''

const buildDecoratedBoxNodeSource = examPaperPdfSource.match(
/function buildDecoratedBoxNode\([\s\S]*?\n}\n/
)?.[0] ?? ''

const buildExplanationChunksSource = examPaperPdfSource.match(
/function buildExplanationChunks\([\s\S]*?\n}\n/
)?.[0] ?? ''

const buildQuestionChunksForTwoColumnSource = examPaperPdfSource.match(
/function buildQuestionChunksForTwoColumn\([\s\S]*?\n}\n/
)?.[0] ?? ''

test('saved PDF boxed passage chunks use bordered container nodes instead of plain text styles', () => {
  assert.notEqual(buildBoxedTextChunksSource, '')
  assert.notEqual(buildDecoratedBoxNodeSource, '')
  assert.match(buildBoxedTextChunksSource, /buildDecoratedBoxNode\(/)
  assert.match(buildDecoratedBoxNodeSource, /table:\s*\{/) 
  assert.match(buildDecoratedBoxNodeSource, /layout:\s*createBoxLayout\(/) 
})

test('saved PDF choice rendering does not apply legacy left indentation', () => {
  assert.notEqual(buildChoiceChunksSource, '')
  assert.doesNotMatch(buildChoiceChunksSource, /margin:\s*\[14,\s*0,\s*0,\s*6\]/)
  assert.doesNotMatch(examPaperPdfSource, /margin:\s*\[14,\s*0,\s*0,\s*10\]/)
})

test('saved PDF answer and explanation rendering includes decorated answer box styling', () => {
  assert.notEqual(buildExplanationChunksSource, '')
  assert.match(examPaperPdfSource, /fillColor:\s*'#f0f9ff'/)
  assert.match(examPaperPdfSource, /vLineWidth:\s*\(/)
})

test('saved PDF 2-column passage path does not route passageText through split boxed chunks', () => {
  assert.notEqual(buildQuestionChunksForTwoColumnSource, '')
  assert.doesNotMatch(
    buildQuestionChunksForTwoColumnSource,
    /buildBoxedTextChunks\(\s*question\.number,\s*'passage',\s*question\.passageText\s*\)/
  )
})

test('saved PDF 2-column path keeps stable anchor/body/choice/answer structure before density tweaks', () => {
  assert.notEqual(buildQuestionChunksForTwoColumnSource, '')
  assert.notEqual(buildChoiceChunksSource, '')
  assert.notEqual(buildExplanationChunksSource, '')

  assert.match(buildQuestionChunksForTwoColumnSource, /const bodyChunks = \[/)
  assert.match(buildQuestionChunksForTwoColumnSource, /\.\.\.buildBoxedTextChunks\(question\.number, 'forward', question\.questionTextForward\)/)
  assert.match(buildQuestionChunksForTwoColumnSource, /id: `question-body-\$\{question\.number\}-passage`/)
  assert.match(buildQuestionChunksForTwoColumnSource, /kind: 'body' as const/)
  assert.match(buildQuestionChunksForTwoColumnSource, /text: buildInlineSegments\(question\.passageText\.trim\(\)\)/)
  assert.match(buildQuestionChunksForTwoColumnSource, /\.\.\.buildBoxedTextChunks\([\s\S]*?question\.number,[\s\S]*?'backward'/)
  assert.match(buildQuestionChunksForTwoColumnSource, /\.\.\.buildChoiceChunks\(question\)/)
  assert.match(buildQuestionChunksForTwoColumnSource, /const \[firstBodyChunk, \.\.\.remainingBodyChunks\] = bodyChunks/)
  assert.match(buildQuestionChunksForTwoColumnSource, /const anchorStack = firstBodyChunk[\s\S]*?\[headingNode, firstBodyChunk\.node\][\s\S]*?: \[headingNode\]/)
  assert.match(buildQuestionChunksForTwoColumnSource, /id: `question-body-\$\{question\.number\}-anchor`/)
  assert.match(buildQuestionChunksForTwoColumnSource, /kind: 'header'/)
  assert.match(buildQuestionChunksForTwoColumnSource, /chunks\.push\(\.\.\.remainingBodyChunks\)/)
  assert.match(buildQuestionChunksForTwoColumnSource, /if \(showAnswers\) \{[\s\S]*?buildExplanationChunks\(question\.number, question\.answer, question\.explanation\)/)

  assert.match(buildExplanationChunksSource, /return \[\{[\s\S]*?id: `question-answer-\$\{questionNumber\}`,[\s\S]*?kind: 'answer' as const,[\s\S]*?node: buildAnswerSectionNode\(stack, 10\)/)
  assert.doesNotMatch(buildExplanationChunksSource, /splitTextIntoFlowChunks\(explanation,\s*260\)\.map\(/)
  assert.doesNotMatch(buildExplanationChunksSource, /question-explanation-\$\{questionNumber\}-\$\{index\}/)

  assert.match(buildChoiceChunksSource, /margin: \[0, 0, 0, 6\]/)
  assert.doesNotMatch(buildChoiceChunksSource, /margin: \[14,\s*0,\s*0,\s*6\]/)
})

test('saved PDF explanation rendering keeps a single answer panel per question', () => {
  assert.notEqual(buildExplanationChunksSource, '')
  assert.doesNotMatch(buildExplanationChunksSource, /splitTextIntoFlowChunks\(explanation,\s*260\)\.map\(/)
  assert.doesNotMatch(buildExplanationChunksSource, /question-explanation-\$\{questionNumber\}-\$\{index\}/)
})

test('saved PDF question header styles move closer to preview header density', () => {
  const questionTextStyleBlocks = [...examPaperPdfSource.matchAll(/questionText:\s*\{[\s\S]*?\n\s*\}/g)].map((match) => match[0])

  assert.equal(questionTextStyleBlocks.length, 2)

  questionTextStyleBlocks.forEach((block) => {
    assert.match(block, /fontSize:\s*14/)
    assert.match(block, /margin:\s*\[0,\s*0,\s*0,\s*12\]/)
    assert.doesNotMatch(block, /fontSize:\s*11/)
    assert.doesNotMatch(block, /margin:\s*\[0,\s*0,\s*0,\s*8\]/)
  })
})

test('saved PDF boxed passage and body typography move closer to preview density', () => {
  assert.notEqual(buildBoxedTextChunksSource, '')

  assert.match(buildBoxedTextChunksSource, /fontSize:\s*13/)
  assert.match(buildBoxedTextChunksSource, /lineHeight:\s*1\.8/)
  assert.match(examPaperPdfSource, /fontSize:\s*13,[\s\S]*?lineHeight:\s*1\.8,[\s\S]*?color:\s*'#374151'/)
  assert.doesNotMatch(examPaperPdfSource, /fontSize:\s*10,[\s\S]*?lineHeight:\s*1\.45,[\s\S]*?color:\s*'#374151'/)
})

test('saved PDF choice row typography and spacing move closer to preview density', () => {
  assert.notEqual(buildChoiceChunksSource, '')

  assert.match(buildChoiceChunksSource, /margin:\s*\[0,\s*0,\s*0,\s*8\]/)
  assert.match(buildChoiceChunksSource, /fontSize:\s*13/)
  assert.match(buildChoiceChunksSource, /lineHeight:\s*1\.8/)
  assert.match(
    examPaperPdfSource,
    /stack:\s*question\.choices\.map\(\(choice\) => \(\{[\s\S]*?margin:\s*\[0,\s*0,\s*0,\s*8\],[\s\S]*?fontSize:\s*13,[\s\S]*?lineHeight:\s*1\.8/
  )
})

test('saved PDF page-1 header styles move closer to preview title and description typography', () => {
  const titleStyleBlocks = [...examPaperPdfSource.matchAll(/title:\s*\{[\s\S]*?\n\s*\}/g)].map((match) => match[0])
  const descriptionStyleBlocks = [...examPaperPdfSource.matchAll(/description:\s*\{[\s\S]*?\n\s*\}/g)].map((match) => match[0])

  assert.equal(titleStyleBlocks.length, 2)
  assert.equal(descriptionStyleBlocks.length, 2)

  titleStyleBlocks.forEach((block) => {
    assert.match(block, /fontSize:\s*24/)
    assert.match(block, /margin:\s*\[0,\s*0,\s*0,\s*10\]/)
  })

  descriptionStyleBlocks.forEach((block) => {
    assert.match(block, /fontSize:\s*14/)
    assert.match(block, /margin:\s*\[0,\s*0,\s*0,\s*30\]/)
  })
})
