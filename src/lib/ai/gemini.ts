import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import { AIAdapter, AIResponse, GenerateParams, QuestionSchema } from './types'

export class GeminiAdapter implements AIAdapter {
  private client: GoogleGenerativeAI

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
    try {
      console.log('='.repeat(80))
      console.log('[Gemini] Starting generation with model:', params.modelName)
      console.log('[Gemini] Temperature:', params.temperature)
      console.log('[Gemini] Max Tokens:', params.maxTokens)
      console.log('[Gemini] Prompt length:', params.prompt.length, 'characters')
      console.log('[Gemini] Prompt preview (first 500 chars):')
      console.log(params.prompt.substring(0, 500))
      console.log('...')
      console.log('[Gemini] Expected JSON format:')
      console.log(JSON.stringify({
        questionText: "문제 본문",
        choices: [
          { label: "①", text: "선택지 1" },
          { label: "②", text: "선택지 2" }
        ],
        answer: "①",
        explanation: "해설"
      }, null, 2))
      console.log('='.repeat(80))
      
      const model = this.client.getGenerativeModel({ 
          model: params.modelName,
          generationConfig: {
              responseMimeType: "application/json",
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

      const result = await model.generateContent(params.prompt)
      const response = await result.response
      
      console.log('[Gemini] Response received')
      console.log('[Gemini] Candidates count:', result.response.candidates?.length)
      console.log('[Gemini] Prompt feedback:', JSON.stringify(result.response.promptFeedback, null, 2))
      
      if (result.response.candidates && result.response.candidates.length > 0) {
        console.log('[Gemini] First candidate finish reason:', result.response.candidates[0].finishReason)
        console.log('[Gemini] First candidate safety ratings:', JSON.stringify(result.response.candidates[0].safetyRatings, null, 2))
      }
      
      // Check for blocked content
      if (result.response.promptFeedback?.blockReason) {
        console.error('[Gemini] Content blocked:', result.response.promptFeedback.blockReason)
        return { 
          success: false, 
          error: `Content blocked by safety filters: ${result.response.promptFeedback.blockReason}` 
        }
      }

      const rawContent = response.text()
      console.log('[Gemini] Raw content length:', rawContent?.length || 0)
      
      if (rawContent && rawContent.length > 0) {
        console.log('[Gemini] Raw response (first 1000 chars):')
        console.log(rawContent.substring(0, 1000))
      }

      if (!rawContent || rawContent.trim() === '') {
        console.error('[Gemini] Empty response received despite having candidates')
        console.error('[Gemini] Full response object:', JSON.stringify(result.response, null, 2))
        return { success: false, error: 'AI 서비스에서 빈 응답을 반환했습니다. 프롬프트에 JSON 형식 요청을 명시했는지 확인해주세요.' }
      }

      // Parse JSON
      let parsedJson
      try {
        parsedJson = JSON.parse(rawContent)
        console.log('[Gemini] JSON parsed successfully')
        console.log('[Gemini] Parsed structure:', JSON.stringify(parsedJson, null, 2).substring(0, 500))
      } catch (e: any) {
        console.error('[Gemini] JSON parse error:', e.message)
        console.error('[Gemini] Raw content:', rawContent.substring(0, 500))
        return { success: false, rawResponse: rawContent, error: 'AI 응답을 JSON으로 파싱할 수 없습니다.' }
      }

      // Handle array responses (if AI returns multiple questions, take the first one)
      if (Array.isArray(parsedJson)) {
        console.warn('[Gemini] AI returned an array. Extracting first item.')
        if (parsedJson.length === 0) {
          return { success: false, rawResponse: rawContent, error: 'AI가 빈 배열을 반환했습니다.' }
        }
        parsedJson = parsedJson[0]
      }

      // Validate with Zod
      const validation = QuestionSchema.safeParse(parsedJson)

      if (!validation.success) {
        console.error('[Gemini] Schema validation failed:', validation.error.message)
        console.error('[Gemini] Validation errors:', JSON.stringify(validation.error.errors, null, 2))
        console.error('[Gemini] Parsed JSON:', JSON.stringify(parsedJson, null, 2))
        
        const errorMsg = validation.error.errors?.[0]?.message || validation.error.message || '알 수 없는 검증 오류'
         return { 
            success: false, 
            rawResponse: rawContent, 
            error: `AI 응답 형식이 올바르지 않습니다: ${errorMsg}` 
         }
      }

      console.log('[Gemini] Generation successful!')
      console.log('='.repeat(80))
      return {
        success: true,
        data: validation.data,
        rawResponse: rawContent
      }

    } catch (error: any) {
      console.error('[Gemini] API Error:', error)
      console.error('[Gemini] Error details:', error.message)
      if (error.stack) {
        console.error('[Gemini] Stack trace:', error.stack)
      }
      return {
        success: false,
        error: error.message || 'Gemini API 호출 중 오류가 발생했습니다.'
      }
    }
  }
}
