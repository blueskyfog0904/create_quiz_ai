import { createAdminClient } from '@/lib/supabase/bypass'
import type { Json, TablesInsert } from '@/types/supabase'
import type {
  Question,
  QuestionGenerationAttemptLog,
  ReviewResult,
} from './types'
import type {
  QuestionGenerationLoopStatus,
  QuestionGenerationModelConfig,
} from './question-generation-workflow'

export type AiQuestionGenerationRunSource = 'single' | 'multi' | 'textbook' | 'listboard_run' | 'listboard_retry'

type WorkspaceSubject = 'english' | 'korean'

const DETAIL_RETENTION_DAYS = 30
const MAX_LOG_TEXT_LENGTH = 12_000

type SanitizeState = {
  redactionFlags: Record<string, boolean>
  truncatedFlags: Record<string, boolean>
}

type SanitizedTrace = {
  value: Json
  redactionFlags: Json
  truncatedFlags: Json
}

export type LogAiQuestionGenerationRunInput = {
  userId: string
  workspaceSubject: WorkspaceSubject
  source: AiQuestionGenerationRunSource
  problemTypeId?: string | null
  problemTypeName?: string | null
  questionId?: string | null
  listboardJobId?: string | null
  listboardJobItemId?: string | null
  status: QuestionGenerationLoopStatus | string
  stopReason?: string | null
  input?: unknown
  modelConfig?: QuestionGenerationModelConfig | null
  finalQuestion?: Question | null
  lastQuestion?: Question | null
  finalReview?: ReviewResult | null
  attempts?: QuestionGenerationAttemptLog[]
  creditCharged?: number
}

export type LinkAiQuestionGenerationRunInput = {
  generationRunId: string
  questionId: string
  userId: string
  workspaceSubject: WorkspaceSubject
  problemTypeId: string
  allowedSources: AiQuestionGenerationRunSource[]
}

export type LinkLatestJobItemGenerationRunInput = {
  questionId: string
  userId: string
  workspaceSubject: WorkspaceSubject
  listboardJobItemId: string
}

const toJson = (value: unknown): Json => (
  value === undefined ? null : JSON.parse(JSON.stringify(value))
)

export class AiQuestionGenerationRunLogError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AiQuestionGenerationRunLogError'
  }
}

const createExpiresAt = () => {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + DETAIL_RETENTION_DAYS)
  return expiresAt.toISOString()
}

const markRedaction = (state: SanitizeState, key: string) => {
  state.redactionFlags[key] = true
}

const redactPattern = (
  value: string,
  pattern: RegExp,
  replacement: string,
  state: SanitizeState,
  flag: string
) => {
  if (!pattern.test(value)) return value
  markRedaction(state, flag)
  return value.replace(pattern, replacement)
}

const sanitizeString = (value: string, state: SanitizeState, path: string) => {
  let next = value

  next = redactPattern(next, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]', state, 'email')
  next = redactPattern(next, /\b(?:\+?82[-\s.]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '[REDACTED_PHONE]', state, 'phone')
  next = redactPattern(next, /\b\d{6}[-\s]?\d{7}\b/g, '[REDACTED_RRN]', state, 'rrn')
  next = redactPattern(next, /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]', state, 'jwt')
  next = redactPattern(next, /\b(?:sk|sk-ant|AIza)[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TOKEN]', state, 'token')
  next = redactPattern(next, /(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/gi, '$1[REDACTED_TOKEN]', state, 'authorization')
  next = redactPattern(next, /(cookie\s*[:=]\s*)[^\n]+/gi, '$1[REDACTED_TOKEN]', state, 'cookie')

  if (next.includes('[TRUNCATED ')) {
    state.truncatedFlags[path] = true
  }

  if (next.length > MAX_LOG_TEXT_LENGTH) {
    state.truncatedFlags[path] = true
    return `${next.slice(0, MAX_LOG_TEXT_LENGTH)}\n\n[TRUNCATED ${next.length - MAX_LOG_TEXT_LENGTH} chars]`
  }

  return next
}

const sanitizeUnknown = (value: unknown, state: SanitizeState, path = 'root'): unknown => {
  if (typeof value === 'string') return sanitizeString(value, state, path)
  if (Array.isArray(value)) return value.map((item, index) => sanitizeUnknown(item, state, `${path}.${index}`))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeUnknown(item, state, `${path}.${key}`),
      ])
    )
  }
  return value
}

export function sanitizeGenerationRunTrace(value: unknown): SanitizedTrace {
  const state: SanitizeState = {
    redactionFlags: {},
    truncatedFlags: {},
  }
  const sanitized = sanitizeUnknown(value, state)

  return {
    value: toJson(sanitized),
    redactionFlags: toJson(state.redactionFlags),
    truncatedFlags: toJson(state.truncatedFlags),
  }
}

