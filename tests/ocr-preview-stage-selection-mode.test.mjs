import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const previewStageSource = readFileSync(
  new URL('../src/components/features/passages/ocr-preview-stage.tsx', import.meta.url),
  'utf8'
)

test('visual selection extraction uses crop helpers instead of only full-page dimming', () => {
  assert.match(previewStageSource, /buildSelectionCropBlobs/)
  assert.match(previewStageSource, /buildOrderedCropRects/)
  assert.ok(previewStageSource.includes("querySelector('.react-pdf__Page__canvas')"))
})
