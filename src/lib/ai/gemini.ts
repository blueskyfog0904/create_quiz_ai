import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from '@google/generative-ai'
import { AIAdapter, AIResponse, GenerateParams, QuestionSchema } from './types'
import { normalizeQuestionTextBackward } from '../questions/normalize-question-field'

export class GeminiAdapter implements AIAdapter {
  private client: GoogleGenerativeAI

  constructor() {
    this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  }

  async generate(params: GenerateParams): Promise<AIResponse> {
    try {
      console.log('\n' + '='.repeat(80))
      console.log('📤 FULL PROMPT SENT TO AI')
      console.log('='.repeat(80))
      console.log('Provider:', params.modelName)
      console.log('Model:', params.modelName)
      console.log('Temperature:', params.temperature)
      console.log('Max Tokens:', params.maxTokens)
      console.log('Prompt length:', params.prompt.length, 'characters')
      console.log('-'.repeat(80))
      console.log('FULL PROMPT CONTENT:')
      console.log(params.prompt)
      console.log('='.repeat(80) + '\n')
      
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

      const result = await model.generateContent(params.prompt, {
        signal: params.signal
      })
      const response = await result.response
      
      console.log('\n' + '='.repeat(80))
      console.log('📊 AI RESPONSE METADATA')
      console.log('='.repeat(80))
      console.log('Candidates count:', result.response.candidates?.length || 0)
      console.log('Prompt feedback:', result.response.promptFeedback)
      
      if (result.response.candidates && result.response.candidates.length > 0) {
        console.log('First candidate finish reason:', result.response.candidates[0].finishReason)
        console.log('First candidate safety ratings:', result.response.candidates[0].safetyRatings)
      }
      console.log('='.repeat(80) + '\n')
      
      // Check for blocked content
      if (result.response.promptFeedback?.blockReason) {
        console.error('[Gemini] Content blocked:', result.response.promptFeedback.blockReason)
        return { 
          success: false, 
          error: `Content blocked by safety filters: ${result.response.promptFeedback.blockReason}` 
        }
      }

      const rawContent = response.text()
      console.log('\n' + '='.repeat(80))
      console.log('📥 FULL RESPONSE FROM AI')
      console.log('='.repeat(80))
      console.log('Raw content length:', rawContent?.length || 0)
      console.log('-'.repeat(80))
      
      if (rawContent && rawContent.length > 0) {
        console.log('FULL RESPONSE CONTENT:')
        console.log(rawContent)
      } else {
        console.log('(Empty response)')
      }
      console.log('='.repeat(80) + '\n')

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
      console.log('[Gemini] Mapped JSON:', JSON.stringify(mappedJson, null, 2).substring(0, 500))

      // Validate with Zod
      const validation = QuestionSchema.safeParse(mappedJson)

      if (!validation.success) {
        console.error('[Gemini] Schema validation failed:', validation.error.message)
        console.error('[Gemini] Validation errors:', JSON.stringify(validation.error.issues, null, 2))
        console.error('[Gemini] Parsed JSON:', JSON.stringify(parsedJson, null, 2))
        
        const errorMsg = validation.error.issues?.[0]?.message || validation.error.message || '알 수 없는 검증 오류'
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
      const isAbortError =
        (error instanceof DOMException && error.name === 'AbortError') ||
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof Error && error.message === 'Generation cancelled')

      if (isAbortError) {
        throw error
      }

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
