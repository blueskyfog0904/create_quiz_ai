import assert from 'node:assert/strict'
import test from 'node:test'
import '../src/components/features/passages/node-test-register.mjs'

import { buildHwpxPreviewQuestion } from '../src/lib/question-bank/hwpx-preview.ts'

const type = { id: '11111111-1111-4111-8111-111111111111', type_name: '빈칸 추론' }
const context = {
  yearId: '22222222-2222-4222-8222-222222222222',
  bookId: '33333333-3333-4333-8333-333333333333',
  problemTypeById: new Map([[type.id, type]]),
  problemTypeByName: new Map([[type.type_name, type]]),
  defaultGradeLevel: '고1',
  defaultDifficulty: '중',
  sourceType: '수능특강',
}

test('buildHwpxPreviewQuestion marks valid AI rows saveable and applies defaults', () => {
  const row = buildHwpxPreviewQuestion({
    row: {
      bankProblemTypeId: type.id,
      problem_type_name: '',
      passage_text: 'passage',
      question_text: 'question',
      question_text_forward: '',
      question_text_backward: '',
      choices: ['① a', '② b'],
      answer: '1',
      explanation: '',
      grade_level: '',
      difficulty: '',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: '',
      conversionStatus: 'valid',
      confidence: 0.9,
      warnings: [],
      sourceSnippet: 'snippet',
    },
    rowIndex: 0,
    ...context,
  })

  assert.equal(row.isValid, true)
  assert.equal(row.conversionStatus, 'valid')
  assert.equal(row.grade_level, '고1')
  assert.equal(row.difficulty, '중')
  assert.equal(row.source_type, '수능특강')
  assert.equal(row.problem_type_id, type.id)
})

test('buildHwpxPreviewQuestion blocks needs_review rows from bulk save until explicit UI approval', () => {
  const row = buildHwpxPreviewQuestion({
    row: {
      bankProblemTypeId: type.id,
      problem_type_name: '',
      passage_text: '',
      question_text: 'question',
      question_text_forward: '',
      question_text_backward: '',
      choices: ['① a', '② b'],
      answer: '1',
      explanation: '',
      grade_level: '고2',
      difficulty: '상',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: '',
      conversionStatus: 'needs_review',
      confidence: 0.55,
      warnings: ['선택지 경계 확인 필요'],
      sourceSnippet: 'snippet',
    },
    rowIndex: 1,
    ...context,
  })

  assert.equal(row.isValid, false)
  assert.equal(row.conversionStatus, 'needs_review')
  assert.match(row.errorMessage, /검수 완료가 필요합니다/)
  assert.deepEqual(row.warnings, ['선택지 경계 확인 필요'])
})

test('buildHwpxPreviewQuestion marks missing problem type invalid', () => {
  const row = buildHwpxPreviewQuestion({
    row: {
      bankProblemTypeId: '',
      problem_type_name: '없는 유형',
      passage_text: '',
      question_text: 'question',
      question_text_forward: '',
      question_text_backward: '',
      choices: [],
      answer: '1',
      explanation: '',
      grade_level: '',
      difficulty: '',
      source_type: '',
      source_1: '',
      source_2: '',
      source_3: '',
      source_4: '',
      conversionStatus: 'valid',
      confidence: 0.7,
      warnings: [],
      sourceSnippet: '',
    },
    rowIndex: 2,
    ...context,
  })

  assert.equal(row.isValid, false)
  assert.equal(row.conversionStatus, 'invalid')
  assert.match(row.errorMessage, /문제은행 문제유형/)
})
