import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { CreditService } from '@/lib/credits'
import { AIGenerationService } from '@/lib/ai'
import type { AIProvider } from '@/lib/ai/types'
import { stagedGeneratedQuestionToJson } from '@/lib/questions/generated-question-staging'
import { resolveGenerateWorkspaceSubject } from '@/app/(dashboard)/generate/workspace-subject'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot } from '@/lib/credit-balance'

export const dynamic = 'force-dynamic'

const COST_PER_GENERATION = 100

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
      if (remaining <= 0) return null
      const amount = Math.min(consumption.amount, remaining)
      remaining -= amount
      return amount > 0 ? { sourceId: consumption.sourceId, amount } : null
    })
    .filter((consumption): consumption is { sourceId: string; amount: number } => consumption !== null)
}

interface RouteContext {
  params: Promise<{ jobId: string }>
}

export async function POST(request: Request, { params }: RouteContext) {
  const supabase = await createClient()
  const adminSupabase = createAdminClient()
  const { jobId } = await params
  const requestUrl = new URL(request.url)
  const workspaceSubject = resolveGenerateWorkspaceSubject({
    workspaceSubject: requestUrl.searchParams.get('workspaceSubject'),
    referer: request.headers.get('referer'),
  })

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const getSnapshot = async () => {
    try {
      return await getCreditBalanceSnapshot(user.id, supabase)
    } catch {
      return null
    }
  }

  const { data: job, error: jobError } = await supabase
    .from('generate_listboard_generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .eq('workspace_subject', workspaceSubject)
    .maybeSingle()

  if (jobError || !job) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '작업을 찾을 수 없습니다.' } }, { status: 404 })
  }

  const { data: claimedJobRows, error: claimJobError } = await adminSupabase
    .from('generate_listboard_generation_jobs')
    .update({
      status: 'running',
      finished_at: null,
    })
    .eq('id', job.id)
    .eq('workspace_subject', workspaceSubject)
    .neq('status', 'running')
    .select('id')

  if (claimJobError) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: claimJobError.message } }, { status: 500 })
  }

  if (!claimedJobRows || claimedJobRows.length === 0) {
    return NextResponse.json({ success: false, error: { code: 'JOB_BUSY', message: '이미 재시도 중인 작업입니다. 잠시 후 다시 시도해주세요.' } }, { status: 409 })
  }

  const { data: failedItems, error: failedItemsError } = await adminSupabase
    .from('generate_listboard_generation_job_items')
    .select('*')
    .eq('job_id', job.id)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'failed')
    .order('created_at')

  if (failedItemsError) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: failedItemsError.message } }, { status: 500 })
  }

  if (!failedItems || failedItems.length === 0) {
    await adminSupabase
      .from('generate_listboard_generation_jobs')
      .update({
        status: job.status,
      })
      .eq('id', job.id)
      .eq('workspace_subject', workspaceSubject)

    return NextResponse.json({ success: false, error: { code: 'NO_FAILED_ITEMS', message: '재시도할 실패 항목이 없습니다.' } }, { status: 400 })
  }

  const claimedItems = (await Promise.all(failedItems.map(async (item) => {
    const { data, error } = await adminSupabase
      .from('generate_listboard_generation_job_items')
      .update({
        status: 'running',
        started_at: new Date().toISOString(),
        finished_at: null,
      })
      .eq('id', item.id)
      .eq('workspace_subject', workspaceSubject)
      .eq('status', 'failed')
      .select('*')

    if (error) {
      throw new Error(error.message)
    }

    return (data ?? [])[0] ?? null
  }))).filter((item): item is NonNullable<typeof item> => item !== null)

  if (claimedItems.length === 0) {
    await adminSupabase
      .from('generate_listboard_generation_jobs')
      .update({
        status: job.status,
      })
      .eq('id', job.id)
      .eq('workspace_subject', workspaceSubject)

    return NextResponse.json({ success: false, error: { code: 'NO_FAILED_ITEMS', message: '이미 다른 요청에서 재시도 중입니다.' } }, { status: 409 })
  }

  const requiredCredits = claimedItems.length * COST_PER_GENERATION
  const currentBalance = await CreditService.getBalance(user.id)
  if (currentBalance < requiredCredits) {
    await adminSupabase
      .from('generate_listboard_generation_job_items')
      .update({
        status: 'failed',
        started_at: null,
      })
      .in('id', claimedItems.map((item) => item.id))
      .eq('workspace_subject', workspaceSubject)

    await adminSupabase
      .from('generate_listboard_generation_jobs')
      .update({
        status: job.status,
      })
      .eq('id', job.id)
      .eq('workspace_subject', workspaceSubject)

    const snapshot = await getSnapshot()
    return NextResponse.json(snapshot ? {
      success: false,
      error: { code: 'INSUFFICIENT_CREDITS', message: '크레딧이 부족합니다.' },
      ...buildCreditBalanceResponseFields(snapshot),
    } : { success: false, error: { code: 'INSUFFICIENT_CREDITS', message: '크레딧이 부족합니다.' } }, { status: 402 })
  }

  const postItemIds = Array.from(new Set(claimedItems.map((item) => item.post_item_id)))
  const problemTypeIds = Array.from(new Set(claimedItems.map((item) => item.problem_type_id)))

  const [{ data: postItems, error: postItemsError }, { data: problemTypes, error: problemTypesError }] = await Promise.all([
    supabase
      .from('generate_listboard_post_items')
      .select('id, passage_text')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('id', postItemIds),
    supabase
      .from('problem_types')
      .select('*')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .neq('model_name', 'admin')
      .in('id', problemTypeIds),
  ])

  if (postItemsError || problemTypesError) {
    await adminSupabase
      .from('generate_listboard_generation_job_items')
      .update({
        status: 'failed',
        started_at: null,
      })
      .in('id', claimedItems.map((item) => item.id))
      .eq('workspace_subject', workspaceSubject)

    await adminSupabase
      .from('generate_listboard_generation_jobs')
      .update({
        status: job.status,
      })
      .eq('id', job.id)
      .eq('workspace_subject', workspaceSubject)

    return NextResponse.json({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: postItemsError?.message || problemTypesError?.message || '재시도 준비에 실패했습니다.' },
    }, { status: 500 })
  }

  let deductionResult: Awaited<ReturnType<typeof CreditService.deductCredits>> | null = null

  try {
    deductionResult = await CreditService.deductCredits(
      user.id,
      requiredCredits,
      'listboard_batch_generation_retry',
      job.id,
      `리스트보드 배치 생성 재시도 (${job.id})`
    )
  } catch (error) {
    await adminSupabase
      .from('generate_listboard_generation_job_items')
      .update({
        status: 'failed',
        started_at: null,
      })
      .in('id', claimedItems.map((item) => item.id))
      .eq('workspace_subject', workspaceSubject)

    await adminSupabase
      .from('generate_listboard_generation_jobs')
      .update({
        status: job.status,
      })
      .eq('id', job.id)
      .eq('workspace_subject', workspaceSubject)

    const snapshot = await getSnapshot()
    return NextResponse.json(snapshot ? {
      success: false,
      error: { code: 'INSUFFICIENT_CREDITS', message: error instanceof Error ? error.message : '크레딧이 부족합니다.' },
      ...buildCreditBalanceResponseFields(snapshot),
    } : {
      success: false,
      error: { code: 'INSUFFICIENT_CREDITS', message: error instanceof Error ? error.message : '크레딧이 부족합니다.' },
    }, { status: 402 })
  }

  const postItemMap = new Map((postItems ?? []).map((item) => [item.id, item]))
  const problemTypeMap = new Map((problemTypes ?? []).map((type) => [type.id, type]))
  const gradeLevel = job.grade_level || '1학년'
  const difficulty = job.difficulty || 'Medium'
  let completedRetries = 0
  let failedRetries = 0

  await adminSupabase
    .from('generate_listboard_generation_jobs')
    .update({
      status: 'running',
      finished_at: null,
    })
    .eq('id', job.id)
    .eq('workspace_subject', workspaceSubject)

  for (const jobItem of claimedItems) {
    const postItem = postItemMap.get(jobItem.post_item_id)
    const problemType = problemTypeMap.get(jobItem.problem_type_id)

    if (!postItem || !problemType) {
      failedRetries += 1
      await adminSupabase
        .from('generate_listboard_generation_job_items')
        .update({
          status: 'failed',
          error_code: 'INVALID_RETRY_REFERENCE',
          error_message: '비활성화되었거나 삭제된 문항/문제유형은 재시도할 수 없습니다.',
          attempt_count: (jobItem.attempt_count ?? 0) + 1,
          finished_at: new Date().toISOString(),
        })
        .eq('id', jobItem.id)
        .eq('workspace_subject', workspaceSubject)
      continue
    }

    await adminSupabase
      .from('generate_listboard_generation_job_items')
      .update({
        status: 'running',
        generated_question: null,
        raw_ai_response: null,
        save_status: 'unsaved',
        saved_at: null,
        save_error_message: null,
        question_id: null,
        error_code: null,
        error_message: null,
        started_at: new Date().toISOString(),
        finished_at: null,
        attempt_count: (jobItem.attempt_count ?? 0) + 1,
      })
      .eq('id', jobItem.id)
      .eq('workspace_subject', workspaceSubject)

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

      const { error: completeUpdateError } = await adminSupabase
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
        .eq('workspace_subject', workspaceSubject)

      if (completeUpdateError) {
        throw new Error(completeUpdateError.message)
      }

      completedRetries += 1
    } catch (error) {
      failedRetries += 1
      const { error: failedUpdateError } = await adminSupabase
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
        .eq('workspace_subject', workspaceSubject)

      if (failedUpdateError) {
        console.error('Failed to persist batch retry failure state:', failedUpdateError)
      }
    }
  }

  if (deductionResult && failedRetries > 0) {
    await CreditService.refundCredits(
      user.id,
      failedRetries * COST_PER_GENERATION,
      'listboard_batch_generation_retry_refund',
      job.id,
      `리스트보드 배치 생성 재시도 실패 환불 (${job.id})`,
      getRefundConsumptions(deductionResult.consumptions, failedRetries * COST_PER_GENERATION)
    )
  }

  const { data: allJobItems, error: allJobItemsError } = await adminSupabase
    .from('generate_listboard_generation_job_items')
    .select('status')
    .eq('job_id', job.id)
    .eq('workspace_subject', workspaceSubject)

  if (allJobItemsError) {
    return NextResponse.json({ success: false, error: { code: 'INTERNAL_SERVER_ERROR', message: allJobItemsError.message } }, { status: 500 })
  }

  const completedCount = (allJobItems ?? []).filter((item) => item.status === 'completed').length
  const failedCount = (allJobItems ?? []).filter((item) => item.status === 'failed').length
  const cancelledCount = (allJobItems ?? []).filter((item) => item.status === 'cancelled').length
  const finalStatus = failedCount === 0
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
      cancelled_count: cancelledCount,
      credit_charged: completedCount * COST_PER_GENERATION,
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('workspace_subject', workspaceSubject)

  const snapshot = await getSnapshot()
  return NextResponse.json(snapshot ? {
    success: true,
    data: {
      jobId: job.id,
      retriedCount: claimedItems.length,
      completedRetries,
      failedRetries,
      remainingCompletedCount: completedCount,
      remainingFailedCount: failedCount,
      status: finalStatus,
    },
    ...buildCreditBalanceResponseFields(snapshot),
  } : {
    success: true,
    data: {
      jobId: job.id,
      retriedCount: claimedItems.length,
      completedRetries,
      failedRetries,
      remainingCompletedCount: completedCount,
      remainingFailedCount: failedCount,
      status: finalStatus,
    },
  })
}
