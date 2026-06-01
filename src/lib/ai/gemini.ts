import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
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

export class GeminiAdapter implements AIAdapter {
  private client: GoogleGenerativeAI

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }

  private getDebugEnabled() {
    return process.env.AI_DEBUG_LOGS === 'true'
  }

  async generateRaw(params: GenerateParams): Promise<AITextResponse> {
    try {
      if (this.getDebugEnabled()) {
        console.info('[Gemini] Request metadata:', {
          model: params.modelName,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          promptLength: params.prompt.length,
        })
      }

      const model = this.client.getGenerativeModel({
        model: params.modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: params.temperature,
          maxOutputTokens: params.maxTokens,
        },
        safetySettings: [
          {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
          {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: HarmBlockThreshold.BLOCK_NONE,
          },
        ],
      })

      const result = await model.generateContent(params.prompt, {
        signal: params.signal
      })
      const response = await result.response

      if (this.getDebugEnabled()) {
        console.info('[Gemini] Response metadata:', {
          candidatesCount: result.response.candidates?.length || 0,
          promptFeedback: result.response.promptFeedback,
          finishReason: result.response.candidates?.[0]?.finishReason,
        })
      }

      if (result.response.promptFeedback?.blockReason) {
        console.error('[Gemini] Content blocked:', result.response.promptFeedback.blockReason)
        return {
          success: false,
          error: `Content blocked by safety filters: ${result.response.promptFeedback.blockReason}`
        }
      }

      const rawContent = response.text()

      if (!rawContent || rawContent.trim() === '') {
        console.error('[Gemini] Empty response received despite having candidates')
        return { success: false, error: 'AI 서비스에서 빈 응답을 반환했습니다. 프롬프트에 JSON 형식 요청을 명시했는지 확인해주세요.' }
      }

      return {
        success: true,
        rawResponse: rawContent
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error
      }

      console.error('[Gemini] API Error:', error)
      console.error('[Gemini] Error details:', getErrorMessage(error, 'Unknown Gemini error'))
      if (error instanceof Error && error.stack) {
        console.error('[Gemini] Stack trace:', error.stack)
      }
      return {
        success: false,
        error: getErrorMessage(error, 'Gemini API 호출 중 오류가 발생했습니다.')
      }
    }
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
    const rawResult = await this.generateRaw(params)

    if (!rawResult.success || !rawResult.rawResponse) {
      return rawResult
    }

    const rawContent = rawResult.rawResponse

    let parsedJson
    try {
      parsedJson = JSON.parse(rawContent)
    } catch (error: unknown) {
      console.error('[Gemini] JSON parse error:', getErrorMessage(error, 'Unknown JSON parse error'))
      console.error('[Gemini] Raw content preview:', rawContent.substring(0, 500))
      return { success: false, rawResponse: rawContent, error: 'AI 응답을 JSON으로 파싱할 수 없습니다.' }
    }

    if (Array.isArray(parsedJson)) {
      console.warn('[Gemini] AI returned an array. Extracting first item.')
      if (parsedJson.length === 0) {
        return { success: false, rawResponse: rawContent, error: 'AI가 빈 배열을 반환했습니다.' }
      }
      parsedJson = parsedJson[0]
    }

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

    const validation = QuestionSchema.safeParse(mappedJson)

    if (!validation.success) {
      console.error('[Gemini] Schema validation failed:', validation.error.message)
      const errorMsg = validation.error.issues?.[0]?.message || validation.error.message || '알 수 없는 검증 오류'
      return {
        success: false,
        rawResponse: rawContent,
        error: `AI 응답 형식이 올바르지 않습니다: ${errorMsg}`
      }
    }

    return {
      success: true,
      data: validation.data,
      rawResponse: rawContent
    }
  }
}
