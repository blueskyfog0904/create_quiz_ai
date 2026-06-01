import OpenAI from 'openai'
import { AIAdapter, AIResponse, AITextResponse, GenerateParams, QuestionSchema } from './types'
import { normalizeQuestionTextBackward } from '../questions/normalize-question-field'

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError') ||
    (error instanceof Error && error.message === 'Generation cancelled')
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export class OpenAIAdapter implements AIAdapter {
  private client: OpenAI | null = null

  constructor() {
    // Only initialize if API key is available
    if (process.env.OPENAI_API_KEY) {
      this.client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      })
    }
  }

  async generateRaw(params: GenerateParams): Promise<AITextResponse> {
    if (!this.client) {
      return {
        success: false,
        error: 'OpenAI API key is not configured. Please use Gemini provider instead.'
      }
    }

    try {
      const response = await this.client.chat.completions.create({
        model: params.modelName,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that returns strictly valid JSON.' },
          { role: 'user', content: params.prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: params.temperature ?? 0.2,
        max_tokens: params.maxTokens ?? 1500,
      }, {
        signal: params.signal
      })

      const rawContent = response.choices[0].message.content

      if (!rawContent) {
        return { success: false, error: 'No content returned from OpenAI' }
      }

      return {
        success: true,
        rawResponse: rawContent
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error
      }

      console.error('OpenAI API Error:', error)
      return {
        success: false,
        error: getErrorMessage(error, 'Unknown OpenAI error')
      }
    }
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
    // Check if client is initialized
    if (!this.client) {
      return {
        success: false,
        error: 'OpenAI API key is not configured. Please use Gemini provider instead.'
      }
    }
    try {
      const response = await this.client.chat.completions.create({
        model: params.modelName,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that generates English quiz questions in JSON format.' },
          { role: 'user', content: params.prompt }
        ],
        response_format: { type: 'json_object' },
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 1500,
      }, {
        signal: params.signal
      })

      const rawContent = response.choices[0].message.content

      if (!rawContent) {
        return { success: false, error: 'No content returned from OpenAI' }
      }

      // Parse JSON
      let parsedJson
      try {
        parsedJson = JSON.parse(rawContent)
      } catch {
        return { success: false, rawResponse: rawContent, error: 'Failed to parse JSON response' }
      }

      // Map snake_case to camelCase for schema validation
      const mappedJson = {
        questionText: parsedJson.questionText || parsedJson.question_text,
        questionTextForward: parsedJson.questionTextForward || parsedJson.question_text_forward || null,
        questionTextBackward: normalizeQuestionTextBackward(
          parsedJson.questionTextBackward || parsedJson.question_text_backward
        ),
        passageText: parsedJson.passageText || parsedJson.passage_text || null,
        choices: parsedJson.choices || [],
        answer: parsedJson.answer,
        explanation: parsedJson.explanation
      }

      // Validate with Zod
      const validation = QuestionSchema.safeParse(mappedJson)

      if (!validation.success) {
         // Try to handle partial matches or different structure if needed, but strict is better
         return { 
            success: false, 
            rawResponse: rawContent, 
            error: `Schema validation failed: ${validation.error.message}` 
         }
      }

      return {
        success: true,
        data: validation.data,
        rawResponse: rawContent
      }

    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error
      }

      console.error('OpenAI API Error:', error)
      return {
        success: false,
        error: getErrorMessage(error, 'Unknown OpenAI error')
      }
    }
  }
}
