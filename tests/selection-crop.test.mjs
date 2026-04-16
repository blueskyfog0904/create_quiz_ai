import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOrderedCropRects,
  selectionToCropRect,
} from '../src/lib/ocr/selection-crop.ts'

test('selectionToCropRect converts visual coordinates into intrinsic coordinates with padding', () => {
  const rect = selectionToCropRect(
    { id: 's1', x: 100, y: 200, width: 300, height: 120 },
    { width: 800, height: 1000 },
    { width: 1600, height: 2000 },
    10
  )

  assert.deepEqual(rect, {
    x: 190,
    y: 390,
    width: 620,
    height: 260,
  })
})

test('selectionToCropRect clamps to image boundaries', () => {
  const rect = selectionToCropRect(
    { id: 's1', x: 1, y: 1, width: 5, height: 4 },
    { width: 100, height: 100 },
    { width: 1000, height: 1000 },
    20
  )

  assert.deepEqual(rect, {
    x: 0,
    y: 0,
    width: 80,
    height: 70,
  })
})

test('buildOrderedCropRects preserves top-to-bottom then left-to-right selection order', () => {
  const rects = buildOrderedCropRects(
    [
      { id: 'c', x: 500, y: 400, width: 100, height: 50 },
      { id: 'a', x: 100, y: 100, width: 100, height: 50 },
      { id: 'b', x: 50, y: 400, width: 100, height: 50 },
    ],
    { width: 800, height: 1000 },
    { width: 1600, height: 2000 },
    0
  )

  assert.deepEqual(rects, [
    { x: 200, y: 200, width: 200, height: 100 },
    { x: 100, y: 800, width: 200, height: 100 },
    { x: 1000, y: 800, width: 200, height: 100 },
  ])
})
