import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const previewStageSource = readFileSync(
  new URL('../src/components/features/passages/ocr-preview-stage.tsx', import.meta.url),
  'utf8'
)

test('auto mode uses the original PDF file instead of the current page canvas blob', () => {
  assert.match(previewStageSource, /else if \(fileType === 'pdf'\) \{\s*validFiles = \[file\]/s)
  assert.match(previewStageSource, /fileType === 'pdf'\s*\?\s*file\.name/s)
})
