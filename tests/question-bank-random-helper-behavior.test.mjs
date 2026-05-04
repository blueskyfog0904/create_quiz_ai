import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  MAX_RANDOM_EXAM_QUESTION_COUNT,
  getMaxCountForProblemType,
  normalizeAvailabilityRows,
  normalizeTypeCountPayload,
  validateRandomExamRequest,
} from '../src/lib/question-bank/random-exam.ts'

const typesSource = readFileSync(
  new URL('../src/lib/question-bank/types.ts', import.meta.url),
  'utf8'
)

function readInterfaceBody(name) {
  const match = typesSource.match(new RegExp(String.raw`export interface ${name} \{([\s\S]*?)\n\}`))
  return match?.[1] ?? ''
}

const grammarTypeId = '11111111-1111-4111-8111-111111111111'
const vocabTypeId = '22222222-2222-4222-8222-222222222222'

test('normalizes type count payload from object and array forms', () => {
  assert.deepEqual(
    normalizeTypeCountPayload({
      [grammarTypeId]: '2',
      [vocabTypeId]: 3,
      '': 4,
    }),
    [
      { problemTypeId: grammarTypeId, count: 2 },
      { problemTypeId: vocabTypeId, count: 3 },
    ]
  )

  assert.deepEqual(
    normalizeTypeCountPayload([
      { problem_type_id: grammarTypeId, count: '4' },
      { problemTypeId: vocabTypeId, count: 5 },
    ]),
    [
      { problemTypeId: grammarTypeId, count: 4 },
      { problemTypeId: vocabTypeId, count: 5 },
    ]
  )
})

test('rejects non-positive requested counts', () => {
  const result = validateRandomExamRequest({
    title: 'Random exam',
    typeCounts: [{ problemTypeId: grammarTypeId, count: 0 }],
    availability: [{ problemTypeId: grammarTypeId, availableCount: 10 }],
  })

  assert.equal(result.isValid, false)
  assert.deepEqual(result.errors, [
    {
      code: 'invalid_count',
      field: 'typeCounts',
      problemTypeId: grammarTypeId,
      message: '문항 수는 1 이상의 정수여야 합니다.',
    },
  ])
})

test('rejects duplicate problem type ids', () => {
  const result = validateRandomExamRequest({
    title: 'Random exam',
    typeCounts: [
      { problemTypeId: grammarTypeId, count: 1 },
      { problemTypeId: grammarTypeId, count: 2 },
    ],
    availability: [{ problemTypeId: grammarTypeId, availableCount: 10 }],
  })

  assert.equal(result.isValid, false)
  assert.equal(result.errors[0].code, 'duplicate_problem_type')
  assert.equal(result.errors[0].problemTypeId, grammarTypeId)
})

test('rejects total count over the random exam cap', () => {
  const result = validateRandomExamRequest({
    title: 'Random exam',
    typeCounts: [
      { problemTypeId: grammarTypeId, count: 60 },
      { problemTypeId: vocabTypeId, count: 41 },
    ],
    availability: [
      { problemTypeId: grammarTypeId, availableCount: 100 },
      { problemTypeId: vocabTypeId, availableCount: 100 },
    ],
  })

  assert.equal(MAX_RANDOM_EXAM_QUESTION_COUNT, 100)
  assert.equal(result.isValid, false)
  assert.ok(result.errors.some((error) => error.code === 'total_over_limit'))
})

test('returns a problem-type-specific error when availability is lower than requested', () => {
  const result = validateRandomExamRequest({
    title: 'Random exam',
    typeCounts: [{ problemTypeId: grammarTypeId, count: 6 }],
    availability: [{ problemTypeId: grammarTypeId, availableCount: 5 }],
  })

  assert.equal(result.isValid, false)
  assert.deepEqual(result.errors, [
    {
      code: 'insufficient_availability',
      field: 'typeCounts',
      problemTypeId: grammarTypeId,
      message: '요청 문항 수가 사용 가능한 문항 수(5)를 초과했습니다.',
    },
  ])
})

test('UI max count equals normalized availability', () => {
  const availability = normalizeAvailabilityRows([
    { problem_type_id: grammarTypeId, available_count: '7' },
    { problemTypeId: vocabTypeId, availableCount: 3 },
  ])

  assert.deepEqual(availability, [
    { problemTypeId: grammarTypeId, availableCount: 7 },
    { problemTypeId: vocabTypeId, availableCount: 3 },
  ])
  assert.equal(getMaxCountForProblemType(availability, grammarTypeId), 7)
  assert.equal(getMaxCountForProblemType(availability, '33333333-3333-4333-8333-333333333333'), 0)
})

test('question bank year and book types expose Task 1 DB/API fields', () => {
  const yearBody = readInterfaceBody('QuestionBankYear')
  const bookBody = readInterfaceBody('QuestionBankBook')

  for (const field of ['id', 'year', 'label', 'sort', 'isActive']) {
    assert.match(yearBody, new RegExp(String.raw`\b${field}\b`))
  }

  for (const field of ['id', 'name', 'slug', 'description', 'sort', 'isActive']) {
    assert.match(bookBody, new RegExp(String.raw`\b${field}\b`))
  }
})
