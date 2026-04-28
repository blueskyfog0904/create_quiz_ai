import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const exportUtilsSource = readFileSync(
  new URL('../src/lib/export-utils.ts', import.meta.url),
  'utf8'
)

test('PDF preview page title does not append view mode or layout labels', () => {
  assert.doesNotMatch(
    exportUtilsSource,
    /<h1[^>]*>\$\{escapeHtml\([^)]*title\s*\+[^)]*(?:titleSuffix|layoutSuffix)/,
    'visible PDF page h1 should render only the exam-paper title'
  )

  assert.doesNotMatch(
    exportUtilsSource,
    /<h1[^>]*>\$\{escapeHtml\([^)]*(?:titleSuffix|layoutSuffix)[^)]*\)\}[\s\S]*?<\/h1>/,
    'visible PDF page h1 should not include 표시모드/레이아웃 suffix text'
  )
})
