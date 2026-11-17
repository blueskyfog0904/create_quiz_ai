import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; runId: string }>
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id, runId } = await params
  const supabase = await createClient()
  // 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return NextResponse.json({ success: false, error: { code: guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR', message: adminApiGuardMessage(guard) } }, { status: guard.status })
  }

  const { data: run, error } = await supabase
    .from('problem_type_test_runs')
    .select('*')
    .eq('id', runId)
    .eq('problem_type_id', id)
    .single()

  if (error || !run) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: '테스트 로그를 찾을 수 없습니다.' } }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    run: {
      id: run.id,
      problemTypeId: run.problem_type_id,
      userId: run.user_id,
      workspaceSubject: run.workspace_subject,
      status: run.status,
      stopReason: run.stop_reason,
      input: run.input,
      modelConfig: run.model_config,
      finalQuestion: run.final_question,
      lastQuestion: run.last_question,
      finalReview: run.final_review,
      attempts: run.attempts,
      rawGenerationResponse: run.raw_generation_response,
      rawReviewResponse: run.raw_review_response,
      createdAt: run.created_at,
    },
  })
}
