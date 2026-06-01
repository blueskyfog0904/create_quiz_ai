import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { pruneExpiredAiQuestionGenerationRuns } from '@/lib/ai/question-generation-run-logs'

export const dynamic = 'force-dynamic'

const MAX_LIMIT = 100

const toLimit = (value: string | null) => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 50
  return Math.max(1, Math.min(Math.floor(parsed), MAX_LIMIT))
}

export async function GET(request: Request) {
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

  const { searchParams } = new URL(request.url)
  const limit = toLimit(searchParams.get('limit'))
  const workspaceSubject = searchParams.get('subject') || searchParams.get('workspaceSubject') || 'english'
  const status = searchParams.get('status')
  const source = searchParams.get('source')
  const problemTypeId = searchParams.get('problemTypeId')
  const userId = searchParams.get('userId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  let query = supabase
    .from('ai_question_generation_runs')
    .select('id,user_id,workspace_subject,source,problem_type_id,problem_type_name,question_id,listboard_job_id,listboard_job_item_id,status,stop_reason,model_config,redaction_flags,truncated_flags,credit_charged,created_at,expires_at')
    .eq('workspace_subject', workspaceSubject)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)
  if (source) query = query.eq('source', source)
  if (problemTypeId) query = query.eq('problem_type_id', problemTypeId)
  if (userId) query = query.eq('user_id', userId)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data: runs, error } = await query

  if (error) {
    return NextResponse.json({ success: false, error: { code: 'AI_GENERATION_RUN_LIST_FAILED', message: error.message } }, { status: 500 })
  }

  const userIds = Array.from(new Set((runs ?? []).map((run) => run.user_id).filter((id): id is string => Boolean(id))))
  const { data: profiles } = userIds.length > 0
    ? await supabase
      .from('profiles')
      .select('id,email,name')
      .in('id', userIds)
    : { data: [] as Array<{ id: string; email: string | null; name: string | null }> }
  const profileMap = new Map((profiles ?? []).map((userProfile) => [userProfile.id, userProfile]))

  return NextResponse.json({
    success: true,
    runs: (runs ?? []).map((run) => ({
      ...run,
      user: run.user_id ? profileMap.get(run.user_id) ?? null : null,
      detailUrl: `/api/admin/ai-question-generation-runs/${run.id}`,
      downloadUrl: `/api/admin/ai-question-generation-runs/${run.id}/download`,
    })),
  })
}
