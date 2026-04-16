import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const previewStageSource = readFileSync(
  new URL('../src/components/features/passages/ocr-preview-stage.tsx', import.meta.url),
  'utf8'
)

test('OCR preview stage renders a progress overlay while extraction is running', () => {
  assert.match(previewStageSource, /OCR 추출 진행 중/)
  assert.match(previewStageSource, /processingProgress/)
  assert.match(previewStageSource, /processingLabel/)
  assert.match(previewStageSource, /창을 닫거나 새로고침하지 마세요/)
})
