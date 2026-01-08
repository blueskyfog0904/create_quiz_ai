import { OpenAIAdapter } from './openai'
import { GeminiAdapter } from './gemini'
import { AIAdapter, AIResponse, GenerateParams } from './types'

export class AIGenerationService {
  private static adapters: Record<string, AIAdapter> = {
    openai: new OpenAIAdapter(),
    gemini: new GeminiAdapter(),
  }

  static async generate(params: GenerateParams): Promise<AIResponse> {
    const adapter = this.adapters[params.provider]

    if (!adapter) {
      return { success: false, error: `Provider ${params.provider} not supported` }
    }

    return adapter.generate(params)
  }
}

