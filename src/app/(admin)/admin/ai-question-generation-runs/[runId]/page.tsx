import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { pruneExpiredAiQuestionGenerationRuns } from '@/lib/ai/question-generation-run-logs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { QuestionPreview } from '@/components/features/quiz/question-preview'
import { QuestionGenerationAttemptLogViewer } from '@/components/features/question-generation/QuestionGenerationAttemptLogViewer'
import {
  formatDateTime,
  getEventLabel,
  getPreviewQuestion,
  getReviewResult,
  safeAttemptLogs,
  safeJsonStringify,
  type SafeAttemptLog,
} from '@/components/features/question-generation/log-viewer-utils'

interface AiQuestionGenerationRunDetailPageProps {
  params: Promise<{ runId: string }>
  searchParams?: Promise<{ subject?: string }>
}

const statusLabels: Record<string, string> = {
  passed: '통과',
  generation_failed: '문제 생성 실패',
  review_failed: '검토 실패',
  max_attempts_reached: '최대 반복 도달',
  timeout: '시간 초과',
  cancelled: '취소됨',
}

const sourceLabels: Record<string, string> = {
  single: '개인 생성',
  multi: '다중 생성',
  batch: '일괄 생성',
  textbook: '교재형 생성',
  listboard_run: '리스트보드 생성',
  listboard_retry: '리스트보드 재시도',
}

const getRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
)

const displayValue = (value: unknown) => {
  if (typeof value === 'string' && value.trim()) {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return '-'
}

const hasRecordEntries = (value: unknown) => {
  const record = getRecord(value)
  return record ? Object.keys(record).length > 0 : false
}

const getPayloadError = (log: SafeAttemptLog | undefined) => {
  const payload = getRecord(log?.payload)
  if (!payload || payload.error === undefined) {
    return null
  }

  return typeof payload.error === 'string' ? payload.error : safeJsonStringify(payload.error)
}

function InfoItem({ label, value }: { label: string, value: unknown }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="break-words text-sm font-medium text-gray-900">{displayValue(value)}</div>
    </div>
  )
}

