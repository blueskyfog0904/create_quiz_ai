import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { NextResponse } from 'next/server'
import { DEFAULT_WORKSPACE_SUBJECT } from '@/lib/workspace-subject'
import { z } from 'zod'
import { CreditService } from '@/lib/credits'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot, type CreditBalanceSnapshot } from '@/lib/credit-balance'

const COST_PER_IMPORT = 100
const CREDIT_BALANCE_HEADER = 'x-credit-balance'

// Copy parity is owned by copy_admin_questions_to_user_bank RPC for:
// question_text, question_text_forward, question_text_backward, choices, answer,
// explanation, passage_text, grade_level, difficulty, problem_type_id,
// source_type, source_1, source_2, source_3, source_4, tags, rating.

type DeductionResult = {
  newBalance: number
  consumptions: Array<{ sourceId: string; amount: number }>
}

type CopyAdminQuestionsRpcResult = {
  saved_count: number
  skipped_count: number
  saved_question_ids: string[]
}

type RpcError = {
  message?: string
  code?: string
}

const saveQuestionSchema = z.object({
  question_id: z.string().uuid('Invalid question ID'),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
})

const bulkSaveQuestionsSchema = z.object({
  question_ids: z.array(z.string().uuid('Invalid question ID')),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
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

const getRefundConsumptions = (
  consumptions: Array<{ sourceId: string; amount: number }>,
  refundAmount: number
) => {
  let remaining = refundAmount

  return [...consumptions]
    .reverse()
    .map((consumption) => {
      if (remaining <= 0) return null
      const amount = Math.min(consumption.amount, remaining)
      remaining -= amount
      return amount > 0 ? { sourceId: consumption.sourceId, amount } : null
    })
    .filter((consumption): consumption is { sourceId: string; amount: number } => consumption !== null)
    .reverse()
}

const getUniqueQuestionIds = (questionIds: string[]) => Array.from(new Set(questionIds))

const getTotalSkippedCount = (preflightSkippedCount: number, rpcSkippedCount: number) =>
  preflightSkippedCount + rpcSkippedCount

const getRpcErrorStatus = (error: RpcError | null | undefined) => {
  const message = error?.message ?? ''

  if (message.includes('AUTH_REQUIRED')) return 401
  if (
    message.includes('INVALID_SCOPE') ||
    message.includes('INVALID_SOURCE') ||
    message.includes('NO_METADATA') ||
    message.includes('DUPLICATE') ||
    error?.code === '23505' ||
    /duplicate|unique/i.test(message)
  ) return 400

  return 500
}

const getRpcErrorMessage = (error: RpcError | null | undefined, fallback: string) =>
  error?.message || fallback

const normalizeRpcResult = (data: unknown): CopyAdminQuestionsRpcResult => {
  const result = (Array.isArray(data) ? data[0] : data) as Partial<CopyAdminQuestionsRpcResult> | null | undefined

  return {
    saved_count: result?.saved_count ?? 0,
    skipped_count: result?.skipped_count ?? 0,
    saved_question_ids: Array.isArray(result?.saved_question_ids) ? result.saved_question_ids : [],
  }
}

const refundCreditsSafely = async (
  userId: string,
  amount: number,
  resourceType: string,
  resourceId: string | null,
  description: string,
  consumptions: Array<{ sourceId: string; amount: number }>
) => {
  try {
    await CreditService.refundCredits(
      userId,
      amount,
      resourceType,
      resourceId,
      description,
      consumptions
    )
    return true
  } catch (refundError) {
    console.error('[Save from Community] Failed to refund:', refundError)
    return false
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const getCurrentSnapshot = async () => {
    try {
      return await getCreditBalanceSnapshot(user.id, supabase)
    } catch {
      return null
    }
  }

  let deductionResult: DeductionResult | null = null
  let targetQuestionId: string | null = null

  const rollbackIfNeeded = async () => {
    if (!deductionResult || !targetQuestionId) return

    await refundCreditsSafely(
      user.id,
      COST_PER_IMPORT,
      'question_import',
      targetQuestionId,
      '커뮤니티 문제 가져오기 실패 롤백',
      deductionResult.consumptions
    )
    deductionResult = null
  }

  try {
    const body = await request.json()
    const { question_id, workspaceSubject = DEFAULT_WORKSPACE_SUBJECT } = saveQuestionSchema.parse(body)
    targetQuestionId = question_id

    // 1. Fetch the original admin question before charging.
    const { data: originalQuestion, error: fetchError } = await supabase
      .from('questions')
      .select('id')
      .eq('id', question_id)
      .eq('source', 'admin_uploaded')
      .eq('workspace_subject', workspaceSubject)
      .single()

    if (fetchError || !originalQuestion) {
      console.error('[Save from Community] Question not found:', fetchError)
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

    // 2. Optional fast duplicate preflight; RPC remains final truth after charge.
    const { data: existingQuestion } = await supabase
      .from('questions')
      .select('id')
      .eq('user_id', user.id)
      .eq('workspace_subject', workspaceSubject)
      .eq('shared_question_id', question_id)
      .single()

    if (existingQuestion) {
      return NextResponse.json({
        error: '이미 저장된 문제입니다.'
      }, { status: 400 })
    }

    const rpcClient = createAdminClient()

    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        COST_PER_IMPORT,
        'question_import',
        question_id,
        '커뮤니티 문제 가져오기'
      )
    } catch (error: unknown) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot(
        {
          error: error instanceof Error ? error.message : '크레딧이 부족합니다.'
        },
        402,
        snapshot
      )
    }

    const { data: rpcData, error: rpcError } = await rpcClient.rpc('copy_admin_questions_to_user_bank', {
      p_workspace_subject: workspaceSubject,
      p_admin_question_ids: [question_id],
      p_target_user_id: user.id,
    })

    if (rpcError) {
      try {
        await CreditService.refundCredits(
          user.id,
          COST_PER_IMPORT,
          'question_import',
          question_id,
          '커뮤니티 문제 가져오기 실패 롤백',
          deductionResult.consumptions
        )
      } catch (refundError) {
        console.error('[Save from Community] Failed to refund:', refundError)
      }
      deductionResult = null
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot(
        { error: getRpcErrorMessage(rpcError, 'Failed to save question') },
        getRpcErrorStatus(rpcError),
        snapshot
      )
    }

    const rpcResult = normalizeRpcResult(rpcData)
    const savedCount = rpcResult?.saved_count ?? 0
    const skippedCount = rpcResult?.skipped_count ?? 0
    const savedQuestionIds = rpcResult?.saved_question_ids ?? []
    const savedQuestionId = savedQuestionIds[0]

    if (savedCount === 0 || !savedQuestionId) {
      const duplicateMessage = skippedCount > 0 ? '이미 저장된 문제입니다.' : '문제를 저장하지 못했습니다.'
      try {
        await CreditService.refundCredits(
          user.id,
          COST_PER_IMPORT,
          'question_import',
          question_id,
          '커뮤니티 문제 가져오기 중복 환불',
          deductionResult.consumptions
        )
      } catch (refundError) {
        console.error('[Save from Community] Failed to refund:', refundError)
      }
      deductionResult = null
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot({ error: duplicateMessage }, 400, snapshot)
    }

    deductionResult = null

    const { data: newQuestion, error: selectError } = await supabase
      .from('questions')
      .select('*')
      .eq('id', savedQuestionId)
      .single()

    const snapshot = await getCurrentSnapshot()

    if (selectError || !newQuestion) {
      console.error('[Save from Community] Saved question reselect error:', selectError)
      return jsonWithBalanceSnapshot({ error: 'Failed to load saved question' }, 500, snapshot)
    }

    return jsonWithBalanceSnapshot({
      success: true,
      question: newQuestion
    }, 201, snapshot)

  } catch (error) {
    await rollbackIfNeeded()
    const snapshot = await getCurrentSnapshot()

    console.error('[Save from Community] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    return jsonWithBalanceSnapshot(
      {
        error: 'Internal server error'
      },
      500,
      snapshot
    )
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const getCurrentSnapshot = async () => {
    try {
      return await getCreditBalanceSnapshot(user.id, supabase)
    } catch {
      return null
    }
  }

  let deductionResult: DeductionResult | null = null
  let targetQuestionIds: string[] = []
  let chargedCount = 0

  const rollbackIfNeeded = async () => {
    if (!deductionResult || chargedCount === 0) return

    await refundCreditsSafely(
      user.id,
      COST_PER_IMPORT * chargedCount,
      'question_import',
      null,
      `커뮤니티 문제 ${chargedCount}개 가져오기 실패 롤백`,
      deductionResult.consumptions
    )
    deductionResult = null
  }

  try {
    const body = await request.json()
    const { question_ids, workspaceSubject = DEFAULT_WORKSPACE_SUBJECT } = bulkSaveQuestionsSchema.parse(body)

    if (question_ids.length === 0) {
      return NextResponse.json({ error: 'No questions selected' }, { status: 400 })
    }

    const requestedQuestionIds = getUniqueQuestionIds(question_ids)

    // 1. Fetch original admin questions before charging.
    const { data: originalQuestions, error: fetchError } = await supabase
      .from('questions')
      .select('id')
      .in('id', requestedQuestionIds)
      .eq('source', 'admin_uploaded')
      .eq('workspace_subject', workspaceSubject)

    if (fetchError || !originalQuestions || originalQuestions.length === 0) {
      console.error('[Bulk Save from Community] Questions not found:', fetchError)
      return NextResponse.json({ error: 'Questions not found' }, { status: 404 })
    }

    // 2. Optional fast duplicate preflight for charge estimation only.
    const { data: existingQuestions } = await supabase
      .from('questions')
      .select('shared_question_id')
      .eq('user_id', user.id)
      .eq('workspace_subject', workspaceSubject)
      .in('shared_question_id', requestedQuestionIds)

    const existingIds = new Set(existingQuestions?.map(q => q.shared_question_id) || [])
    const originalIds = originalQuestions.map(question => question.id)
    targetQuestionIds = originalIds.filter(questionId => !existingIds.has(questionId))
    const preflightSkippedCount = originalIds.length - targetQuestionIds.length

    if (targetQuestionIds.length === 0) {
      return NextResponse.json({
        error: '선택한 모든 문제가 이미 저장되어 있습니다.'
      }, { status: 400 })
    }

    const rpcClient = createAdminClient()

    const totalCost = targetQuestionIds.length * COST_PER_IMPORT
    chargedCount = targetQuestionIds.length
    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        totalCost,
        'question_import',
        null,
        `커뮤니티 문제 ${targetQuestionIds.length}개 가져오기`
      )
    } catch (error: unknown) {
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot({
        error: error instanceof Error ? error.message : `크레딧이 부족합니다. (필요: ${totalCost} C)`
      }, 402, snapshot)
    }

    const { data: rpcData, error: rpcError } = await rpcClient.rpc('copy_admin_questions_to_user_bank', {
      p_workspace_subject: workspaceSubject,
      p_admin_question_ids: targetQuestionIds,
      p_target_user_id: user.id,
    })

    if (rpcError) {
      try {
        await CreditService.refundCredits(
          user.id,
          totalCost,
          'question_import',
          null,
          `커뮤니티 문제 ${chargedCount}개 가져오기 실패 롤백`,
          deductionResult.consumptions
        )
      } catch (refundError) {
        console.error('[Bulk Save from Community] Failed to refund:', refundError)
      }
      deductionResult = null
      const snapshot = await getCurrentSnapshot()
      return jsonWithBalanceSnapshot(
        { error: getRpcErrorMessage(rpcError, 'Failed to save questions') },
        getRpcErrorStatus(rpcError),
        snapshot
      )
    }

    const rpcResult = normalizeRpcResult(rpcData)
    const savedCount = rpcResult?.saved_count ?? 0
    const rpcSkippedCount = rpcResult?.skipped_count ?? 0
    const skippedCount = getTotalSkippedCount(preflightSkippedCount, rpcSkippedCount)
    const savedQuestionIds = rpcResult?.saved_question_ids ?? []

    if (savedCount < chargedCount) {
      const refundAmount = (chargedCount - savedCount) * COST_PER_IMPORT
      try {
        await CreditService.refundCredits(
          user.id,
          refundAmount,
          'question_import',
          null,
          `커뮤니티 문제 ${chargedCount - savedCount}개 중복 환불`,
          getRefundConsumptions(deductionResult.consumptions, refundAmount)
        )
      } catch (refundError) {
        console.error('[Bulk Save from Community] Failed to refund skipped questions:', refundError)
        deductionResult = null
        const snapshot = await getCurrentSnapshot()
        return jsonWithBalanceSnapshot({ error: 'Failed to refund skipped questions' }, 500, snapshot)
      }
    }

    deductionResult = null

    const { data: newQuestions, error: selectError } = savedQuestionIds.length > 0
      ? await supabase
        .from('questions')
        .select('*')
        .in('id', savedQuestionIds)
      : { data: [], error: null }

    const snapshot = await getCurrentSnapshot()

    if (selectError) {
      console.error('[Bulk Save from Community] Saved questions reselect error:', selectError)
      return jsonWithBalanceSnapshot({ error: 'Failed to load saved questions' }, 500, snapshot)
    }

    return jsonWithBalanceSnapshot({
      success: true,
      saved_count: savedCount,
      skipped_count: skippedCount,
      questions: newQuestions ?? [],
      saved_question_ids: savedQuestionIds,
    }, 201, snapshot)

  } catch (error) {
    await rollbackIfNeeded()
    const snapshot = await getCurrentSnapshot()
    console.error('[Bulk Save from Community] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    return jsonWithBalanceSnapshot(
      {
        error: 'Internal server error'
      },
      500,
      snapshot
    )
  }
}
