import assert from 'node:assert/strict'
import test from 'node:test'

import {
  paginateTwoColumnQuestionChunks,
  splitTextIntoFlowChunks,
} from '../src/lib/exam-paper-pdf-pagination.js'

test('prefers sentence boundaries when splitting long text for column flow', () => {
  const chunks = splitTextIntoFlowChunks(
    'First sentence ends here. Second sentence should stay intact. Third sentence also stays intact.',
    45
  )

  assert.deepEqual(chunks, [
    'First sentence ends here.',
    'Second sentence should stay intact.',
    'Third sentence also stays intact.',
  ])
})

test('continues a long question into the same page right column before the next page left column', () => {
  const pages = paginateTwoColumnQuestionChunks([
    {
      questionNumber: 1,
      chunks: [
        { id: 'q1-header', estimatedHeight: 40, kind: 'header' },
        { id: 'q1-body-1', estimatedHeight: 70, kind: 'body' },
        { id: 'q1-body-2', estimatedHeight: 50, kind: 'body' },
        { id: 'q1-answer', estimatedHeight: 20, kind: 'answer' },
      ],
    },
    {
      questionNumber: 2,
      chunks: [
        { id: 'q2-header', estimatedHeight: 20, kind: 'header' },
      ],
    },
  ], { slotCapacity: 100 })

  assert.equal(pages.length, 2)
  assert.deepEqual(
    pages[0].left.map((chunk) => chunk.id),
    ['q1-header']
  )
  assert.deepEqual(
    pages[0].right.map((chunk) => chunk.id),
    ['q1-body-1']
  )
  assert.deepEqual(
    pages[1].left.map((chunk) => chunk.id),
    ['q1-body-2', 'q1-answer', 'q2-header']
  )
})

test('keeps reading order across columns and pages', () => {
  const pages = paginateTwoColumnQuestionChunks([
    {
      questionNumber: 1,
      chunks: [{ id: 'q1', estimatedHeight: 30, kind: 'header' }],
    },
    {
      questionNumber: 2,
      chunks: [{ id: 'q2', estimatedHeight: 30, kind: 'header' }],
    },
    {
      questionNumber: 3,
      chunks: [{ id: 'q3', estimatedHeight: 30, kind: 'header' }],
    },
    {
      questionNumber: 4,
      chunks: [{ id: 'q4', estimatedHeight: 30, kind: 'header' }],
    },
  ], { slotCapacity: 60 })

  assert.deepEqual(
    pages.map((page) => ({
      left: page.left.map((chunk) => chunk.id),
      right: page.right.map((chunk) => chunk.id),
    })),
    [
      {
        left: ['q1', 'q2'],
        right: ['q3', 'q4'],
      },
    ]
  )
})

test('does not place answer before unfinished body chunks of the same question', () => {
  const pages = paginateTwoColumnQuestionChunks([
    {
      questionNumber: 7,
      chunks: [
        { id: 'q7-header', estimatedHeight: 35, kind: 'header' },
        { id: 'q7-body', estimatedHeight: 80, kind: 'body' },
        { id: 'q7-answer', estimatedHeight: 15, kind: 'answer' },
      ],
    },
  ], { slotCapacity: 90 })

  const orderedChunkIds = pages.flatMap((page) => [
    ...page.left.map((chunk) => chunk.id),
    ...page.right.map((chunk) => chunk.id),
  ])

  assert.deepEqual(orderedChunkIds, ['q7-header', 'q7-body', 'q7-answer'])
})