function RawJsonDetails({ title, value }: { title: string, value: unknown }) {
  return (
    <details className="rounded-lg border bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">{title}</summary>
      <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-4 text-xs text-slate-50">{safeJsonStringify(value)}</pre>
    </details>
  )
}

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

  const attemptLogs = safeAttemptLogs(run.attempts)
  const finalReview = getReviewResult(run.final_review)
  const finalQuestion = getPreviewQuestion(run.final_question)
  const lastQuestion = getPreviewQuestion(run.last_question)
  const previewQuestion = finalQuestion || lastQuestion
  const previewTitle = finalQuestion ? '최종 통과 문제' : '마지막 생성 문제(미통과/미저장 가능)'
  const input = getRecord(run.input)
  const modelConfig = getRecord(run.model_config)
  const truncatedFlags = getRecord(run.truncated_flags)
  const lastFailedLog = [...attemptLogs].reverse().find((log) => log.status === 'failed')
  const failureSummary = run.stop_reason
    || finalReview?.feedback
    || lastFailedLog?.title
    || getPayloadError(lastFailedLog)
    || '상세 실패 원인은 회차별 진행 로그에서 확인하세요.'
  const hasFailure = run.status !== 'passed' || Boolean(run.stop_reason) || Boolean(lastFailedLog)
  const statusLabel = statusLabels[run.status] || run.status
  const sourceLabel = sourceLabels[run.source] || run.source

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">AI 생성 로그 상세</h1>
          <p className="mt-1 text-gray-500">30일 보존 정책에 따라 상세 trace는 만료 후 정리될 수 있습니다.</p>
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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">상태</CardTitle></CardHeader>
          <CardContent>
            <Badge variant={run.status === 'passed' ? 'default' : 'destructive'}>{statusLabel}</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">생성 흐름</CardTitle></CardHeader>
          <CardContent>
            <div className="font-medium">{sourceLabel}</div>
            <div className="text-xs text-gray-500">{run.source}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">사용자</CardTitle></CardHeader>
          <CardContent>
            <div>{runUser?.name || '이름 없음'}</div>
            <div className="break-all text-xs text-gray-500">{runUser?.email || run.user_id || '-'}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">크레딧</CardTitle></CardHeader>
          <CardContent>
            <div className="font-bold">{Number(run.credit_charged || 0).toLocaleString()} C</div>
            <Badge className="mt-2" variant={run.question_id ? 'default' : 'secondary'}>{run.question_id ? '저장됨' : '미연결'}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>개요</CardTitle>
          <CardDescription>문제유형, 저장 연결 상태, 만료 예정일을 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm md:grid-cols-2">
          <InfoItem label="문제유형" value={run.problem_type_name || run.problem_type_id} />
          <InfoItem label="저장 문제" value={run.question_id || '미연결'} />
          <InfoItem label="중단 사유" value={run.stop_reason} />
          <InfoItem label="만료 예정" value={formatDateTime(run.expires_at)} />
        </CardContent>
      </Card>

      {hasFailure && (
        <Card className="border-red-200 bg-red-50/40">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>실패 원인 요약</CardTitle>
              <Badge variant="destructive">{statusLabel}</Badge>
            </div>
            <CardDescription>관리자가 먼저 확인해야 할 중단 사유와 실패 이벤트 위치입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="whitespace-pre-wrap text-gray-900">{failureSummary}</p>
            {lastFailedLog && (
              <div className="rounded border bg-white p-3 text-gray-600">
                발생 위치: {lastFailedLog.attemptNo === null ? '회차 미기록' : `${lastFailedLog.attemptNo}회차`} · {getEventLabel(lastFailedLog.event)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>입력 / 모델 설정</CardTitle>
          <CardDescription>원문 지문 자체는 마스킹·축약된 trace 기준으로만 보관합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-semibold">입력 정보</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoItem label="지문 길이" value={input?.passageLength} />
                <InfoItem label="문제유형 ID" value={input?.problemTypeId} />
                <InfoItem label="Post ID" value={input?.postId} />
                <InfoItem label="Subject" value={input?.workspaceSubject} />
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-semibold">모델 설정</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoItem label="생성 Provider" value={modelConfig?.generationProvider} />
                <InfoItem label="생성 모델" value={modelConfig?.generationModelName} />
                <InfoItem label="검토 Provider" value={modelConfig?.reviewProvider} />
                <InfoItem label="검토 모델" value={modelConfig?.reviewModelName} />
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <RawJsonDetails title="입력 원본 JSON 보기" value={run.input} />
            <RawJsonDetails title="모델 설정 원본 JSON 보기" value={run.model_config} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>검토 결과</CardTitle>
            <CardDescription>최종 검토 결과와 피드백을 사람이 읽기 쉬운 형태로 확인합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {finalReview ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={finalReview.passed ? 'default' : 'destructive'}>
                    {finalReview.passed === null ? '통과 여부 미기록' : finalReview.passed ? '통과' : '미통과'}
                  </Badge>
                  {finalReview.score !== null && <span className="text-gray-600">점수 {finalReview.score}</span>}
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-gray-500">피드백</div>
                  <p className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-gray-800">{finalReview.feedback || '-'}</p>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-gray-500">이슈</div>
                  {finalReview.issues.length > 0 ? (
                    <div className="space-y-2">
                      {finalReview.issues.map((issue, index) => (
                        <div key={`${issue.field || 'issue'}-${index}`} className="rounded border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={issue.severity === 'error' ? 'destructive' : 'outline'}>{issue.severity || 'info'}</Badge>
                            <span className="font-medium">{issue.field || 'field 미기록'}</span>
                          </div>
                          <p className="mt-2 text-gray-800">{issue.message}</p>
                          {issue.suggestion && <p className="mt-1 text-gray-500">제안: {issue.suggestion}</p>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500">기록된 이슈가 없습니다.</p>
                  )}
                </div>
              </>
            ) : (
              <p className="text-gray-500">검토 결과가 저장되지 않았습니다.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{previewQuestion ? previewTitle : '문제 미리보기'}</CardTitle>
            <CardDescription>
              final_question이 없으면 마지막 생성 문제를 미통과/미저장 가능 상태로 표시합니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {previewQuestion ? (
              <QuestionPreview question={previewQuestion} showSaveButton={false} showCard={false} />
            ) : (
              <p className="text-sm text-gray-500">표시할 문제가 없습니다.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>회차별 진행 로그</CardTitle>
          <CardDescription>문제 생성, 검토, 재생성 요청과 응답을 회차별로 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <QuestionGenerationAttemptLogViewer attempts={attemptLogs} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>마스킹 / 축약 / 만료 안내</CardTitle>
          <CardDescription>보안 마스킹, 축약, 보존 기간 만료 여부를 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge variant={hasRecordEntries(run.redaction_flags) ? 'destructive' : 'secondary'}>
              {hasRecordEntries(run.redaction_flags) ? '보안 마스킹됨' : '마스킹 없음'}
            </Badge>
            <Badge variant={hasRecordEntries(run.truncated_flags) ? 'destructive' : 'secondary'}>
              {hasRecordEntries(run.truncated_flags) ? '일부 로그 축약됨' : '축약 없음'}
            </Badge>
            <Badge variant={truncatedFlags?.expired ? 'destructive' : 'secondary'}>
              {truncatedFlags?.expired ? '보존 기간 만료' : '만료 전'}
            </Badge>
          </div>
          <p className="text-gray-500">만료 예정: {formatDateTime(run.expires_at) || '-'}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <RawJsonDetails title="redaction_flags JSON 보기" value={run.redaction_flags} />
            <RawJsonDetails title="truncated_flags JSON 보기" value={run.truncated_flags} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>전체 원본 JSON</CardTitle>
          <CardDescription>관리자 디버깅용 원본 데이터입니다. 기본 요약에서 부족한 경우에만 펼쳐 확인하세요.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <RawJsonDetails title="final_review JSON 보기" value={run.final_review} />
          <RawJsonDetails title="final_question JSON 보기" value={run.final_question} />
          <RawJsonDetails title="last_question JSON 보기" value={run.last_question} />
          <RawJsonDetails title="attempts JSON 보기" value={run.attempts} />
        </CardContent>
      </Card>
    </div>
  )
}
