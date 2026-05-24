import type { HwpxAiQuestion } from './hwpx-ai'
import type { HwpxAnalyzedQuestion } from './hwpx-upload-types'

type AiRow = HwpxAiQuestion

type ProblemType = { id: string, type_name: string }

export function buildHwpxPreviewQuestion(input: {
  row: AiRow
  rowIndex: number
  yearId: string
  bookId: string
  problemTypeById: Map<string, ProblemType>
  problemTypeByName: Map<string, ProblemType>
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
}): HwpxAnalyzedQuestion {
  const problemType = input.problemTypeById.get(input.row.bankProblemTypeId)
    || input.problemTypeByName.get(input.row.problem_type_name)
  const warnings = [...input.row.warnings]

  if (!problemType) warnings.push('문제은행 문제유형을 확인해야 합니다.')
  if (!input.row.question_text.trim()) warnings.push('문제내용을 확인해야 합니다.')
  if (!input.row.answer.trim()) warnings.push('정답을 확인해야 합니다.')

  const hasRequiredFields = Boolean(problemType && input.row.question_text.trim() && input.row.answer.trim())
  const conversionStatus = !hasRequiredFields
    ? 'invalid'
    : input.row.conversionStatus === 'valid'
      ? 'valid'
      : 'needs_review'
  const isValid = conversionStatus === 'valid'

  return {
    id: `hwpx-${input.rowIndex + 1}`,
    clientRowId: `hwpx-row-${input.rowIndex + 1}`,
    bankProblemTypeId: problemType?.id,
    problem_type_id: problemType?.id ?? '',
    problem_type_name: problemType?.type_name ?? input.row.problem_type_name,
    passage_text: input.row.passage_text,
    question_text: input.row.question_text,
    question_text_forward: input.row.question_text_forward,
    question_text_backward: input.row.question_text_backward,
    choices: input.row.choices.map((choice) => choice.trim()).filter(Boolean),
    answer: input.row.answer,
    explanation: input.row.explanation,
    grade_level: input.row.grade_level || input.defaultGradeLevel || '',
    difficulty: input.row.difficulty || input.defaultDifficulty || '',
    yearId: input.yearId,
    bookId: input.bookId,
    source_type: input.row.source_type || input.sourceType || '',
    source_1: input.row.source_1,
    source_2: input.row.source_2,
    source_3: input.row.source_3,
    source_4: input.row.source_4,
    conversionStatus,
    confidence: input.row.confidence,
    warnings,
    sourceSnippet: input.row.sourceSnippet,
    isValid,
    errorMessage: isValid ? undefined : conversionStatus === 'needs_review'
      ? 'AI 분석 결과 검수 완료가 필요합니다.'
      : warnings.join(' / ') || '필수 항목을 확인해주세요.',
  }
}
