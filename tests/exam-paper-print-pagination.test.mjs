import assert from 'node:assert/strict'
import test from 'node:test'

import { paginateExamPaperQuestions } from '../src/lib/exam-paper-print-pagination.js'

const makeQuestion = (number, weightHint = 40) => ({
  number,
  questionText: 'Q'.repeat(weightHint),
  questionTextForward: null,
  questionTextBackward: null,
  passageText: 'P'.repeat(weightHint * 4),
  choices: Array.from({ length: 5 }, (_, index) => ({
    label: `${index + 1})`,
    text: 'C'.repeat(weightHint),
  })),
  answer: '1',
  explanation: 'E'.repeat(weightHint * 2),
})

test('double-column pagination treats a page as two columns worth of capacity', () => {
  const pages = paginateExamPaperQuestions({
    questions: [
      makeQuestion(1, 18),
      makeQuestion(2, 18),
      makeQuestion(3, 18),
    ],
    showQuestions: true,
    showAnswers: true,
    isDoubleColumn: true,
    hasDescription: true,
  })

  assert.deepEqual(
    pages.map((page) => page.map((question) => question.number)),
    [[1, 2], [3]]
  )
})

test('double-column pagination keeps two realistic heavier questions on the first page', () => {
  const pages = paginateExamPaperQuestions({
    questions: [
      makeQuestion(1, 54),
      makeQuestion(2, 54),
      makeQuestion(3, 54),
    ],
    showQuestions: true,
    showAnswers: true,
    isDoubleColumn: true,
    hasDescription: true,
  })

  assert.deepEqual(
    pages.map((page) => page.map((question) => question.number)),
    [[1, 2], [3]]
  )
})
