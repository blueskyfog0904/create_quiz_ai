import { OpenAIAdapter } from './openai'
import { GeminiAdapter } from './gemini'
import { AIAdapter, AIResponse, AITextResponse, GenerateParams } from './types'

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

  static async generateRaw(params: GenerateParams): Promise<AITextResponse> {
    const adapter = this.adapters[params.provider]

    if (!adapter) {
      return { success: false, error: `Provider ${params.provider} not supported` }
    }

    if (adapter.generateRaw) {
      return adapter.generateRaw(params)
    }

    const response = await adapter.generate(params)
    return {
      success: response.success,
      rawResponse: response.rawResponse,
      error: response.error
    }
  }
}
