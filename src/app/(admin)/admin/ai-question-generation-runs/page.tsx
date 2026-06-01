import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { pruneExpiredAiQuestionGenerationRuns } from '@/lib/ai/question-generation-run-logs'
import AiQuestionGenerationRunsClient from './ai-question-generation-runs-client'

interface AiQuestionGenerationRunsPageProps {
  searchParams?: Promise<{
    subject?: string
    status?: string
    source?: string
  }>
}

export default async function AiQuestionGenerationRunsPage({ searchParams }: AiQuestionGenerationRunsPageProps) {
  await requireAdmin()
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  await pruneExpiredAiQuestionGenerationRuns()

  let query = supabase
    .from('ai_question_generation_runs')
    .select('id,user_id,workspace_subject,source,problem_type_id,problem_type_name,question_id,listboard_job_id,listboard_job_item_id,status,stop_reason,model_config,redaction_flags,truncated_flags,credit_charged,created_at,expires_at')
    .eq('workspace_subject', workspaceSubject)
    .order('created_at', { ascending: false })
    .limit(50)

  if (resolvedSearchParams?.status) {
    query = query.eq('status', resolvedSearchParams.status)
  }

  if (resolvedSearchParams?.source) {
    query = query.eq('source', resolvedSearchParams.source)
  }

  const { data: runs } = await query
  const userIds = Array.from(new Set((runs ?? []).map((run) => run.user_id).filter((id): id is string => Boolean(id))))
  const { data: profiles } = userIds.length > 0
    ? await supabase
      .from('profiles')
      .select('id,email,name')
      .in('id', userIds)
    : { data: [] as Array<{ id: string; email: string | null; name: string | null }> }
  const profileMap = new Map((profiles ?? []).map((profile) => [profile.id, profile]))

  const enrichedRuns = (runs ?? []).map((run) => ({
    ...run,
    user: run.user_id ? profileMap.get(run.user_id) ?? null : null,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">AI 생성 로그 · {workspaceSubject === 'english' ? '영어' : '국어'}</h1>
        <p className="text-gray-500 mt-1">사용자의 AI 문제 생성 요청, 검토, 재생성, 실패 사유를 확인합니다.</p>
      </div>

      <AiQuestionGenerationRunsClient
        runs={enrichedRuns}
        workspaceSubject={workspaceSubject}
        status={resolvedSearchParams?.status || ''}
        source={resolvedSearchParams?.source || ''}
      />
    </div>
  )
}
