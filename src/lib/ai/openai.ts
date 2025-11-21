import OpenAI from 'openai'
import { AIAdapter, AIResponse, GenerateParams, QuestionSchema } from './types'

export class OpenAIAdapter implements AIAdapter {
  private client: OpenAI

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
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
      })

      const rawContent = response.choices[0].message.content

      if (!rawContent) {
        return { success: false, error: 'No content returned from OpenAI' }
      }

      // Parse JSON
      let parsedJson
      try {
        parsedJson = JSON.parse(rawContent)
      } catch (e) {
        return { success: false, rawResponse: rawContent, error: 'Failed to parse JSON response' }
      }

      // Validate with Zod
      const validation = QuestionSchema.safeParse(parsedJson)

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

    } catch (error: any) {
      console.error('OpenAI API Error:', error)
      return {
        success: false,
        error: error.message || 'Unknown OpenAI error'
      }
    }
  }
}

