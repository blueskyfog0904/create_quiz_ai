import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const exportUtilsSource = readFileSync(
  new URL('../src/lib/export-utils.ts', import.meta.url),
  'utf8'
)

const buildExamPaperPrintHtmlSource = exportUtilsSource.match(
  /export function buildExamPaperPrintHtml\([\s\S]*?\n}\n\nexport function openExamPaperPrintPreview/
)?.[0] ?? ''

test('buildExamPaperPrintHtml keeps 2-column preview on the shared question markup path', () => {
  assert.notEqual(buildExamPaperPrintHtmlSource, '')
  assert.match(buildExamPaperPrintHtmlSource, /pages\.map\(\(pageQuestions, pageIndex\) =>/)
  assert.match(buildExamPaperPrintHtmlSource, /pageQuestions\.map\(\(question\) =>/)
  assert.doesNotMatch(
    buildExamPaperPrintHtmlSource,
    /isDoubleColumn\s*\?\s*renderTwoColumnHtmlPages\(/s
  )
})
