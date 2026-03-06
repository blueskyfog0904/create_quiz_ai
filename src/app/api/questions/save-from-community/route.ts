import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { CreditService } from '@/lib/credits'

const COST_PER_IMPORT = 100
const CREDIT_BALANCE_HEADER = 'x-credit-balance'

const saveQuestionSchema = z.object({
  question_id: z.string().uuid('Invalid question ID'),
})

const bulkSaveQuestionsSchema = z.object({
  question_ids: z.array(z.string().uuid('Invalid question ID')),
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

const getBalance = async (userId: string): Promise<number> => {
  try {
    return await CreditService.getBalance(userId)
  } catch {
    return 0
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let deductionResult: { newBalance: number; consumptions: Array<{ sourceId: string; amount: number }> } | null = null
  let targetQuestionId: string | null = null

  const rollbackIfNeeded = async () => {
    if (!deductionResult || !targetQuestionId) return

    try {
      return await CreditService.refundCredits(
        user.id,
        COST_PER_IMPORT,
        'question_import',
        targetQuestionId,
        '커뮤니티 문제 가져오기 실패 롤백',
        deductionResult.consumptions
      )
    } catch (refundError) {
      console.error('[Save from Community] Failed to refund:', refundError)
      return
    } finally {
      deductionResult = null
    }
  }

  try {
    const body = await request.json()
    const { question_id } = saveQuestionSchema.parse(body)
    targetQuestionId = question_id

    // 3. Fetch the original question
    const { data: originalQuestion, error: fetchError } = await supabase
      .from('questions')
      .select('*')
      .eq('id', question_id)
      .eq('source', 'admin_uploaded')
      .single()

    if (fetchError || !originalQuestion) {
      console.error('[Save from Community] Question not found:', fetchError)
      return NextResponse.json({ error: 'Question not found' }, { status: 404 })
    }

    // 4. Check for duplicate (already saved by this user)
    const { data: existingQuestion } = await supabase
      .from('questions')
      .select('id')
      .eq('user_id', user.id)
      .eq('shared_question_id', question_id)
      .single()

    if (existingQuestion) {
      return NextResponse.json({
        error: '이미 저장된 문제입니다.'
      }, { status: 400 })
    }

    // 4.5 Deduct Credits (FIFO 방식)
    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        COST_PER_IMPORT,
        'question_import',
        question_id,
        '커뮤니티 문제 가져오기'
      )
    } catch (error: unknown) {
      const currentBalance = await getBalance(user.id)
      return jsonWithBalance(
        {
          error: error instanceof Error ? error.message : '크레딧이 부족합니다.'
        },
        402,
        currentBalance
      )
    }

    const { data: newQuestion, error: insertError } = await supabase
      .from('questions')
      .insert({
        question_text: originalQuestion.question_text,
        question_text_forward: originalQuestion.question_text_forward,
        question_text_backward: originalQuestion.question_text_backward,
        passage_text: originalQuestion.passage_text,
        answer: originalQuestion.answer,
        choices: originalQuestion.choices,
        explanation: originalQuestion.explanation,
        difficulty: originalQuestion.difficulty,
        grade_level: originalQuestion.grade_level,
        problem_type_id: originalQuestion.problem_type_id,
        user_id: user.id,
        source: 'from_community',
        shared_question_id: question_id,
        raw_ai_response: null,
        // Copy source information from community question
        source_type: originalQuestion.source_type,
        source_1: originalQuestion.source_1,
        source_2: originalQuestion.source_2,
        source_3: originalQuestion.source_3,
        source_4: originalQuestion.source_4,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[Save from Community] Insert error:', insertError)
      const rolledBackBalance = await rollbackIfNeeded()
      const fallbackBalance = rolledBackBalance ??
        (deductionResult ? deductionResult.newBalance : await getBalance(user.id))
      return jsonWithBalance({ error: 'Failed to save question' }, 500, fallbackBalance)
    }

    const finalBalance = deductionResult?.newBalance
    deductionResult = null

    return jsonWithBalance({
      success: true,
      question: newQuestion
    }, 201, finalBalance)

  } catch (error) {
    const rolledBackBalance = await rollbackIfNeeded()
    const balanceFromRollback = rolledBackBalance ??
      (deductionResult ? deductionResult.newBalance : await getBalance(user.id))

    console.error('[Save from Community] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    return jsonWithBalance(
      {
        error: 'Internal server error'
      },
      500,
      balanceFromRollback
    )
  }
}

export async function PUT(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let deductionResult: { newBalance: number; consumptions: Array<{ sourceId: string; amount: number }> } | null = null
  let targetQuestionIds: string[] = []

  const rollbackIfNeeded = async () => {
    if (!deductionResult || targetQuestionIds.length === 0) return

    try {
      return await CreditService.refundCredits(
        user.id,
        COST_PER_IMPORT * targetQuestionIds.length,
        'question_import',
        null,
        `커뮤니티 문제 ${targetQuestionIds.length}개 가져오기 실패 롤백`,
        deductionResult.consumptions
      )
    } catch (refundError) {
      console.error('[Bulk Save from Community] Failed to refund:', refundError)
      return
    } finally {
      deductionResult = null
    }
  }

  try {
    const body = await request.json()
    const { question_ids } = bulkSaveQuestionsSchema.parse(body)

    if (question_ids.length === 0) {
      return NextResponse.json({ error: 'No questions selected' }, { status: 400 })
    }

    // 3. Fetch the original questions
    const { data: originalQuestions, error: fetchError } = await supabase
      .from('questions')
      .select('*')
      .in('id', question_ids)
      .eq('source', 'admin_uploaded')

    if (fetchError || !originalQuestions || originalQuestions.length === 0) {
      console.error('[Bulk Save from Community] Questions not found:', fetchError)
      return NextResponse.json({ error: 'Questions not found' }, { status: 404 })
    }

    // 4. Check for duplicates (already saved by this user)
    const { data: existingQuestions } = await supabase
      .from('questions')
      .select('shared_question_id')
      .eq('user_id', user.id)
      .in('shared_question_id', question_ids)

    const existingIds = new Set(existingQuestions?.map(q => q.shared_question_id) || [])
    const questionsToSave = originalQuestions.filter(q => !existingIds.has(q.id))

    if (questionsToSave.length === 0) {
      return NextResponse.json({
        error: '선택한 모든 문제가 이미 저장되어 있습니다.'
      }, { status: 400 })
    }

    // 4.5 Deduct Credits (Bulk, FIFO 방식)
    const totalCost = questionsToSave.length * COST_PER_IMPORT
    targetQuestionIds = questionsToSave.map(question => question.id)
    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        totalCost,
        'question_import',
        null,
        `커뮤니티 문제 ${questionsToSave.length}개 가져오기`
      )
    } catch (error: unknown) {
      const currentBalance = await getBalance(user.id)
      return jsonWithBalance({
        error: error instanceof Error ? error.message : `크레딧이 부족합니다. (필요: ${totalCost} C)`
      }, 402, currentBalance)
    }

    // 5. Create copies in the user's question bank
    const questionsToInsert = questionsToSave.map(originalQuestion => ({
      question_text: originalQuestion.question_text,
      question_text_forward: originalQuestion.question_text_forward,
      question_text_backward: originalQuestion.question_text_backward,
      passage_text: originalQuestion.passage_text,
      answer: originalQuestion.answer,
      choices: originalQuestion.choices,
      explanation: originalQuestion.explanation,
      difficulty: originalQuestion.difficulty,
      grade_level: originalQuestion.grade_level,
      problem_type_id: originalQuestion.problem_type_id,
      user_id: user.id,
      source: 'from_community',
      shared_question_id: originalQuestion.id,
      raw_ai_response: null,
      // Copy source information from community question
      source_type: originalQuestion.source_type,
      source_1: originalQuestion.source_1,
      source_2: originalQuestion.source_2,
      source_3: originalQuestion.source_3,
      source_4: originalQuestion.source_4,
    }))

    const { data: newQuestions, error: insertError } = await supabase
      .from('questions')
      .insert(questionsToInsert)
      .select()

    if (insertError) {
      console.error('[Bulk Save from Community] Insert error:', insertError)
      const rolledBackBalance = await rollbackIfNeeded()
      const fallbackBalance = rolledBackBalance ??
        (deductionResult ? deductionResult.newBalance : await getBalance(user.id))
      return jsonWithBalance({ error: 'Failed to save questions' }, 500, fallbackBalance)
    }

    const skippedCount = originalQuestions.length - questionsToSave.length
    const finalBalance = deductionResult?.newBalance
    deductionResult = null
    return jsonWithBalance({
      success: true,
      saved_count: newQuestions?.length || 0,
      skipped_count: skippedCount,
      questions: newQuestions
    }, 201, finalBalance)

  } catch (error) {
    const rolledBackBalance = await rollbackIfNeeded()
    const balanceFromRollback = rolledBackBalance ??
      (deductionResult ? deductionResult.newBalance : await getBalance(user.id))
    console.error('[Bulk Save from Community] Error:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: 'Validation failed',
        details: error.issues
      }, { status: 400 })
    }

    return jsonWithBalance(
      {
        error: 'Internal server error'
      },
      500,
      balanceFromRollback
    )
  }
}
