import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AIGenerationService } from '@/lib/ai'
import { AIProvider } from '@/lib/ai/types'
import { CreditService } from '@/lib/credits'
import { randomUUID } from 'crypto'
import { resolveGenerateWorkspaceSubject } from '@/app/(dashboard)/generate/workspace-subject'

export const dynamic = 'force-dynamic'

const COST_PER_GENERATION = 100
const CREDIT_BALANCE_HEADER = 'x-credit-balance'

const GenerateRequestSchema = z.object({
  passage: z.string().max(3500, 'Passage must be under 3500 characters'), // increased for buffer, UI enforces 3000
  gradeLevel: z.string(),
  difficulty: z.string(),
  problemTypeId: z.string().uuid(),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
})

const toNumberHeader = (value: number | null | undefined) => {
  if (!Number.isFinite(value)) return undefined
  return String(value)
}

const jsonWithBalance = (
  body: Record<string, unknown>,
  status: number,
  balance?: number | null
) =>
  NextResponse.json(body, {
    status,
    headers: balance !== undefined && balance !== null && Number.isFinite(balance)
      ? { [CREDIT_BALANCE_HEADER]: String(balance) }
      : undefined
  })

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return '알 수 없는 오류'
}

const getCurrentBalance = async (userId: string): Promise<number | undefined> => {
  try {
    return await CreditService.getBalance(userId)
  } catch {
    return undefined
  }
}

