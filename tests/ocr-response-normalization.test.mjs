import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeChoiceMarkers,
  normalizeOcrPassageText,
  normalizeVisualCropPassages,
} from '../src/lib/ocr/response-normalization.ts'

test('normalizeChoiceMarkers converts circled numbers to parenthesized digits', () => {
  assert.equal(
    normalizeChoiceMarkers('① held ten times more iron\n② had significantly less iron'),
    '(1) held ten times more iron\n(2) had significantly less iron'
  )
})

test('normalizeChoiceMarkers converts plain numbered choices to parenthesized digits', () => {
  assert.equal(
    normalizeChoiceMarkers('1. first choice\n2) second choice'),
    '(1) first choice\n(2) second choice'
  )
})

test('normalizeChoiceMarkers does not rewrite ordinary numbers inside sentences', () => {
  assert.equal(
    normalizeChoiceMarkers('In 1890, 100 grams of spinach contained 35 milligrams of iron.'),
    'In 1890, 100 grams of spinach contained 35 milligrams of iron.'
  )
})

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
