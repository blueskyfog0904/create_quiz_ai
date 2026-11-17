import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { adminApiGuardMessage, requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { pruneExpiredAiQuestionGenerationRuns } from '@/lib/ai/question-generation-run-logs'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ runId: string }>
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { runId } = await params
  const supabase = await createClient()
  // 꺼 둔 기능의 API다. 미들웨어가 먼저 404로 막고(계획 4-2절), 다시 켜더라도 대표 관리자만 쓴다.
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) {
    return NextResponse.json({ success: false, error: { code: guard.status === 401 ? 'UNAUTHORIZED' : guard.status === 403 ? 'FORBIDDEN' : 'INTERNAL_SERVER_ERROR', message: adminApiGuardMessage(guard) } }, { status: guard.status })
  }

  await pruneExpiredAiQuestionGenerationRuns()

  const { data: run, error } = await supabase
    .from('ai_question_generation_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (error || !run) {
    return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'AI 생성 로그를 찾을 수 없습니다.' } }, { status: 404 })
  }

  const { data: runUser } = run.user_id
    ? await supabase
      .from('profiles')
      .select('id,email')
      .eq('id', run.user_id)
      .maybeSingle()
    : { data: null }

  return NextResponse.json({
    success: true,
    run: {
      ...run,
      user: runUser,
    },
  })
}
