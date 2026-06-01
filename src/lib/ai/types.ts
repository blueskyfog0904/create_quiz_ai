
import { z } from 'zod'

export type AIProvider = 'openai' | 'gemini' | 'claude'

export interface GenerateParams {
  provider: AIProvider
  modelName: string
  prompt: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

// Define the schema for the normalized question output
export const QuestionSchema = z.object({
  questionText: z.string(),
  questionTextForward: z.string().nullable().optional(),
  questionTextBackward: z.string().nullable().optional(),
  passageText: z.string().nullable().optional(),
  choices: z.array(z.object({
    label: z.string(), // e.g., "①", "a)"
    text: z.string()
  })),
  answer: z.string(),
  explanation: z.string()
})

export type Question = z.infer<typeof QuestionSchema>

export interface AIResponse {
  success: boolean
  data?: Question
  rawResponse?: string
  error?: string
}

export const ReviewIssueSchema = z.object({
  field: z.string().optional(),
  severity: z.enum(['info', 'warning', 'error']).default('info'),
  message: z.string(),
  suggestion: z.string().optional()
})

export const ReviewResultSchema = z.object({
  passed: z.boolean(),
  feedback: z.string(),
  issues: z.array(ReviewIssueSchema).default([]),
  score: z.number().min(0).max(100).optional()
})

export type ReviewResult = z.infer<typeof ReviewResultSchema>

export interface AITextResponse {
  success: boolean
  rawResponse?: string
  error?: string
}

export interface QuestionGenerationAttemptLog {
  id: string
  attemptNo: number
  timestamp: string
  phase: 'generation' | 'review' | 'regeneration' | 'loop'
  event:
    | 'generation_started'
    | 'generation_request_prompt'
    | 'generation_response'
    | 'review_request_payload'
    | 'review_response'
    | 'review_failed_feedback_to_generation'
    | 'regeneration_request_prompt'
    | 'regeneration_response'
    | 'loop_finished'
    | 'loop_failed'
  title: string
  status: 'pending' | 'success' | 'failed' | 'skipped'
  payload?: unknown
  rawText?: string
  durationMs?: number
}

export interface AIAdapter {
  generate(params: GenerateParams): Promise<AIResponse>
  generateRaw?(params: GenerateParams): Promise<AITextResponse>
}
