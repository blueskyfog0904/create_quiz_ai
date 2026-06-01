import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { pruneExpiredAiQuestionGenerationRuns } from '@/lib/ai/question-generation-run-logs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface AiQuestionGenerationRunDetailPageProps {
  params: Promise<{ runId: string }>
  searchParams?: Promise<{ subject?: string }>
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2)
const getRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : null
)

export default async function AiQuestionGenerationRunDetailPage({
  params,
  searchParams,
}: AiQuestionGenerationRunDetailPageProps) {
  await requireAdmin()
  const { runId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)
  const supabase = await createClient()
  await pruneExpiredAiQuestionGenerationRuns()

  const { data: run } = await supabase
    .from('ai_question_generation_runs')
    .select('*')
    .eq('id', runId)
    .single()

  if (!run) {
    notFound()
  }

  const { data: runUser } = run.user_id
    ? await supabase
      .from('profiles')
      .select('id,email,name')
      .eq('id', run.user_id)
      .maybeSingle()
    : { data: null }

  const attempts: unknown[] = Array.isArray(run.attempts) ? run.attempts : []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">AI 생성 로그 상세</h1>
          <p className="text-gray-500 mt-1">30일 보존 정책에 따라 상세 trace는 만료 후 정리될 수 있습니다.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/ai-question-generation-runs?subject=${workspaceSubject}`}>목록으로</Link>
          </Button>
          <Button asChild>
            <a href={`/api/admin/ai-question-generation-runs/${run.id}/download`}>JSON 다운로드</a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">상태</CardTitle></CardHeader>
          <CardContent><Badge variant={run.status === 'passed' ? 'default' : 'destructive'}>{run.status}</Badge></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">생성 흐름</CardTitle></CardHeader>
          <CardContent className="font-medium">{run.source}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">사용자</CardTitle></CardHeader>
          <CardContent>
            <div>{runUser?.name || '이름 없음'}</div>
            <div className="text-xs text-gray-500">{runUser?.email || run.user_id || '-'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">크레딧</CardTitle></CardHeader>
          <CardContent className="font-bold">{run.credit_charged.toLocaleString()} C</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>개요</CardTitle>
          <CardDescription>문제유형, 모델 설정, 저장 연결 상태를 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <div><span className="text-gray-500">문제유형</span><div className="font-medium">{run.problem_type_name || run.problem_type_id || '-'}</div></div>
          <div><span className="text-gray-500">저장 문제</span><div className="font-medium">{run.question_id || '미연결'}</div></div>
          <div><span className="text-gray-500">중단 사유</span><div className="font-medium">{run.stop_reason || '-'}</div></div>
          <div><span className="text-gray-500">만료 예정</span><div className="font-medium">{run.expires_at ? new Date(run.expires_at).toLocaleString('ko-KR') : '-'}</div></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>입력 / 모델 설정</CardTitle>
          <CardDescription>원문 지문 자체는 마스킹·축약된 trace 기준으로만 보관합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <pre className="max-h-80 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-50">{pretty(run.input)}</pre>
          <pre className="max-h-80 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-50">{pretty(run.model_config)}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>회차별 진행 로그</CardTitle>
          <CardDescription>문제 생성, 검토, 재생성 요청과 응답을 시간순으로 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {attempts.map((attempt, index) => {
            const attemptRecord = getRecord(attempt)
            return (
              <details key={attemptRecord?.id ? String(attemptRecord.id) : index} className="rounded border bg-white p-3" open={index === 0}>
                <summary className="cursor-pointer font-medium">{attemptRecord?.title ? String(attemptRecord.title) : `${index + 1}번 로그`}</summary>
                <pre className="mt-3 max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-50">{pretty(attempt)}</pre>
              </details>
            )
          })}
          {attempts.length === 0 && <p className="text-sm text-gray-500">저장된 상세 진행 로그가 없습니다.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>검토 결과 / 최종 문제</CardTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <pre className="max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-50">{pretty(run.final_review)}</pre>
          <pre className="max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-50">{pretty(run.final_question)}</pre>
          <pre className="max-h-96 overflow-auto rounded bg-slate-950 p-4 text-xs text-slate-50">{pretty({ redactionFlags: run.redaction_flags, truncatedFlags: run.truncated_flags })}</pre>
        </CardContent>
      </Card>
    </div>
  )
}
