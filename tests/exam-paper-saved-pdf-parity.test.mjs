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

test('saved PDF explanation rendering keeps a single answer panel per question', () => {
  assert.notEqual(buildExplanationChunksSource, '')
  assert.doesNotMatch(buildExplanationChunksSource, /splitTextIntoFlowChunks\(explanation,\s*260\)\.map\(/)
  assert.doesNotMatch(buildExplanationChunksSource, /question-explanation-\$\{questionNumber\}-\$\{index\}/)
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
