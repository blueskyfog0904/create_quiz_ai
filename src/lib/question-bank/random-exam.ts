import type {
  QuestionBankAvailability,
  RandomExamTypeCount,
  RandomExamValidationResult,
} from './types'

export type {
  QuestionBankYear,
  QuestionBankBook,
  QuestionBankAvailability,
  RandomExamTypeCount,
  RandomExamValidationResult,
} from './types'

export const MAX_RANDOM_EXAM_QUESTION_COUNT = 100

const UUIDISH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type TypeCountRow = {
  problemTypeId?: unknown
  problem_type_id?: unknown
  count?: unknown
}

type AvailabilityRow = {
  problemTypeId?: unknown
  problem_type_id?: unknown
  availableCount?: unknown
  available_count?: unknown
}

interface RandomExamRequest {
  title: unknown
  typeCounts: unknown
  availability: unknown
}

function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isUuidishString(value: string): boolean {
  return UUIDISH_PATTERN.test(value)
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function findDuplicateValues(values: string[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  }

  return [...duplicates]
}

export function normalizeTypeCountPayload(payload: unknown): RandomExamTypeCount[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((row) => {
      const typeCount = row as TypeCountRow
      const problemTypeId = toCleanString(typeCount.problemTypeId ?? typeCount.problem_type_id)

      if (!problemTypeId) {
        return []
      }

      return [{ problemTypeId, count: toNumber(typeCount.count) }]
    })
  }

  if (payload && typeof payload === 'object') {
    return Object.entries(payload).flatMap(([problemTypeId, count]) => {
      const cleanProblemTypeId = problemTypeId.trim()

      if (!cleanProblemTypeId) {
        return []
      }

      return [{ problemTypeId: cleanProblemTypeId, count: toNumber(count) }]
    })
  }

  return []
}

export function normalizeAvailabilityRows(rows: unknown): QuestionBankAvailability[] {
  if (!Array.isArray(rows)) {
    return []
  }

  return rows.flatMap((row) => {
    const availability = row as AvailabilityRow
    const problemTypeId = toCleanString(availability.problemTypeId ?? availability.problem_type_id)

    if (!problemTypeId) {
      return []
    }

    return [
      {
        problemTypeId,
        availableCount: toNumber(availability.availableCount ?? availability.available_count),
      },
    ]
  })
}

export function getMaxCountForProblemType(
  availability: QuestionBankAvailability[],
  problemTypeId: string
): number {
  return Math.max(
    0,
    ...availability
      .filter((row) => row.problemTypeId === problemTypeId)
      .map((row) => row.availableCount)
  )
}

export function validateRandomExamRequest({
  title,
  typeCounts,
  availability,
}: RandomExamRequest): RandomExamValidationResult {
  const normalizedTypeCounts = normalizeTypeCountPayload(typeCounts)
  const normalizedAvailability = normalizeAvailabilityRows(availability)
  const errors: RandomExamValidationResult['errors'] = []

  if (typeof title !== 'string' || title.trim().length === 0) {
    errors.push({
      code: 'missing_title',
      field: 'title',
      message: '제목을 입력해주세요.',
    })
  }

  for (const typeCount of normalizedTypeCounts) {
    if (!isUuidishString(typeCount.problemTypeId)) {
      errors.push({
        code: 'invalid_problem_type_id',
        field: 'typeCounts',
        problemTypeId: typeCount.problemTypeId,
        message: '문제 유형 ID가 올바르지 않습니다.',
      })
    }

    if (!Number.isInteger(typeCount.count) || typeCount.count <= 0) {
      errors.push({
        code: 'invalid_count',
        field: 'typeCounts',
        problemTypeId: typeCount.problemTypeId,
        message: '문항 수는 1 이상의 정수여야 합니다.',
      })
    }
  }

  for (const problemTypeId of findDuplicateValues(normalizedTypeCounts.map((item) => item.problemTypeId))) {
    errors.push({
      code: 'duplicate_problem_type',
      field: 'typeCounts',
      problemTypeId,
      message: '동일한 문제 유형이 중복 선택되었습니다.',
    })
  }

  const totalCount = normalizedTypeCounts.reduce((sum, item) => sum + item.count, 0)

  if (totalCount > MAX_RANDOM_EXAM_QUESTION_COUNT) {
    errors.push({
      code: 'total_over_limit',
      field: 'typeCounts',
      message: `전체 문항 수는 ${MAX_RANDOM_EXAM_QUESTION_COUNT}개 이하여야 합니다.`,
    })
  }

  for (const typeCount of normalizedTypeCounts) {
    const availableCount = getMaxCountForProblemType(normalizedAvailability, typeCount.problemTypeId)

    if (typeCount.count > availableCount) {
      errors.push({
        code: 'insufficient_availability',
        field: 'typeCounts',
        problemTypeId: typeCount.problemTypeId,
        message: `요청 문항 수가 사용 가능한 문항 수(${availableCount})를 초과했습니다.`,
      })
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  }
}
