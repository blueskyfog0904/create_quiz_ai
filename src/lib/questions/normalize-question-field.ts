const LEADING_DOWN_ARROW_PREFIX = /^\s*(?:[-*•]\s*)?[↓↧▼▾⮟]\s*/u

export const normalizeQuestionTextBackward = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null

  const trimmedStart = value.trimStart()
  if (!trimmedStart) return null

  const withoutLeadingMarker = trimmedStart.replace(LEADING_DOWN_ARROW_PREFIX, '')

  return withoutLeadingMarker || null
}
