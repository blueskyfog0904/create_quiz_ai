import OpenAI from 'openai'
import { z } from 'zod'
import { HWPX_UPLOAD_LIMITS, type HwpxAnalysisUsage } from './hwpx-upload-types'

export interface HwpxProblemTypeOption {
  id: string
  type_name: string
}

export interface AnalyzeHwpxChunkInput {
  text: string
  chunkIndex: number
  problemTypes: HwpxProblemTypeOption[]
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
}

export const HwpxAiQuestionSchema = z.object({
  sourceSnippet: z.string().default(''),
  passage_text: z.string().default(''),
  question_text: z.string().default(''),
  question_text_forward: z.string().default(''),
  question_text_backward: z.string().default(''),
  choices: z.array(z.string()).default([]),
  answer: z.string().default(''),
  explanation: z.string().default(''),
  grade_level: z.enum(['', '중1', '중2', '중3', '고1', '고2', '고3']).default(''),
  difficulty: z.enum(['', '하', '중', '상']).default(''),
  bankProblemTypeId: z.string().default(''),
  problem_type_name: z.string().default(''),
  source_type: z.string().default(''),
  source_1: z.string().default(''),
  source_2: z.string().default(''),
  source_3: z.string().default(''),
  source_4: z.string().default(''),
  conversionStatus: z.enum(['valid', 'needs_review', 'invalid']).default('needs_review'),
  confidence: z.number().min(0).max(1).default(0),
  warnings: z.array(z.string()).default([]),
}).strict()

export type HwpxAiQuestion = z.infer<typeof HwpxAiQuestionSchema>

const HwpxAiResponseSchema = z.object({
  questions: z.array(HwpxAiQuestionSchema).max(HWPX_UPLOAD_LIMITS.maxQuestions),
  warnings: z.array(z.string()).default([]),
}).strict()

