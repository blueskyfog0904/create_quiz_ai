import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  MAX_ADMIN_REVIEW_ATTEMPTS,
  buildQuestionGenerationConfigFromProblemType,
  runQuestionGenerationReviewLoop,
} from '@/lib/ai/question-generation-workflow'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import type { Json } from '@/types/supabase'

export const dynamic = 'force-dynamic'

const TestRequestSchema = z.object({
  passage: z.string().min(1).max(3500),
  passageId: z.string().uuid().optional(),
  workspaceSubject: z.enum(['english', 'korean']).optional(),
  maxAttempts: z.number().int().min(1).max(MAX_ADMIN_REVIEW_ATTEMPTS).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

const toJson = (value: unknown): Json => (
  value === undefined ? null : JSON.parse(JSON.stringify(value))
)

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return NextResponse.json({ success: false, error: { code: 'FORBIDDEN', message: '관리자 권한이 필요합니다.' } }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const validation = TestRequestSchema.safeParse(body)

  if (!validation.success) {
    return NextResponse.json({ success: false, error: { code: 'INVALID_INPUT', message: validation.error.issues[0]?.message || '입력이 올바르지 않습니다.' } }, { status: 400 })
  }

  const workspaceSubject = resolveAdminWorkspaceSubject(validation.data.workspaceSubject)
  const { data: problemType, error } = await supabase
    .from('problem_types')
    .select('*')
    .eq('id', id)
    .eq('workspace_subject', workspaceSubject)
    .single()

  if (error || !problemType) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '문제 유형을 찾을 수 없습니다.' } }, { status: 404 })
  }

  const generationConfig = buildQuestionGenerationConfigFromProblemType(problemType)
  if (!generationConfig.modelConfig) {
    return NextResponse.json({
      success: false,
      error: {
        code: generationConfig.error?.code || 'REVIEW_MODEL_NOT_CONFIGURED',
        message: generationConfig.error?.message || '문제 검토 API 제공자와 모델을 먼저 설정해주세요.',
      },
    }, { status: 409 })
  }

  const loopResult = await runQuestionGenerationReviewLoop({
    passage: validation.data.passage,
    workspaceSubject,
    promptBundle: generationConfig.promptBundle,
    modelConfig: generationConfig.modelConfig,
    maxAttempts: validation.data.maxAttempts,
    includeTrace: true,
    traceMode: 'admin_full',
    signal: request.signal,
  })

  const { data: testRun, error: testRunError } = await supabase
    .from('problem_type_test_runs')
    .insert({
      problem_type_id: id,
      user_id: user.id,
      workspace_subject: workspaceSubject,
      status: loopResult.status,
      stop_reason: loopResult.stopReason,
      input: toJson({
        passage: validation.data.passage,
        passageId: validation.data.passageId,
        maxAttempts: validation.data.maxAttempts,
        workspaceSubject,
      }),
      model_config: toJson(generationConfig.modelConfig),
      final_question: toJson(loopResult.finalQuestion),
      last_question: toJson(loopResult.lastQuestion),
      final_review: toJson(loopResult.finalReview),
      attempts: toJson(loopResult.attempts),
      raw_generation_response: loopResult.rawGenerationResponse,
      raw_review_response: loopResult.rawReviewResponse,
    })
    .select('id')
    .single()

  if (testRunError || !testRun) {
    return NextResponse.json({
      success: false,
      status: loopResult.status,
      finalQuestion: loopResult.finalQuestion,
      lastQuestion: loopResult.lastQuestion,
      finalReview: loopResult.finalReview,
      attempts: loopResult.attempts,
      stopReason: loopResult.stopReason,
      error: {
        code: 'TEST_LOG_SAVE_FAILED',
        message: testRunError?.message || '테스트 로그 저장에 실패했습니다.',
      },
    }, { status: 500 })
  }

  const testRunId = testRun.id
  const logLocation = `/api/admin/problem-types/${id}/test-runs/${testRunId}`
  const logDownloadUrl = `/api/admin/problem-types/${id}/test-runs/${testRunId}/download`

  return NextResponse.json({
    success: loopResult.status === 'passed',
    status: loopResult.status,
    testRunId,
    logLocation,
    logDownloadUrl,
    finalQuestion: loopResult.finalQuestion,
    lastQuestion: loopResult.lastQuestion,
    finalReview: loopResult.finalReview,
    attempts: loopResult.attempts,
    stopReason: loopResult.stopReason,
  })
}