export async function logAiQuestionGenerationRun(input: LogAiQuestionGenerationRunInput) {
  if (input.workspaceSubject !== 'english') return null

  const attemptsTrace = sanitizeGenerationRunTrace(input.attempts ?? [])
  const inputTrace = sanitizeGenerationRunTrace(input.input ?? {})
  const finalQuestionTrace = sanitizeGenerationRunTrace(input.finalQuestion ?? null)
  const lastQuestionTrace = sanitizeGenerationRunTrace(input.lastQuestion ?? null)
  const finalReviewTrace = sanitizeGenerationRunTrace(input.finalReview ?? null)

  const redactionFlags = {
    attempts: attemptsTrace.redactionFlags,
    input: inputTrace.redactionFlags,
    finalQuestion: finalQuestionTrace.redactionFlags,
    lastQuestion: lastQuestionTrace.redactionFlags,
    finalReview: finalReviewTrace.redactionFlags,
  }
  const truncatedFlags = {
    attempts: attemptsTrace.truncatedFlags,
    input: inputTrace.truncatedFlags,
    finalQuestion: finalQuestionTrace.truncatedFlags,
    lastQuestion: lastQuestionTrace.truncatedFlags,
    finalReview: finalReviewTrace.truncatedFlags,
  }

  const row: TablesInsert<'ai_question_generation_runs'> = {
    user_id: input.userId,
    workspace_subject: input.workspaceSubject,
    source: input.source,
    problem_type_id: input.problemTypeId ?? null,
    problem_type_name: input.problemTypeName ?? null,
    question_id: input.questionId ?? null,
    listboard_job_id: input.listboardJobId ?? null,
    listboard_job_item_id: input.listboardJobItemId ?? null,
    status: input.status,
    stop_reason: input.stopReason ?? null,
    input: inputTrace.value,
    model_config: toJson(input.modelConfig ?? {}),
    final_question: finalQuestionTrace.value,
    last_question: lastQuestionTrace.value,
    final_review: finalReviewTrace.value,
    attempts: attemptsTrace.value,
    redaction_flags: toJson(redactionFlags),
    truncated_flags: toJson(truncatedFlags),
    credit_charged: input.creditCharged ?? 0,
    expires_at: createExpiresAt(),
  }

  const { data, error } = await createAdminClient()
    .from('ai_question_generation_runs')
    .insert(row)
    .select('id')
    .single()

  if (error || !data) {
    throw new AiQuestionGenerationRunLogError('AI 생성 로그 저장에 실패했습니다.', { cause: error })
  }

  return data.id
}

export async function linkAiQuestionGenerationRunToQuestion(input: LinkAiQuestionGenerationRunInput) {
  const supabase = createAdminClient()
  const { data: run, error } = await supabase
    .from('ai_question_generation_runs')
    .select('id,user_id,workspace_subject,source,problem_type_id,status,question_id')
    .eq('id', input.generationRunId)
    .maybeSingle()

  if (error || !run) return false
  if (run.user_id !== input.userId) return false
  if (run.workspace_subject !== input.workspaceSubject) return false
  if (run.question_id) return false
  if (run.problem_type_id !== input.problemTypeId) return false
  if (run.status !== 'passed') return false
  if (!input.allowedSources.includes(run.source as AiQuestionGenerationRunSource)) return false

  const { error: updateError } = await supabase
    .from('ai_question_generation_runs')
    .update({ question_id: input.questionId })
    .eq('id', run.id)
    .is('question_id', null)

  return !updateError
}

export async function pruneExpiredAiQuestionGenerationRuns() {
  const now = new Date().toISOString()
  const { error } = await createAdminClient()
    .from('ai_question_generation_runs')
    .update({
      input: {},
      final_question: null,
      last_question: null,
      final_review: null,
      attempts: [],
      model_config: {},
      truncated_flags: { expired: true },
    })
    .lt('expires_at', now)

  if (error) {
    throw new AiQuestionGenerationRunLogError('만료된 AI 생성 로그 정리에 실패했습니다.', { cause: error })
  }
}

export async function linkLatestAiQuestionGenerationRunForJobItem(input: LinkLatestJobItemGenerationRunInput) {
  const supabase = createAdminClient()
  const { data: run, error } = await supabase
    .from('ai_question_generation_runs')
    .select('id')
    .eq('user_id', input.userId)
    .eq('workspace_subject', input.workspaceSubject)
    .eq('listboard_job_item_id', input.listboardJobItemId)
    .eq('status', 'passed')
    .is('question_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !run) return false

  const { error: updateError } = await supabase
    .from('ai_question_generation_runs')
    .update({ question_id: input.questionId })
    .eq('id', run.id)
    .is('question_id', null)

  return !updateError
}
