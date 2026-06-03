export type SafeAttemptLog = {
  id: string | null
  attemptNo: number | null
  timestamp: string | null
  phase: string | null
  event: string
  title: string | null
  status: string | null
  rawText: string | null
  payload: unknown
  durationMs: number | null
}

export type SafePreviewQuestion = {
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices?: Array<{ label: string, text: string }>
  answer?: string
  explanation?: string | null
  difficulty?: string
  gradeLevel?: string
}

export type SafeReviewResult = {
  passed: boolean | null
  feedback: string | null
  score: number | null
  issues: Array<{
    field: string | null
    severity: string | null
    message: string
    suggestion: string | null
  }>
}

export const LOG_EVENT_LABELS: Record<string, string> = {
  generation_started: '문제 생성 시작',
  generation_request_prompt: '문제 생성 요청 프롬프트',
  generation_response: '문제 생성 응답',
  review_request_payload: '검토 요청 데이터',
  review_response: '검토 결과',
  review_failed_feedback_to_generation: '재생성 피드백',
  regeneration_request_prompt: '재생성 요청 프롬프트',
  regeneration_response: '재생성 응답',
  loop_finished: '생성 루프 종료',
  loop_failed: '생성 루프 실패',
}

export const LOG_STATUS_LABELS: Record<string, string> = {
  pending: '대기',
  success: '성공',
  failed: '실패',
  skipped: '건너뜀',
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
)

const stringOrNull = (value: unknown): string | null => (
  typeof value === 'string' ? value : null
)

const numberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const booleanOrNull = (value: unknown): boolean | null => (
  typeof value === 'boolean' ? value : null
)

export const safeJsonStringify = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function safeAttemptLogs(value: unknown): SafeAttemptLog[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return []
    }

    return [{
      id: stringOrNull(item.id),
      attemptNo: numberOrNull(item.attemptNo),
      timestamp: stringOrNull(item.timestamp),
      phase: stringOrNull(item.phase),
      event: stringOrNull(item.event) || 'unknown_event',
      title: stringOrNull(item.title),
      status: stringOrNull(item.status),
      rawText: stringOrNull(item.rawText),
      payload: item.payload,
      durationMs: numberOrNull(item.durationMs),
    }]
  })
}

export function getEventLabel(event: string) {
  return LOG_EVENT_LABELS[event] || event || 'unknown_event'
}

export function getStatusLabel(status: string | null) {
  return status ? (LOG_STATUS_LABELS[status] || status) : '-'
}

export function groupLogsByAttemptNo(logs: SafeAttemptLog[]) {
  const groups = new Map<number | null, SafeAttemptLog[]>()

  for (const log of logs) {
    const groupLogs = groups.get(log.attemptNo) || []
    groupLogs.push(log)
    groups.set(log.attemptNo, groupLogs)
  }

  return Array.from(groups, ([attemptNo, groupLogs]) => ({ attemptNo, logs: groupLogs }))
}

export function formatDurationMs(value: unknown) {
  const durationMs = numberOrNull(value)
  if (durationMs === null) {
    return null
  }

  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`
  }

  return `${(durationMs / 1000).toFixed(1)}초`
}

export function formatDateTime(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString('ko-KR')
}

const readStringField = (
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
) => stringOrNull(record[camelKey]) ?? stringOrNull(record[snakeKey])

const readNullableStringField = (
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey: string,
) => {
  const value = record[camelKey] ?? record[snakeKey]
  return typeof value === 'string' || value === null || value === undefined ? value ?? null : null
}

function normalizeChoices(value: unknown): Array<{ label: string, text: string }> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((choice, index) => {
    if (typeof choice === 'string') {
      return [{ label: `${index + 1}`, text: choice }]
    }

    if (!isRecord(choice)) {
      return []
    }

    const label = stringOrNull(choice.label)
    const text = stringOrNull(choice.text)
    if (!label || text === null) {
      return []
    }

    return [{ label, text }]
  })
}

export function getPreviewQuestion(value: unknown): SafePreviewQuestion | null {
  if (!isRecord(value)) {
    return null
  }

  const questionText = readStringField(value, 'questionText', 'question_text')
  if (!questionText?.trim()) {
    return null
  }

  return {
    questionText,
    questionTextForward: readNullableStringField(value, 'questionTextForward', 'question_text_forward'),
    questionTextBackward: readNullableStringField(value, 'questionTextBackward', 'question_text_backward'),
    passageText: readNullableStringField(value, 'passageText', 'passage_text'),
    choices: normalizeChoices(value.choices),
    answer: readStringField(value, 'answer', 'answer') || undefined,
    explanation: readNullableStringField(value, 'explanation', 'explanation'),
    difficulty: readStringField(value, 'difficulty', 'difficulty') || undefined,
    gradeLevel: readStringField(value, 'gradeLevel', 'grade_level') || undefined,
  }
}

export function getReviewResult(value: unknown): SafeReviewResult | null {
  if (!isRecord(value)) {
    return null
  }

  const issues = Array.isArray(value.issues)
    ? value.issues.flatMap((issue) => {
      if (!isRecord(issue)) {
        return []
      }

      const message = stringOrNull(issue.message)
      if (!message) {
        return []
      }

      return [{
        field: stringOrNull(issue.field),
        severity: stringOrNull(issue.severity),
        message,
        suggestion: stringOrNull(issue.suggestion),
      }]
    })
    : []

  return {
    passed: booleanOrNull(value.passed),
    feedback: stringOrNull(value.feedback),
    score: numberOrNull(value.score),
    issues,
  }
}
