const LEADING_DOWN_ARROW_PREFIX = /^\s*(?:[-*•]\s*)?[↓↧▼▾⮟]\s*/u
const INLINE_BRACKET_SEGMENT_REGEX = /\[([^\[\]\n]+)\]/g
const INLINE_UNDERLINE_CONTENT_PATTERN = /[\s가-힣]|[a-z]/u

export type BracketUnderlineSegment = {
  type: 'text' | 'underline'
  value: string
}

const shouldUnderlineBracketContent = (value: string) => {
  const trimmed = value.trim()

  if (!trimmed) return false
  if (trimmed.includes('[') || trimmed.includes(']')) return false

  return INLINE_UNDERLINE_CONTENT_PATTERN.test(trimmed)
}

export const normalizeQuestionTextBackward = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null

  const trimmedStart = value.trimStart()
  if (!trimmedStart) return null

  const withoutLeadingMarker = trimmedStart.replace(LEADING_DOWN_ARROW_PREFIX, '')

  return withoutLeadingMarker || null
}

export const splitBracketUnderlineSegments = (
  value: string | null | undefined
): BracketUnderlineSegment[] => {
  if (!value) return []

  INLINE_BRACKET_SEGMENT_REGEX.lastIndex = 0

  const segments: BracketUnderlineSegment[] = []
  let lastIndex = 0

  for (const match of value.matchAll(INLINE_BRACKET_SEGMENT_REGEX)) {
    const matchedText = match[0]
    const underlinedText = match[1]
    const startIndex = match.index ?? -1

    if (startIndex < 0) continue

    if (startIndex > lastIndex) {
      segments.push({
        type: 'text',
        value: value.slice(lastIndex, startIndex),
      })
    }

    if (underlinedText && shouldUnderlineBracketContent(underlinedText)) {
      segments.push({
        type: 'underline',
        value: underlinedText.trim(),
      })
    } else {
      segments.push({
        type: 'text',
        value: matchedText,
      })
    }

    lastIndex = startIndex + matchedText.length
  }

  if (lastIndex < value.length) {
    segments.push({
      type: 'text',
      value: value.slice(lastIndex),
    })
  }

  if (segments.length === 0) {
    return [
      {
        type: 'text',
        value,
      },
    ]
  }

  return segments
}
