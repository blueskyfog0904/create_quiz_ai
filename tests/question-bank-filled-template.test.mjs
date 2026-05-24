import assert from 'node:assert/strict'
import test from 'node:test'
import * as XLSX from 'xlsx'
import '../src/components/features/passages/node-test-register.mjs'



const {
  QUESTION_UPLOAD_TEMPLATE_HEADERS,
  FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS,
  buildFilledTemplateWorkbook,
  buildFilledTemplateRows,
  validateFilledTemplateQuestions,
} = await import('../src/lib/question-bank/filled-template.ts')

const expectedBaseHeaders = [
  'year',
  '교재명',
  'bankProblemTypeId',
  '문제유형',
  '지문',
  '지문앞텍스트',
  '문제내용',
  '지문뒤텍스트',
  'option',
  '선택지1',
  '선택지2',
  '선택지3',
  '선택지4',
  '선택지5',
  '정답',
  '해설',
  '학년',
  '난이도',
  '출처종류',
  '출처1',
  '출처2',
  '출처3',
  '출처4',
]

test('filled template headers are unique and preserve the base upload template order', () => {
  assert.equal(new Set(FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS).size, FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS.length)
  assert.deepEqual(QUESTION_UPLOAD_TEMPLATE_HEADERS, expectedBaseHeaders)
  assert.deepEqual(
    FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS.filter((header) => header !== 'yearId' && header !== 'bookId'),
    QUESTION_UPLOAD_TEMPLATE_HEADERS,
  )
})

test('buildFilledTemplateRows preserves yearId bookId and bankProblemTypeId for re-upload', () => {
  const rows = buildFilledTemplateRows([{ yearId: 'year-1', bookId: 'book-1', bankProblemTypeId: 'type-1', problem_type_name: '빈칸 추론', passage_text: 'p', question_text_forward: 'front', question_text: 'q', question_text_backward: 'back', choices: ['a', 'b'], answer: '1', explanation: 'e' }])

  assert.equal(rows[0].yearId, 'year-1')
  assert.equal(rows[0].bookId, 'book-1')
  assert.equal(rows[0].bankProblemTypeId, 'type-1')
  assert.equal(rows[0].지문앞텍스트, 'front')
  assert.equal(rows[0].지문뒤텍스트, 'back')
})

test('buildFilledTemplateWorkbook round-trips through xlsx sheet_to_json', () => {
  const workbook = buildFilledTemplateWorkbook([{ yearId: 'year-1', bookId: 'book-1', bankProblemTypeId: 'type-1', problem_type_name: '빈칸 추론', passage_text: 'p', question_text: 'q', choices: ['a', 'b'], answer: '1' }])
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
  const parsed = XLSX.read(buffer, { type: 'buffer' })
  const headerRows = XLSX.utils.sheet_to_json(parsed.Sheets.문제입력, { header: 1 })
  const rows = XLSX.utils.sheet_to_json(parsed.Sheets.문제입력)

  assert.deepEqual(headerRows[0], [...FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS])
  assert.equal(rows[0].yearId, 'year-1')
  assert.equal(rows[0].bookId, 'book-1')
  assert.equal(rows[0].bankProblemTypeId, 'type-1')
  assert.equal(rows[0].문제내용, 'q')
})

test('validateFilledTemplateQuestions rejects too many or oversized rows', () => {
  assert.throws(() => validateFilledTemplateQuestions(Array.from({ length: 121 }, () => ({ question_text: 'q' }))), /문항 수는 120개 이하/)
  assert.throws(() => validateFilledTemplateQuestions([{ question_text: 'x'.repeat(1_500_001) }]), /템플릿 데이터가 너무 큽니다/)
})
