export type AiJsonArrayMode = 'reject' | 'first'

export type AiJsonParseErrorCode =
  | 'AI_JSON_EMPTY_RESPONSE'
  | 'AI_JSON_PARSE_FAILED'
  | 'AI_JSON_UNEXPECTED_SHAPE'
  | 'AI_JSON_EMPTY_ARRAY'
  | 'AI_JSON_MULTIPLE_FENCED_BLOCKS'
  | 'AI_JSON_FENCE_OUTSIDE_TEXT'
  | 'AI_JSON_UNSUPPORTED_FENCE_LANGUAGE'

export type AiJsonParseResult =
  | { success: true; data: unknown; source: 'raw' | 'fenced' }
  | { success: false; code: AiJsonParseErrorCode; error: string }

type ParseOptions = {
  arrayMode?: AiJsonArrayMode
}

const parseJson = (value: string) => {
  try {
    return { success: true as const, data: JSON.parse(value) as unknown }
  } catch {
    return { success: false as const }
  }
}

const failure = (code: AiJsonParseErrorCode, error: string): AiJsonParseResult => ({
  success: false,
  code,
  error,
})

const normalizeParsedValue = (
  value: unknown,
  source: 'raw' | 'fenced',
  arrayMode: AiJsonArrayMode
): AiJsonParseResult => {
  let candidate = value

  if (Array.isArray(candidate)) {
    if (arrayMode === 'reject') {
      return failure('AI_JSON_UNEXPECTED_SHAPE', 'AI JSON response must be a single object.')
    }

    if (candidate.length === 0) {
      return failure('AI_JSON_EMPTY_ARRAY', 'AI JSON response returned an empty array.')
    }

    candidate = candidate[0]
  }

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return failure('AI_JSON_UNEXPECTED_SHAPE', 'AI JSON response must be an object.')
  }

  return {
    success: true,
    data: candidate,
    source,
  }
}

const countFenceTokens = (value: string) => value.match(/```/g)?.length ?? 0

const parseFencedJson = (value: string, arrayMode: AiJsonArrayMode): AiJsonParseResult => {
  const fenceCount = countFenceTokens(value)

  if (fenceCount === 0) {
    return failure('AI_JSON_PARSE_FAILED', 'AI JSON response could not be parsed.')
  }

  if (fenceCount > 2) {
    return failure('AI_JSON_MULTIPLE_FENCED_BLOCKS', 'AI JSON response contains multiple fenced code blocks.')
  }

  if (!value.startsWith('```') || !value.endsWith('```')) {
    return failure('AI_JSON_FENCE_OUTSIDE_TEXT', 'AI JSON response contains text outside the fenced code block.')
  }

  const fencedBody = value.slice(3, -3)
  const newlineMatch = fencedBody.match(/\r?\n/)

  if (!newlineMatch || newlineMatch.index === undefined) {
    return failure('AI_JSON_PARSE_FAILED', 'AI JSON fenced code block is empty or malformed.')
  }

  const language = fencedBody.slice(0, newlineMatch.index).trim().toLowerCase()

  if (language && language !== 'json') {
    return failure('AI_JSON_UNSUPPORTED_FENCE_LANGUAGE', 'AI JSON response uses an unsupported fenced code block language.')
  }

  const jsonText = fencedBody.slice(newlineMatch.index + newlineMatch[0].length).trim()
  const parsed = parseJson(jsonText)

  if (!parsed.success) {
    return failure('AI_JSON_PARSE_FAILED', 'AI JSON response could not be parsed.')
  }

  return normalizeParsedValue(parsed.data, 'fenced', arrayMode)
}

export function parseAiJsonResponse(
  rawResponse: string,
  options: ParseOptions = {}
): AiJsonParseResult {
  const arrayMode = options.arrayMode ?? 'reject'
  const trimmed = rawResponse.trim()

  if (!trimmed) {
    return failure('AI_JSON_EMPTY_RESPONSE', 'AI JSON response is empty.')
  }

  const parsed = parseJson(trimmed)

  if (parsed.success) {
    return normalizeParsedValue(parsed.data, 'raw', arrayMode)
  }

  return parseFencedJson(trimmed, arrayMode)
}
