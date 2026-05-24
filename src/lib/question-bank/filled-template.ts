import * as XLSX from 'xlsx'
import { HWPX_UPLOAD_LIMITS } from './hwpx-upload-types'

export const QUESTION_UPLOAD_TEMPLATE_HEADERS = [
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
] as const

export const FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS = [
  'yearId',
  'bookId',
  ...QUESTION_UPLOAD_TEMPLATE_HEADERS,
] as const

type QuestionRowInput = Record<string, unknown>

function text(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value === null || value === undefined) {
    return ''
  }

  return String(value)
}

function choiceValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.map((choice) => text(choice)).filter(Boolean)
}

export function validateFilledTemplateQuestions(questions: QuestionRowInput[]) {
  if (questions.length === 0) {
    throw new Error('다운로드할 문제가 없습니다.')
  }

  if (questions.length > HWPX_UPLOAD_LIMITS.maxQuestions) {
    throw new Error('문항 수는 120개 이하만 지원합니다.')
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(questions), 'utf8')

  if (payloadSize > HWPX_UPLOAD_LIMITS.maxFilledTemplatePayloadChars) {
    throw new Error('템플릿 데이터가 너무 큽니다.')
  }
}

export function buildFilledTemplateRows(questions: QuestionRowInput[]) {
  validateFilledTemplateQuestions(questions)

  return questions.map((question) => {
    const choices = choiceValues(question.choices)

    return {
      yearId: text(question.yearId),
      bookId: text(question.bookId),
      year: text(question.year),
      교재명: text(question.bookName),
      bankProblemTypeId: text(question.bankProblemTypeId || question.problem_type_id),
      문제유형: text(question.problem_type_name),
      지문: text(question.passage_text),
      지문앞텍스트: text(question.question_text_forward),
      문제내용: text(question.question_text),
      지문뒤텍스트: text(question.question_text_backward),
      option: JSON.stringify(choices),
      선택지1: choices[0] || '',
      선택지2: choices[1] || '',
      선택지3: choices[2] || '',
      선택지4: choices[3] || '',
      선택지5: choices[4] || '',
      정답: text(question.answer),
      해설: text(question.explanation),
      학년: text(question.grade_level),
      난이도: text(question.difficulty),
      출처종류: text(question.source_type),
      출처1: text(question.source_1),
      출처2: text(question.source_2),
      출처3: text(question.source_3),
      출처4: text(question.source_4),
    }
  })
}

export function buildFilledTemplateWorkbook(questions: QuestionRowInput[]) {
  const workbook = XLSX.utils.book_new()
  const rows = buildFilledTemplateRows(questions)
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS] })

  sheet['!cols'] = FILLED_QUESTION_UPLOAD_TEMPLATE_HEADERS.map((header) => ({
    wch: ['지문', 'option', '해설'].includes(header) ? 50 : 20,
  }))
  XLSX.utils.book_append_sheet(workbook, sheet, '문제입력')

  return workbook
}