const isCancellationError = (error: unknown, requestCancelled: boolean) => {
  if (requestCancelled) return true
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.message === 'Generation cancelled') return true
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: unknown }).code === 'GENERATION_CANCELLED'
  }
  return false
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()

  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return jsonWithBalance(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Please login first' } },
      401
    )
  }

  const isCancelled = () => request.signal.aborted

  const generationRequestId = randomUUID()
  let deductionResult: { newBalance: number; consumptions: Array<{ sourceId: string; amount: number }> } | null = null
  let balanceBeforeGeneration = await getCurrentBalance(user.id)

  const rollbackGenerationCredit = async () => {
    if (!deductionResult) return await getCurrentBalance(user.id)
    try {
      if (balanceBeforeGeneration === undefined) {
        balanceBeforeGeneration = await getCurrentBalance(user.id)
      }
      return await CreditService.refundCredits(
        user.id,
        COST_PER_GENERATION,
        'ai_generation',
        generationRequestId,
        'AI 문제 생성 취소 또는 실패 환불',
        deductionResult.consumptions,
        balanceBeforeGeneration
      )
    } catch (refundError) {
      console.error('Failed to rollback credits after generation failure:', refundError)
      return await getCurrentBalance(user.id)
    }
  }

  try {
    // 2. Validation
    let body: unknown

    try {
      body = await request.json()
    } catch {
      return jsonWithBalance(
        { success: false, error: { code: 'INVALID_INPUT', message: '요청 바디 파싱에 실패했습니다.' } },
        400
      )
    }

    const validation = GenerateRequestSchema.safeParse(body)

    if (!validation.success) {
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: validation.error.issues?.[0]?.message || 'Validation failed' }
        },
        400
      )
    }

    const { passage, gradeLevel, difficulty, problemTypeId } = validation.data
    const workspaceSubject = resolveGenerateWorkspaceSubject({
      workspaceSubject: validation.data.workspaceSubject,
      referer: request.headers.get('referer'),
    })

    // 3. Fetch Problem Type
    const { data: problemType, error: dbError } = await supabase
      .from('problem_types')
      .select('*')
      .eq('id', problemTypeId)
      .eq('workspace_subject', workspaceSubject)
      .single()

    if (dbError || !problemType) {
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Problem type not found' }
        },
        404
      )
    }

    if (!problemType.is_active) {
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'INACTIVE_TYPE', message: 'This problem type is currently inactive' }
        },
        400
      )
    }

    const preBalance = balanceBeforeGeneration
    if (preBalance === undefined || preBalance < COST_PER_GENERATION) {
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'INSUFFICIENT_CREDITS', message: '크레딧이 부족합니다.' }
        },
        402,
        preBalance
      )
    }

    if (isCancelled()) {
      const currentBalance = await getCurrentBalance(user.id)
      return jsonWithBalance(
        { success: false, error: { code: 'GENERATION_CANCELLED', message: '문제 생성이 중단되었습니다.' } },
        408,
        currentBalance
      )
    }

    // 4. Construct Prompt
    const getGradeLevelKorean = (grade: string): string => {
      const gradeMap: { [key: string]: string } = {
        '고1': '고등학교 1학년',
        'High1': '고등학교 1학년',
        '고2': '고등학교 2학년',
        'High2': '고등학교 2학년',
        '고3': '고등학교 3학년',
        'High3': '고등학교 3학년',
        '중1': '중학교 1학년',
        'Middle1': '중학교 1학년',
        '중2': '중학교 2학년',
        'Middle2': '중학교 2학년',
        '중3': '중학교 3학년',
        'Middle3': '중학교 3학년'
      }
      return gradeMap[grade] || grade
    }

    // Helper function to convert difficulty to Korean
    const getDifficultyKorean = (diff: string): string => {
      const diffMap: { [key: string]: string } = {
        '상': '상',
        'High': '상',
        '중': '중',
        'Medium': '중',
        '하': '하',
        'Low': '하'
      }
      return diffMap[diff] || diff
    }

    const gradeLevelKorean = getGradeLevelKorean(gradeLevel)
    const difficultyKorean = getDifficultyKorean(difficulty)

    const prompt = `
================================================================================
📝 PROMPT TEMPLATE 시작
================================================================================

${problemType.prompt_template}

================================================================================
📝 PROMPT TEMPLATE 끝
================================================================================

위 PROMPT TEMPLATE 규칙을 적용해서 아래에 입력된 지문에 대한 문제, 보기, 답안, 해설을 만들어줘.

【문제 생성 조건】
- 학년의 난이도는 대한민국의 ${gradeLevelKorean} 수준이야.
- 문제의 난이도는 위에서 설정한 학년의 수준에서 상, 중, 하 중 ${difficultyKorean}의 난이도로 설정해줘.

【지문】
${passage}
`

    const result = await AIGenerationService.generate({
      provider: problemType.provider as AIProvider,
      modelName: problemType.model_name,
      prompt,
      maxTokens: 16000,
      temperature: 0.7,
      signal: request.signal
    })

    if (isCancelled()) {
      const currentBalance = await getCurrentBalance(user.id)
      return jsonWithBalance(
        { success: false, error: { code: 'GENERATION_CANCELLED', message: '문제 생성이 중단되었습니다.' } },
        408,
        currentBalance
      )
    }

    if (!result.success) {
      console.error('AI Generation Error:', result.error, result.rawResponse)
      const currentBalance = await getCurrentBalance(user.id)
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'AI_ERROR', message: 'AI 문제 생성 중 오류가 발생했습니다.' }
        },
        500,
        currentBalance
      )
    }

    // 6. Deduct credits only after AI generation succeeds
    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        COST_PER_GENERATION,
        'ai_generation',
        generationRequestId,
        `AI 문제 생성 (${problemType.type_name})`
      )
      if (isCancelled()) {
        const rolledBackBalance = await rollbackGenerationCredit()
        return jsonWithBalance(
          {
            success: false,
            error: { code: 'GENERATION_CANCELLED', message: '문제 생성이 중단되었습니다.' }
          },
          408,
          rolledBackBalance
        )
      }
    } catch (error: unknown) {
      const currentBalance = await getCurrentBalance(user.id)
      return jsonWithBalance(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: getErrorMessage(error) || '크레딧이 부족합니다.'
          }
        },
        402,
        currentBalance
      )
    }

    // 6. Return Result
    const consumedBalance = deductionResult.newBalance
    return jsonWithBalance(
      {
        success: true,
        data: result.data,
        rawAiResponse: result.rawResponse
      },
      200,
      consumedBalance
    )
  } catch (error: unknown) {
    const isCancelledError = isCancellationError(error, request.signal.aborted)
    const currentBalance = deductionResult
      ? await rollbackGenerationCredit()
      : await getCurrentBalance(user.id)

    console.error('Generation API Error:', error)
    return jsonWithBalance(
      {
        success: false,
        error: { code: isCancelledError ? 'GENERATION_CANCELLED' : 'INTERNAL_SERVER_ERROR', message: isCancelledError ? '문제 생성이 중단되었습니다.' : 'An unexpected error occurred' }
      },
      isCancelledError ? 408 : 500,
      currentBalance
    )
  }
}
