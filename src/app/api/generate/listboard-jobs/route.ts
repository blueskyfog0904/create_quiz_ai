import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { CreditService } from '@/lib/credits'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { TablesInsert } from '@/types/supabase'
import { AIGenerationService } from '@/lib/ai'
import type { AIProvider } from '@/lib/ai/types'
import { stagedGeneratedQuestionToJson } from '@/lib/questions/generated-question-staging'

export const dynamic = 'force-dynamic'

const COST_PER_GENERATION = 100

const CreateListboardJobSchema = z.object({
  postId: z.string().uuid(),
  postItemIds: z.array(z.string().uuid()).min(1),
  problemTypeIds: z.array(z.string().uuid()).min(1),
  gradeLevel: z.string().min(1),
  difficulty: z.string().min(1),
})

const unique = (values: string[]) => Array.from(new Set(values))

const getGradeLevelKorean = (grade: string): string => {
  const gradeMap: Record<string, string> = {
    '1학년': '고등학교 1학년',
    '고1': '고등학교 1학년',
    'High1': '고등학교 1학년',
    '2학년': '고등학교 2학년',
    '고2': '고등학교 2학년',
    'High2': '고등학교 2학년',
    '3학년': '고등학교 3학년',
    '고3': '고등학교 3학년',
    'High3': '고등학교 3학년',
  }
  return gradeMap[grade] ?? grade
}

const getDifficultyKorean = (difficulty: string): string => {
  const diffMap: Record<string, string> = {
    Low: '하',
    Medium: '중',
    High: '상',
    하: '하',
    중: '중',
    상: '상',
  }
  return diffMap[difficulty] ?? difficulty
}

const buildPrompt = (promptTemplate: string, passage: string, gradeLevel: string, difficulty: string) => `
================================================================================
📝 PROMPT TEMPLATE 시작
================================================================================

${promptTemplate}

================================================================================
📝 PROMPT TEMPLATE 끝
================================================================================

위 PROMPT TEMPLATE 규칙을 적용해서 아래에 입력된 지문에 대한 문제, 보기, 답안, 해설을 만들어줘.

【문제 생성 조건】
- 학년의 난이도는 대한민국의 ${getGradeLevelKorean(gradeLevel)} 수준이야.
- 문제의 난이도는 위에서 설정한 학년의 수준에서 상, 중, 하 중 ${getDifficultyKorean(difficulty)}의 난이도로 설정해줘.

【지문】
${passage}
`

