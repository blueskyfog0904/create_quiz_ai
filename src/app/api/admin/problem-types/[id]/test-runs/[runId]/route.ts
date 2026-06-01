import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; runId: string }>
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { id, runId } = await params
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