const jsonSchema = {
  name: 'hwpx_question_bank_rows',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['questions', 'warnings'],
    properties: {
      questions: {
        type: 'array',
        maxItems: HWPX_UPLOAD_LIMITS.maxQuestions,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'sourceSnippet', 'passage_text', 'question_text', 'question_text_forward', 'question_text_backward',
            'choices', 'answer', 'explanation', 'grade_level', 'difficulty', 'bankProblemTypeId',
            'problem_type_name', 'source_type', 'source_1', 'source_2', 'source_3', 'source_4',
            'conversionStatus', 'confidence', 'warnings',
          ],
          properties: {
            sourceSnippet: { type: 'string' },
            passage_text: { type: 'string' },
            question_text: { type: 'string' },
            question_text_forward: { type: 'string' },
            question_text_backward: { type: 'string' },
            choices: { type: 'array', items: { type: 'string' } },
            answer: { type: 'string' },
            explanation: { type: 'string' },
            grade_level: { type: 'string', enum: ['', '중1', '중2', '중3', '고1', '고2', '고3'] },
            difficulty: { type: 'string', enum: ['', '하', '중', '상'] },
            bankProblemTypeId: { type: 'string' },
            problem_type_name: { type: 'string' },
            source_type: { type: 'string' },
            source_1: { type: 'string' },
            source_2: { type: 'string' },
            source_3: { type: 'string' },
            source_4: { type: 'string' },
            conversionStatus: { type: 'string', enum: ['valid', 'needs_review', 'invalid'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      warnings: { type: 'array', items: { type: 'string' } },
    },
  },
} as const

export function estimateTokenCount(text: string) {
  // Conservative upper-bound approximation for mixed Korean/English prompts.
  // OpenAI BPE tokens cannot exceed UTF-8 byte length because each token covers at least one byte.
  return Math.max(1, Buffer.byteLength(text, 'utf8'))
}

export function chunkHwpxTextForAi(text: string) {
  const estimatedTokens = estimateTokenCount(text)
  if (estimatedTokens > HWPX_UPLOAD_LIMITS.maxEstimatedInputTokens) {
    throw new Error('AI 분석 입력 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
  }

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line
    if (next.length > HWPX_UPLOAD_LIMITS.maxAiChunkChars && current) {
      chunks.push(current)
      current = line
    } else {
      current = next
    }
  }

  if (current) chunks.push(current)

  if (chunks.length > HWPX_UPLOAD_LIMITS.maxAiChunks) {
    throw new Error('AI 분석 호출 수가 너무 많습니다. 문서를 나누어 업로드해주세요.')
  }

  return chunks
}

function buildSystemPrompt(problemTypes: HwpxProblemTypeOption[]) {
  return [
    '당신은 문제은행 업로드 템플릿 변환기입니다.',
    'HWPX에서 추출된 텍스트를 읽고 문제은행 업로드 row JSON으로만 반환합니다.',
    '문서에 없는 지문, 정답, 해설, 선택지를 절대 만들지 마세요. 추론해서 생성하지 마세요.',
    '문서에 없으면 빈 문자열로 두고 warnings에 이유를 적으세요.',
    '확실하지 않으면 conversionStatus를 needs_review로 설정하세요.',
    '문제유형은 아래 question_bank_problem_types 중 하나만 선택합니다.',
    JSON.stringify(problemTypes.map((type) => ({ bankProblemTypeId: type.id, problem_type_name: type.type_name }))),
  ].join('\n')
}

function buildUserPrompt(input: AnalyzeHwpxChunkInput) {
  return [
    `chunkIndex: ${input.chunkIndex}`,
    `defaultGradeLevel: ${input.defaultGradeLevel || ''}`,
    `defaultDifficulty: ${input.defaultDifficulty || ''}`,
    `sourceType: ${input.sourceType || ''}`,
    '아래 HWPX 추출 텍스트를 문항 단위로 분리하세요.',
    '각 문항의 원문 일부를 sourceSnippet에 500자 이하로 넣으세요.',
    '<HWPX_TEXT>',
    input.text,
    '</HWPX_TEXT>',
  ].join('\n')
}

export function estimateHwpxAiTokenBudget(input: {
  chunks: string[]
  problemTypes: HwpxProblemTypeOption[]
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
}) {
  const systemPrompt = buildSystemPrompt(input.problemTypes)
  const schemaBudgetTokens = estimateTokenCount(JSON.stringify(jsonSchema))

  return input.chunks.reduce((total, chunk, index) => {
    const userPrompt = buildUserPrompt({
      text: chunk,
      chunkIndex: index,
      problemTypes: input.problemTypes,
      defaultGradeLevel: input.defaultGradeLevel,
      defaultDifficulty: input.defaultDifficulty,
      sourceType: input.sourceType,
    })

    return total
      + estimateTokenCount(systemPrompt)
      + estimateTokenCount(userPrompt)
      + schemaBudgetTokens
      + HWPX_UPLOAD_LIMITS.chatRequestOverheadTokens
      + HWPX_UPLOAD_LIMITS.maxAiOutputTokens
  }, 0)
}

export function assertHwpxAiTokenBudgetWithinLimit(input: Parameters<typeof estimateHwpxAiTokenBudget>[0]) {
  const projectedTotalTokens = estimateHwpxAiTokenBudget(input)
  if (projectedTotalTokens > HWPX_UPLOAD_LIMITS.maxTotalTokens) {
    throw new Error('AI 분석 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
  }
  return projectedTotalTokens
}

export async function analyzeHwpxTextWithOpenAI(input: {
  text: string
  problemTypes: HwpxProblemTypeOption[]
  defaultGradeLevel?: string
  defaultDifficulty?: string
  sourceType?: string
  modelName?: string
}) {
  const chunks = chunkHwpxTextForAi(input.text)
  assertHwpxAiTokenBudgetWithinLimit({
    chunks,
    problemTypes: input.problemTypes,
    defaultGradeLevel: input.defaultGradeLevel,
    defaultDifficulty: input.defaultDifficulty,
    sourceType: input.sourceType,
  })

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY가 설정되어 있지 않습니다.')
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const questions: HwpxAiQuestion[] = []
  const warnings: string[] = []
  const usage: HwpxAnalysisUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, callCount: 0 }
  const model = input.modelName || process.env.QUESTION_BANK_HWPX_AI_MODEL || 'gpt-4o-mini'

  for (let index = 0; index < chunks.length; index++) {
    const systemPrompt = buildSystemPrompt(input.problemTypes)
    const userPrompt = buildUserPrompt({ ...input, text: chunks[index], chunkIndex: index })
    const estimatedCallInputTokens = estimateTokenCount(systemPrompt)
      + estimateTokenCount(userPrompt)
      + estimateTokenCount(JSON.stringify(jsonSchema))
      + HWPX_UPLOAD_LIMITS.chatRequestOverheadTokens
    const remainingTokenBudget = HWPX_UPLOAD_LIMITS.maxTotalTokens - usage.totalTokens - estimatedCallInputTokens

    if (remainingTokenBudget < HWPX_UPLOAD_LIMITS.minimumOutputTokenBudget) {
      throw new Error('AI 분석 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
    }

    const outputTokenCap = Math.min(HWPX_UPLOAD_LIMITS.maxAiOutputTokens, remainingTokenBudget)

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_schema', json_schema: jsonSchema },
      temperature: 0,
      max_completion_tokens: outputTokenCap,
    })

    usage.callCount += 1
    usage.promptTokens += response.usage?.prompt_tokens ?? 0
    usage.completionTokens += response.usage?.completion_tokens ?? 0
    usage.totalTokens += response.usage?.total_tokens ?? 0

    if (usage.totalTokens > HWPX_UPLOAD_LIMITS.maxTotalTokens) {
      throw new Error('AI 분석 토큰 한도를 초과했습니다. 문서를 나누어 업로드해주세요.')
    }

    const content = response.choices[0]?.message?.content
    if (!content) {
      warnings.push(`chunk ${index + 1}: AI 응답이 비어 있습니다.`)
      continue
    }

    const parsed = HwpxAiResponseSchema.safeParse(JSON.parse(content))
    if (!parsed.success) {
      throw new Error(`AI 응답 형식이 올바르지 않습니다: ${parsed.error.message}`)
    }

    questions.push(...parsed.data.questions)
    warnings.push(...parsed.data.warnings)
  }

  return { questions, warnings, usage }
}
