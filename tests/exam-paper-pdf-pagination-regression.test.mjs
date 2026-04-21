import assert from 'node:assert/strict'
import test from 'node:test'

import { paginateTwoColumnQuestionChunks } from '../src/lib/exam-paper-pdf-pagination.js'

test('oversized chunks leave later slots visually empty when carried overflow already consumed them', () => {
  const pages = paginateTwoColumnQuestionChunks([
    {
      questionNumber: 1,
      chunks: [
        { id: 'q1-header', kind: 'header', estimatedHeight: 200, node: {} },
        { id: 'q1-body', kind: 'body', estimatedHeight: 900, node: {} },
        { id: 'q1-answer', kind: 'answer', estimatedHeight: 400, node: {} },
      ],
    },
  ], {
    firstPageSlotCapacity: 600,
    otherPageSlotCapacity: 600,
  })

  assert.equal(pages.length, 2)
  assert.deepEqual(pages[0].left.map((chunk) => chunk.id), ['q1-header'])
  assert.deepEqual(pages[0].right.map((chunk) => chunk.id), ['q1-body'])
  assert.equal(
    pages[1].left.length,
    0,
    'page 2 left is intentionally empty because q1-body carries 300 units of overflow into that slot'
  )
  assert.deepEqual(pages[1].right.map((chunk) => chunk.id), ['q1-answer'])
})

test('carried overflow can skip more than one slot before the next chunk is placed', () => {
  const pages = paginateTwoColumnQuestionChunks([
    {
      questionNumber: 1,
      chunks: [
        { id: 'q1-body', kind: 'body', estimatedHeight: 1300, node: {} },
        { id: 'q1-answer', kind: 'answer', estimatedHeight: 450, node: {} },
      ],
    },
  ], {
    slotCapacity: 600,
  })

  assert.equal(pages.length, 2)
  assert.deepEqual(pages[0].left.map((chunk) => chunk.id), ['q1-body'])
  assert.equal(
    pages[0].right.length,
    0,
    'page 1 right stays empty because q1-body already consumed that full slot via carried overflow'
  )
  assert.deepEqual(pages[1].left.map((chunk) => chunk.id), ['q1-answer'])
  assert.deepEqual(pages[1].right.map((chunk) => chunk.id), [])
})