const getRefundConsumptions = (
  consumptions: Array<{ sourceId: string; amount: number }>,
  refundAmount: number
) => {
  let remaining = refundAmount

  return consumptions
    .map((consumption) => {
      if (remaining <= 0) {
        return null
      }

      const amount = Math.min(consumption.amount, remaining)
      remaining -= amount

      return amount > 0 ? {
        sourceId: consumption.sourceId,
        amount,
      } : null
    })
    .filter((consumption): consumption is { sourceId: string; amount: number } => consumption !== null)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()
  let jobId: string | null = null
  let jobTitle = ''
  let requestedGenerationCount = 0
  let completedCount = 0
  let deductionResult: Awaited<ReturnType<typeof CreditService.deductCredits>> | null = null

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  try {
    const body = await request.json()
    const validation = CreateListboardJobSchema.safeParse(body)

    if (!validation.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: validation.error.issues[0]?.message || '입력이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const postItemIds = unique(validation.data.postItemIds)
    const problemTypeIds = unique(validation.data.problemTypeIds)

    const { data: post, error: postError } = await supabase
      .from('generate_listboard_posts')
      .select('id, title, grade_level')
      .eq('id', validation.data.postId)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle()

    if (postError || !post) {
      return NextResponse.json({
        success: false,
        error: { code: 'NOT_FOUND', message: '게시글을 찾을 수 없습니다.' },
      }, { status: 404 })
    }

    const { data: postItems, error: itemsError } = await supabase
      .from('generate_listboard_post_items')
      .select('id, question_number, passage_text')
      .eq('post_id', post.id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('id', postItemIds)

    if (itemsError) {
      throw new Error(itemsError.message)
    }

    if ((postItems ?? []).length !== postItemIds.length) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_ITEMS', message: '선택한 문항 중 사용할 수 없는 항목이 있습니다.' },
      }, { status: 400 })
    }

    const { data: problemTypes, error: problemTypesError } = await supabase
      .from('problem_types')
      .select('*')
      .eq('is_active', true)
      .neq('model_name', 'admin')
      .in('id', problemTypeIds)

    if (problemTypesError) {
      throw new Error(problemTypesError.message)
    }

    if ((problemTypes ?? []).length !== problemTypeIds.length) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_TYPES', message: '선택한 문제 유형 중 사용할 수 없는 항목이 있습니다.' },
      }, { status: 400 })
    }

    const requestedItemCount = postItemIds.length
    const requestedTypeCount = problemTypeIds.length
    requestedGenerationCount = requestedItemCount * requestedTypeCount
    const requiredCredits = requestedGenerationCount * COST_PER_GENERATION
    const currentBalance = await CreditService.getBalance(user.id)
    const gradeLevel = validation.data.gradeLevel || post.grade_level || '1학년'
    const difficulty = validation.data.difficulty

    if (currentBalance < requiredCredits) {
      return NextResponse.json({
        success: false,
        error: { code: 'INSUFFICIENT_CREDITS', message: '크레딧이 부족합니다.' },
      }, { status: 402 })
    }

    const jobPayload: TablesInsert<'generate_listboard_generation_jobs'> = {
      post_id: post.id,
      user_id: user.id,
      status: 'running',
      grade_level: gradeLevel,
      difficulty,
      selected_problem_type_ids: problemTypeIds,
      requested_item_count: requestedItemCount,
      requested_type_count: requestedTypeCount,
      requested_generation_count: requestedGenerationCount,
      completed_count: 0,
      failed_count: 0,
      cancelled_count: 0,
      credit_reserved: requiredCredits,
      credit_charged: 0,
    }

    const { data: job, error: jobError } = await adminSupabase
      .from('generate_listboard_generation_jobs')
      .insert(jobPayload)
      .select('*')
      .single()

    if (jobError || !job) {
      throw new Error(jobError?.message || '배치 생성 작업 생성에 실패했습니다.')
    }
    jobId = job.id
    jobTitle = post.title

    const jobItemsPayload: TablesInsert<'generate_listboard_generation_job_items'>[] = postItemIds.flatMap((postItemId) => (
      problemTypeIds.map((problemTypeId) => ({
        job_id: job.id,
        post_id: post.id,
        post_item_id: postItemId,
        problem_type_id: problemTypeId,
        status: 'queued',
        credit_charged: 0,
        attempt_count: 0,
      }))
    ))

    const { data: jobItems, error: jobItemsError } = await adminSupabase
      .from('generate_listboard_generation_job_items')
      .insert(jobItemsPayload)
      .select('*')

    if (jobItemsError || !jobItems) {
      await adminSupabase
        .from('generate_listboard_generation_jobs')
        .delete()
        .eq('id', job.id)

      throw new Error(jobItemsError?.message || '작업 항목 생성에 실패했습니다.')
    }

    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        requiredCredits,
        'listboard_batch_generation',
        job.id,
        `리스트보드 배치 생성 (${post.title})`
      )
    } catch (error) {
      await adminSupabase
        .from('generate_listboard_generation_jobs')
        .delete()
        .eq('id', job.id)

      return NextResponse.json({
        success: false,
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: error instanceof Error ? error.message : '크레딧이 부족합니다.',
        },
      }, { status: 402 })
    }

    await adminSupabase
      .from('generate_listboard_generation_jobs')
      .update({
        credit_reserved: requiredCredits,
        started_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    const postItemMap = new Map((postItems ?? []).map((item) => [item.id, item]))
    const problemTypeMap = new Map((problemTypes ?? []).map((type) => [type.id, type]))

    let failedCount = 0

    for (const jobItem of jobItems) {
      const postItem = postItemMap.get(jobItem.post_item_id)
      const problemType = problemTypeMap.get(jobItem.problem_type_id)

      if (!postItem || !problemType) {
        failedCount += 1
        await adminSupabase
          .from('generate_listboard_generation_job_items')
          .update({
            status: 'failed',
            error_code: 'MISSING_REFERENCE',
            error_message: '문항 또는 문제 유형 정보를 찾지 못했습니다.',
            attempt_count: (jobItem.attempt_count ?? 0) + 1,
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobItem.id)
        continue
      }

      await adminSupabase
        .from('generate_listboard_generation_job_items')
        .update({
          status: 'running',
          started_at: new Date().toISOString(),
          attempt_count: (jobItem.attempt_count ?? 0) + 1,
        })
        .eq('id', jobItem.id)

      try {
        const result = await AIGenerationService.generate({
          provider: problemType.provider as AIProvider,
          modelName: problemType.model_name,
          prompt: buildPrompt(problemType.prompt_template, postItem.passage_text, gradeLevel, difficulty),
          maxTokens: 16000,
          temperature: 0.7,
        })

        if (!result.success || !result.data) {
          throw new Error(result.error || 'AI 문제 생성에 실패했습니다.')
        }

        completedCount += 1
        await adminSupabase
          .from('generate_listboard_generation_job_items')
          .update({
            status: 'completed',
            generated_question: stagedGeneratedQuestionToJson(result.data),
            raw_ai_response: result.rawResponse ?? null,
            question_id: null,
            save_status: 'unsaved',
            saved_at: null,
            save_error_message: null,
            credit_charged: COST_PER_GENERATION,
            error_code: null,
            error_message: null,
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobItem.id)
      } catch (error) {
        failedCount += 1
        await adminSupabase
          .from('generate_listboard_generation_job_items')
          .update({
            status: 'failed',
            generated_question: null,
            raw_ai_response: null,
            save_status: 'unsaved',
            saved_at: null,
            save_error_message: null,
            error_code: 'GENERATION_FAILED',
            error_message: error instanceof Error ? error.message : 'AI 문제 생성 중 오류가 발생했습니다.',
            finished_at: new Date().toISOString(),
          })
          .eq('id', jobItem.id)
      }
    }

    const failedRefundAmount = failedCount * COST_PER_GENERATION
    let finalBalance = deductionResult.newBalance

    if (failedRefundAmount > 0) {
      finalBalance = await CreditService.refundCredits(
        user.id,
        failedRefundAmount,
        'listboard_batch_generation_refund',
        job.id,
        `리스트보드 배치 생성 실패 환불 (${post.title})`,
        getRefundConsumptions(deductionResult.consumptions, failedRefundAmount)
      )
    }

    const finalStatus = completedCount === requestedGenerationCount
      ? 'completed'
      : completedCount > 0
        ? 'partially_completed'
        : 'failed'

    await adminSupabase
      .from('generate_listboard_generation_jobs')
      .update({
        status: finalStatus,
        completed_count: completedCount,
        failed_count: failedCount,
        cancelled_count: 0,
        credit_charged: completedCount * COST_PER_GENERATION,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        requestedGenerationCount,
        requiredCredits,
        postTitle: post.title,
        status: finalStatus,
        balance: finalBalance,
      },
    })
  } catch (error) {
    if (jobId) {
      const refundAmount = deductionResult
        ? Math.max((requestedGenerationCount - completedCount) * COST_PER_GENERATION, 0)
        : 0

      if (deductionResult && refundAmount > 0) {
        await CreditService.refundCredits(
          user.id,
          refundAmount,
          'listboard_batch_generation_refund',
          jobId,
          `리스트보드 배치 생성 예외 환불 (${jobTitle || 'job'})`,
          getRefundConsumptions(deductionResult.consumptions, refundAmount)
        )
      }

      await adminSupabase
        .from('generate_listboard_generation_jobs')
        .update({
          status: completedCount > 0 ? 'partially_completed' : 'failed',
          completed_count: completedCount,
          failed_count: Math.max(requestedGenerationCount - completedCount, 0),
          cancelled_count: 0,
          credit_charged: completedCount * COST_PER_GENERATION,
          finished_at: new Date().toISOString(),
        })
        .eq('id', jobId)
    }

    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '배치 생성 작업 생성 중 오류가 발생했습니다.',
      },
    }, { status: 500 })
  }
}
