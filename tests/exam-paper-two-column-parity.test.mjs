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

const twoColumnChunkRendererName =
  exportUtilsSource.match(/function (renderTwoColumn[A-Za-z0-9]*Chunk[A-Za-z0-9]*Html)\(/)?.[1] ?? ''

const twoColumnChunkRendererSource = twoColumnChunkRendererName
  ? exportUtilsSource.match(
      new RegExp(`function ${twoColumnChunkRendererName}\\([\\s\\S]*?\\n}\\n`)
    )?.[0] ?? ''
  : ''

test('buildExamPaperPrintHtml routes 2-column preview through chunk-based question markup', () => {
  assert.notEqual(buildExamPaperPrintHtmlSource, '')
  assert.notEqual(twoColumnChunkRendererName, '')
  assert.notEqual(twoColumnChunkRendererSource, '')
  assert.match(
    buildExamPaperPrintHtmlSource,
    new RegExp(`isDoubleColumn[\\s\\S]*${twoColumnChunkRendererName}\\(`)
  )
  assert.match(twoColumnChunkRendererSource, /class="question-chunk[^\"]*question-chunk-anchor/)
  assert.match(twoColumnChunkRendererSource, /class="question-chunk[^\"]*question-body-chunk/)
  assert.doesNotMatch(twoColumnChunkRendererSource, /class="question"/)
})

test('buildExamPaperPrintHtml reserves chunk-aware pagination for 2-column preview pages', () => {
  assert.notEqual(buildExamPaperPrintHtmlSource, '')
  assert.match(exportUtilsSource, /paginateTwoColumnQuestionChunks/)
  assert.match(
    buildExamPaperPrintHtmlSource,
    /isDoubleColumn[\s\S]*paginateTwoColumnQuestionChunks\(/
  )
  assert.match(buildExamPaperPrintHtmlSource, /class="two-column-layout"/)
  assert.match(buildExamPaperPrintHtmlSource, /class="two-column-column"/)
})
