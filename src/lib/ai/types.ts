import { z } from 'zod'

export type AIProvider = 'openai' | 'gemini'

export interface GenerateParams {
  provider: AIProvider
  modelName: string
  prompt: string
  maxTokens?: number
  temperature?: number
}

// Define the schema for the normalized question output
export const QuestionSchema = z.object({
  questionText: z.string(),
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

export interface AIAdapter {
  generate(params: GenerateParams): Promise<AIResponse>
}

