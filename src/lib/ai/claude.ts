import { AIAdapter, AIResponse, AITextResponse, GenerateParams, QuestionSchema } from './types'
import { normalizeQuestionTextBackward } from '../questions/normalize-question-field'
import { getProviderRuntimeConfig } from './provider-connections'

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

function extractClaudeText(response: unknown) {
  if (!response || typeof response !== 'object' || !('content' in response)) return ''
  const content = (response as { content?: unknown }).content
  if (!Array.isArray(content)) return ''

  return content
    .map((item) => {
      if (!item || typeof item !== 'object' || !('text' in item)) return ''
      const text = (item as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
    .trim()
}

export class ClaudeAdapter implements AIAdapter {
  async generateRaw(params: GenerateParams): Promise<AITextResponse> {
    const config = await getProviderRuntimeConfig('claude')

    if (!config) {
      return {
        success: false,
        error: 'Claude API key is not configured.'
      }
    }

    try {
      const response = await fetch(`${config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': config.anthropicVersion || '2023-06-01',
        },
        body: JSON.stringify({
          model: params.modelName,
          max_tokens: params.maxTokens ?? 1500,
          messages: [
            {
              role: 'user',
              content: params.prompt,
            },
          ],
        }),
        signal: params.signal,
      })

      const payload = await response.json().catch(() => null)

      if (!response.ok) {
        return {
          success: false,
          error: payload && typeof payload === 'object' && 'error' in payload
            ? JSON.stringify((payload as { error: unknown }).error)
            : `Claude API error (${response.status})`,
        }
      }

      const rawContent = extractClaudeText(payload)

      if (!rawContent) {
        return { success: false, error: 'No content returned from Claude' }
      }

      return {
        success: true,
        rawResponse: rawContent,
      }
    } catch (error: unknown) {
      if (isAbortError(error)) {
        throw error
      }

      console.error('Claude API Error:', error)
      return {
        success: false,
        error: getErrorMessage(error, 'Unknown Claude error'),
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
    } catch {
      return { success: false, rawResponse: rawContent, error: 'Failed to parse JSON response' }
    }

    if (Array.isArray(parsedJson)) {
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
      explanation: parsedJson.explanation,
    }

    const validation = QuestionSchema.safeParse(mappedJson)

    if (!validation.success) {
      return {
        success: false,
        rawResponse: rawContent,
        error: `Schema validation failed: ${validation.error.message}`,
      }
    }

    return {
      success: true,
      data: validation.data,
      rawResponse: rawContent,
    }
  }
}
