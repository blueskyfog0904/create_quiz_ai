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
