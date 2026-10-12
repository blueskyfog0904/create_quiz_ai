import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const samplePreviewDialog = readFileSync(
  new URL('../src/components/market/market-sample-preview-dialog.tsx', import.meta.url),
  'utf8'
)

test('market listboard sample dialog restores focus to the exact external trigger', () => {
  assert.match(samplePreviewDialog, /StudioDialogContent/)
  assert.doesNotMatch(samplePreviewDialog, /<DialogContent\b/)
  assert.match(samplePreviewDialog, /returnFocusRef\?:\s*RefObject<HTMLButtonElement\s*\|\s*null>/)
  assert.match(samplePreviewDialog, /if\s*\(!returnFocusRef\?\.current\)\s*return/)
  assert.match(samplePreviewDialog, /event\.preventDefault\(\)/)
  assert.match(samplePreviewDialog, /returnFocusRef\.current\.focus\(\)/)
  assert.match(samplePreviewDialog, /onCloseAutoFocus=\{handleCloseAutoFocus\}/)
  assert.match(samplePreviewDialog, /<DialogFooter\b/)
  assert.match(samplePreviewDialog, /variant="brandOutline"[^>]*className="min-h-11 min-w-11"/)
  assert.doesNotMatch(samplePreviewDialog, /<DialogHeader\b[^>]*\bpr-(?:12|16)\b/)
})
