import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pruneExpiredAiQuestionGenerationRuns } from '@/lib/ai/question-generation-run-logs'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ runId: string }>
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { runId } = await params
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
      .select('id,email,name')
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
