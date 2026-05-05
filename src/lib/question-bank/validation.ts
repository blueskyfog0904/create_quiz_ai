const UUIDISH_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidishString(value: unknown): value is string {
  return typeof value === 'string' && UUIDISH_PATTERN.test(value.trim())
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function validateTitle(value: unknown): string | null {
  return isNonEmptyString(value) ? null : '제목을 입력해주세요.'
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function findDuplicateValues(values: string[]): string[] {
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

export function validateTotalCap(total: number, max: number): string | null {
  return total <= max ? null : `전체 문항 수는 ${max}개 이하여야 합니다.`
}
