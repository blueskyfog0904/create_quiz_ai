import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeOcrPassageText,
  normalizeVisualCropPassages,
} from '../src/lib/ocr/response-normalization.ts'

test('normalizeOcrPassageText preserves common blank markers as underscores', () => {
  assert.equal(normalizeOcrPassageText('which [blank] than before'), 'which _____ than before')
  assert.equal(normalizeOcrPassageText('which (blank) than before'), 'which _____ than before')
  assert.equal(normalizeOcrPassageText('which ____ than before'), 'which _____ than before')
})

test('normalizeVisualCropPassages joins multiple OCR fragments from one crop into one passage', () => {
  assert.deepEqual(
    normalizeVisualCropPassages([
      'After finishing my shopping, I walked out of the grocery store',
      'and headed to the spot where I’d parked my car.',
    ]),
    [
      'After finishing my shopping, I walked out of the grocery store\n\nand headed to the spot where I’d parked my car.',
    ]
  )
})

test('normalizeVisualCropPassages removes empty fragments', () => {
  assert.deepEqual(
    normalizeVisualCropPassages(['', '  ', 'Only one passage']),
    ['Only one passage']
  )
})
