import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CreditService } from '@/lib/credits'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot, type CreditBalanceSnapshot } from '@/lib/credit-balance'
import { randomUUID } from 'crypto'
import { resolveGenerateWorkspaceSubject } from '@/app/(dashboard)/generate/workspace-subject'
import {
  DEFAULT_MAX_REVIEW_ATTEMPTS,
  buildQuestionGenerationConfigFromProblemType,
  runQuestionGenerationReviewLoop,
} from '@/lib/ai/question-generation-workflow'

export const dynamic = 'force-dynamic'

const COST_PER_GENERATION = 100
const CREDIT_BALANCE_HEADER = 'x-credit-balance'

const GenerateRequestSchema = z.object({
  passage: z.string().max(3500, 'Passage must be under 3500 characters'),
  problemTypeId: z.string().uuid(),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
  includeTrace: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(5).optional(),
})

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

const jsonWithBalanceSnapshot = (
  body: Record<string, unknown>,
  status: number,
  snapshot?: CreditBalanceSnapshot | null
) =>
  NextResponse.json(snapshot ? {
    ...body,
    ...buildCreditBalanceResponseFields(snapshot),
  } : body, {
    status,
    headers: snapshot
      ? { [CREDIT_BALANCE_HEADER]: String(snapshot.displayBalance) }
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

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return jsonWithBalance(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Please login first' } },
      401
    )
  }

  const isCancelled = () => request.signal.aborted
  const getCurrentSnapshot = async () => {
    try {
      return await getCreditBalanceSnapshot(user.id, supabase)
    } catch {
      return null
    }
  }

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
    let body: unknown

    try {
      body = await request.json()
    } catch {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: '요청 바디 파싱에 실패했습니다.' },
          ...(snapshot ? buildCreditBalanceResponseFields(snapshot) : {}),
        },
        400
      )
    }

    const validation = GenerateRequestSchema.safeParse(body)

    if (!validation.success) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'INVALID_INPUT', message: validation.error.issues?.[0]?.message || 'Validation failed' },
          ...(snapshot ? buildCreditBalanceResponseFields(snapshot) : {}),
        },
        400
      )
    }

    const { passage, problemTypeId } = validation.data
    const workspaceSubject = resolveGenerateWorkspaceSubject({
      workspaceSubject: validation.data.workspaceSubject,
      referer: request.headers.get('referer'),
    })

    const { data: problemType, error: dbError } = await supabase
      .from('problem_types')
      .select('*')
      .eq('id', problemTypeId)
      .eq('workspace_subject', workspaceSubject)
      .single()

    if (dbError || !problemType) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Problem type not found' },
          ...(snapshot ? buildCreditBalanceResponseFields(snapshot) : {}),
        },
        404
      )
    }

    if (!problemType.is_active) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'INACTIVE_TYPE', message: 'This problem type is currently inactive' },
          ...(snapshot ? buildCreditBalanceResponseFields(snapshot) : {}),
        },
        400
      )
    }

    const generationConfig = buildQuestionGenerationConfigFromProblemType(problemType)
    if (!generationConfig.modelConfig) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot(
        {
          success: false,
          error: {
            code: generationConfig.error?.code || 'REVIEW_MODEL_NOT_CONFIGURED',
            message: generationConfig.error?.message || '문제 검토 API 제공자와 모델을 먼저 설정해주세요.',
          },
        },
        409,
        snapshot
      )
    }

    const preBalance = balanceBeforeGeneration
    if (preBalance === undefined || preBalance < COST_PER_GENERATION) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalance(
        {
          success: false,
          error: { code: 'INSUFFICIENT_CREDITS', message: '크레딧이 부족합니다.' },
          ...(snapshot ? buildCreditBalanceResponseFields(snapshot) : {}),
        },
        402,
        preBalance
      )
    }

    if (isCancelled()) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot(
        { success: false, error: { code: 'GENERATION_CANCELLED', message: '문제 생성이 중단되었습니다.' } },
        408,
        snapshot
      )
    }

    const loopResult = await runQuestionGenerationReviewLoop({
      passage,
      workspaceSubject,
      promptBundle: generationConfig.promptBundle,
      modelConfig: generationConfig.modelConfig,
      maxAttempts: DEFAULT_MAX_REVIEW_ATTEMPTS,
      includeTrace: false,
      traceMode: 'none',
      signal: request.signal,
    })

    if (isCancelled()) {
      const currentBalance = await getCurrentBalance(user.id)
      return jsonWithBalance(
        { success: false, error: { code: 'GENERATION_CANCELLED', message: '문제 생성이 중단되었습니다.' } },
        408,
        currentBalance
      )
    }

    if (loopResult.status !== 'passed' || !loopResult.finalQuestion) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot(
        {
          success: false,
          status: loopResult.status,
          stopReason: loopResult.stopReason,
          error: { code: 'AI_REVIEW_FAILED', message: 'AI 문제 검토를 통과하지 못했습니다.' }
        },
        500,
        snapshot
      )
    }

    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        COST_PER_GENERATION,
        'ai_generation',
        generationRequestId,
        `AI 문제 생성 (${problemType.type_name})`
      )
      if (isCancelled()) {
        await rollbackGenerationCredit()
        const snapshot = await getCurrentSnapshot()
        return jsonWithBalanceSnapshot(
          {
            success: false,
            error: { code: 'GENERATION_CANCELLED', message: '문제 생성이 중단되었습니다.' }
          },
          408,
          snapshot
        )
      }
    } catch (error: unknown) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot(
        {
          success: false,
          error: {
            code: 'INSUFFICIENT_CREDITS',
            message: getErrorMessage(error) || '크레딧이 부족합니다.'
          }
        },
        402,
        snapshot
      )
    }

    const snapshot = await getCurrentSnapshot()
    return jsonWithBalanceSnapshot(
      {
        success: true,
        data: loopResult.finalQuestion,
        rawAiResponse: loopResult.rawGenerationResponse,
        review: loopResult.finalReview,
        status: loopResult.status,
        stopReason: loopResult.stopReason,
      },
      200,
      snapshot
    )
  } catch (error: unknown) {
    const isCancelledError = isCancellationError(error, request.signal.aborted)
    if (deductionResult) {
      await rollbackGenerationCredit()
    }
    const snapshot = await getCurrentSnapshot()

    console.error('Generation API Error:', error)
    return jsonWithBalanceSnapshot(
      {
        success: false,
        error: { code: isCancelledError ? 'GENERATION_CANCELLED' : 'INTERNAL_SERVER_ERROR', message: isCancelledError ? '문제 생성이 중단되었습니다.' : 'An unexpected error occurred' }
      },
      isCancelledError ? 408 : 500,
      snapshot
    )
  }
}
