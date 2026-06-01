'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Json, Tables } from '@/types/supabase'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

type AiGenerationRun = Pick<
  Tables<'ai_question_generation_runs'>,
  | 'id'
  | 'user_id'
  | 'workspace_subject'
  | 'source'
  | 'problem_type_name'
  | 'question_id'
  | 'status'
  | 'stop_reason'
  | 'model_config'
  | 'redaction_flags'
  | 'truncated_flags'
  | 'credit_charged'
  | 'created_at'
  | 'expires_at'
> & {
  user: { id: string; email: string | null; name: string | null } | null
}

interface AiQuestionGenerationRunsClientProps {
  runs: AiGenerationRun[]
  workspaceSubject: WorkspaceSubject
  status: string
  source: string
}

const sourceLabels: Record<string, string> = {
  single: '개인 생성',
  multi: '다중 생성',
  textbook: '교재형 생성',
  listboard_run: '리스트보드 생성',
  listboard_retry: '리스트보드 재시도',
}

const hasFlag = (value: Json): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).some((item) => {
    if (item === true) return true
    if (item && typeof item === 'object' && !Array.isArray(item)) return hasFlag(item as Json)
    return false
  })
}

export default function AiQuestionGenerationRunsClient({
  runs,
  workspaceSubject,
  status,
  source,
}: AiQuestionGenerationRunsClientProps) {
  const router = useRouter()
  const passedCount = runs.filter((run) => run.status === 'passed').length
  const failedCount = runs.filter((run) => run.status !== 'passed').length
  const linkedCount = runs.filter((run) => Boolean(run.question_id)).length

  const updateFilter = (key: 'status' | 'source', value: string) => {
    const params = new URLSearchParams({ subject: workspaceSubject })
    const nextStatus = key === 'status' ? value : status
    const nextSource = key === 'source' ? value : source

    if (nextStatus && nextStatus !== 'all') params.set('status', nextStatus)
    if (nextSource && nextSource !== 'all') params.set('source', nextSource)
    router.push(`/admin/ai-question-generation-runs?${params.toString()}`)
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">총 로그</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{runs.length}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">통과</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-emerald-600">{passedCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">미통과/실패</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-red-600">{failedCount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">저장 연결</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{linkedCount}</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>검색 / 필터</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <Input className="pl-9" placeholder="사용자/문제유형 검색은 후속 필터에서 확장" disabled />
          </div>
          <Select value={status || 'all'} onValueChange={(value) => updateFilter('status', value)}>
            <SelectTrigger><SelectValue placeholder="상태" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">상태 전체</SelectItem>
              <SelectItem value="passed">통과</SelectItem>
              <SelectItem value="max_attempts_reached">최대 반복 도달</SelectItem>
              <SelectItem value="generation_failed">생성 실패</SelectItem>
              <SelectItem value="review_failed">검토 실패</SelectItem>
              <SelectItem value="timeout">시간 초과</SelectItem>
            </SelectContent>
          </Select>
          <Select value={source || 'all'} onValueChange={(value) => updateFilter('source', value)}>
            <SelectTrigger><SelectValue placeholder="생성 흐름" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">생성 흐름 전체</SelectItem>
              <SelectItem value="single">개인 생성</SelectItem>
              <SelectItem value="multi">다중 생성</SelectItem>
              <SelectItem value="textbook">교재형 생성</SelectItem>
              <SelectItem value="listboard_run">리스트보드 생성</SelectItem>
              <SelectItem value="listboard_retry">리스트보드 재시도</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>로그 목록</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="p-3">일시</th>
                  <th className="p-3">사용자</th>
                  <th className="p-3">생성 흐름</th>
                  <th className="p-3">상태</th>
                  <th className="p-3">문제유형</th>
                  <th className="p-3">크레딧</th>
                  <th className="p-3">마스킹/축약</th>
                  <th className="p-3 text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b last:border-0">
                    <td className="p-3 whitespace-nowrap">{new Date(run.created_at).toLocaleString('ko-KR')}</td>
                    <td className="p-3">
                      <div className="font-medium">{run.user?.name || '이름 없음'}</div>
                      <div className="text-xs text-gray-500">{run.user?.email || run.user_id || '-'}</div>
                    </td>
                    <td className="p-3">{sourceLabels[run.source] || run.source}</td>
                    <td className="p-3"><Badge variant={run.status === 'passed' ? 'default' : 'destructive'}>{run.status}</Badge></td>
                    <td className="p-3">{run.problem_type_name || '-'}</td>
                    <td className="p-3">{run.credit_charged.toLocaleString()} C</td>
                    <td className="p-3 space-x-1">
                      {hasFlag(run.redaction_flags) && <Badge variant="secondary">보안 마스킹</Badge>}
                      {hasFlag(run.truncated_flags) && <Badge variant="outline">축약됨</Badge>}
                      {!hasFlag(run.redaction_flags) && !hasFlag(run.truncated_flags) && <Badge variant="outline">마스킹 없음</Badge>}
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/ai-question-generation-runs/${run.id}?subject=${workspaceSubject}`}>상세</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/admin/ai-question-generation-runs/${run.id}/download`}><Download className="mr-1 h-3 w-3" />JSON 다운로드</a>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && (
                  <tr>
                    <td className="p-8 text-center text-gray-500" colSpan={8}>표시할 AI 생성 로그가 없습니다.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
