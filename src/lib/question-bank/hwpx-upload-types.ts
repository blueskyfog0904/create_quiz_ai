export const HWPX_UPLOAD_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxZipEntries: 300,
  maxXmlEntryBytes: 1024 * 1024,
  maxXmlBytes: 4 * 1024 * 1024,
  maxZipCompressionRatio: 80,
  maxExtractedChars: 60_000,
  maxAiChunkChars: 12_000,
  maxAiChunks: 8,
  maxAiOutputTokens: 6000,
  minimumOutputTokenBudget: 1000,
  chatRequestOverheadTokens: 12_000,
  maxEstimatedInputTokens: 40_000,
  maxTotalTokens: 70_000,
  maxQuestions: 120,
  maxFilledTemplatePayloadChars: 1_500_000,
} as const

export const HWPX_ALLOWED_XML_ENTRY_PATTERN = /^Contents\/section\d+\.xml$/i

export type HwpxQuestionStatus = 'valid' | 'needs_review' | 'invalid'

export interface HwpxExtractedSection {
  path: string
  text: string
}

export interface HwpxExtractedDocument {
  text: string
  sections: HwpxExtractedSection[]
  warnings: string[]
}

export interface HwpxAnalysisUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  callCount: number
}

export interface HwpxAnalyzedQuestion {
  id: string
  clientRowId: string
  bankProblemTypeId?: string
  problem_type_id: string
  problem_type_name: string
  passage_text: string
  question_text: string
  question_text_forward: string
  question_text_backward: string
  choices: string[]
  answer: string
  explanation: string
  grade_level: string
  difficulty: string
  yearId: string
  bookId: string
  isValid: boolean
  errorMessage?: string
  source_type?: string
  source_1?: string
  source_2?: string
  source_3?: string
  source_4?: string
  conversionStatus: HwpxQuestionStatus
  confidence: number
  warnings: string[]
  sourceSnippet: string
}
