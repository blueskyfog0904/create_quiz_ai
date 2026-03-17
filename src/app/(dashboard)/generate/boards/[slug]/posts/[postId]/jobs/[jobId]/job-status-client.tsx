'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { BatchQuestionPreviewCard } from '@/components/features/quiz/batch-question-preview-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { Database } from '@/types/supabase'
import { parseStagedGeneratedQuestion } from '@/lib/questions/generated-question-staging'

type GenerateMenuEntry = Database['public']['Tables']['generate_menu_entries']['Row']
type GenerateListboardPost = Database['public']['Tables']['generate_listboard_posts']['Row']
type GenerateListboardGenerationJob = Database['public']['Tables']['generate_listboard_generation_jobs']['Row']
type GenerateListboardGenerationJobItem = Database['public']['Tables']['generate_listboard_generation_job_items']['Row']

interface JobStatusItem extends GenerateListboardGenerationJobItem {
  question_number: string
  problem_type_name: string
}

interface JobStatusClientProps {
  board: GenerateMenuEntry
  post: GenerateListboardPost
  initialJob: GenerateListboardGenerationJob
  initialGradeLevel?: string
  initialDifficulty?: string
  initialItems: JobStatusItem[]
}

const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled', 'partially_completed']

export default function JobStatusClient({
  board,
  post,
  initialJob,
  initialGradeLevel,
  initialDifficulty,
  initialItems,
}: JobStatusClientProps) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [items, setItems] = useState(initialItems)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [savingItemIds, setSavingItemIds] = useState<string[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isStartingRun, setIsStartingRun] = useState(false)
  const hasStartedRunRef = useRef(false)

  const completedCount = items.filter((item) => item.status === 'completed').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const savedCount = items.filter((item) => item.save_status === 'saved').length
  const saveFailedCount = items.filter((item) => item.save_status === 'save_failed').length
  const isGenerationInProgress = isStartingRun || !TERMINAL_JOB_STATUSES.includes(job.status)
  const progressPercent = job.requested_generation_count > 0
    ? Math.round(((completedCount + failedCount) / job.requested_generation_count) * 100)
    : 0

  const completedPreviewItems = useMemo(() => items
    .map((item) => ({
      item,
      generatedQuestion: parseStagedGeneratedQuestion(item.generated_question),
    }))
    .filter(({ item, generatedQuestion }) => item.status === 'completed' && generatedQuestion !== null), [items])

  const saveableItemIds = useMemo(() => completedPreviewItems
    .filter(({ item }) => ['unsaved', 'save_failed'].includes(item.save_status))
    .map(({ item }) => item.id), [completedPreviewItems])

  useEffect(() => {
    setSelectedItemIds((current) => {
      const currentValidIds = current.filter((id) => saveableItemIds.includes(id))

      if (currentValidIds.length > 0) {
        return currentValidIds
      }

      return saveableItemIds
    })
  }, [saveableItemIds])

  const refreshJob = useCallback(async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true)
    }

    try {
      const res = await fetch(`/api/generate/listboard-jobs/${job.id}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '작업 상태를 불러오지 못했습니다.')
      }

      setJob(data.data.job)
      setItems(data.data.items)
    } catch (error) {
      if (!silent) {
        toast.error(error instanceof Error ? error.message : '작업 상태 조회 중 오류가 발생했습니다.')
      }
    } finally {
      setIsRefreshing(false)
    }
  }, [job.id])

  useEffect(() => {
    if (TERMINAL_JOB_STATUSES.includes(job.status) && !isStartingRun) {
      return
    }

    const interval = window.setInterval(() => {
      void refreshJob(true)
    }, 5000)

    return () => window.clearInterval(interval)
  }, [job.status, refreshJob, isStartingRun])

  useEffect(() => {
    if (job.status !== 'queued') {
      return
    }

    if (hasStartedRunRef.current) {
      return
    }

    hasStartedRunRef.current = true
    setIsStartingRun(true)

    const startRun = async () => {
      try {
        const res = await fetch(`/api/generate/listboard-jobs/${job.id}/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            gradeLevel: initialGradeLevel || post.grade_level || '1학년',
            difficulty: initialDifficulty || 'Medium',
          }),
        })

        const data = await res.json()
        if (!res.ok || !data.success) {
          throw new Error(data.error?.message || '배치 생성 실행에 실패했습니다.')
        }

        await refreshJob(true)
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '배치 생성 실행 중 오류가 발생했습니다.')
      } finally {
        setIsStartingRun(false)
      }
    }

    void startRun()
  }, [job.id, job.status, initialDifficulty, initialGradeLevel, post.grade_level, refreshJob])

  const handleRetryFailed = async () => {
    setIsRetrying(true)
    try {
      const res = await fetch(`/api/generate/listboard-jobs/${job.id}/retry`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '실패 항목 재시도에 실패했습니다.')
      }

      toast.success(`실패 항목 ${data.data.retriedCount}건 재시도를 시작했습니다.`)
      await refreshJob(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '재시도 중 오류가 발생했습니다.')
    } finally {
      setIsRetrying(false)
    }
  }

  const handleSaveItems = async (jobItemIds: string[], successMessage: string) => {
    if (jobItemIds.length === 0) {
      toast.info('저장할 생성 결과를 선택해주세요.')
      return
    }

    setSavingItemIds((current) => Array.from(new Set([...current, ...jobItemIds])))

    try {
      const res = await fetch(`/api/generate/listboard-jobs/${job.id}/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jobItemIds }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '선택 저장에 실패했습니다.')
      }

      if (data.data.savedCount > 0) {
        toast.success(successMessage.replace('{count}', String(data.data.savedCount)))
      }

      if (data.data.failedCount > 0) {
        toast.error(`${data.data.failedCount}건은 저장하지 못했습니다. 상태를 확인해주세요.`)
      }

      await refreshJob(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '선택 저장 중 오류가 발생했습니다.')
    } finally {
      setSavingItemIds((current) => current.filter((id) => !jobItemIds.includes(id)))
    }
  }

  const toggleSelectAll = () => {
    if (selectedItemIds.length === saveableItemIds.length) {
      setSelectedItemIds([])
      return
    }

    setSelectedItemIds(saveableItemIds)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">배치 생성 결과 검토</h1>
          <p className="mt-2 text-gray-500">{post.title} 게시글 기준 생성 결과를 확인하고 선택 저장할 수 있습니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void refreshJob()} disabled={isGenerationInProgress || isRefreshing}>
            {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            새로고침
          </Button>
          {failedCount > 0 && job.status !== 'running' && !isStartingRun ? (
            <Button onClick={() => void handleRetryFailed()} disabled={isGenerationInProgress || isRetrying}>
              {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              실패 항목 재시도
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <Link
              href={`/generate/boards/${board.slug}/posts/${post.id}`}
              aria-disabled={isGenerationInProgress}
              className={isGenerationInProgress ? 'pointer-events-none opacity-50' : ''}
            >
              선택 화면으로 돌아가기
            </Link>
          </Button>
          <Button onClick={() => router.push(`/library/purchased?jobId=${job.id}`)} disabled={isGenerationInProgress || savedCount === 0}>
            저장한 문제 확인하기
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>작업 요약</CardTitle>
          <CardDescription>생성 완료 후 검토/저장 단계까지 한 화면에서 관리합니다.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-gray-700 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">작업 상태</p>
            <p className="mt-1 text-lg font-semibold">{isStartingRun ? 'running' : job.status}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">총 생성 건수</p>
            <p className="mt-1 text-lg font-semibold">{job.requested_generation_count}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">생성 성공</p>
            <p className="mt-1 text-lg font-semibold">{completedCount}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">생성 실패</p>
            <p className="mt-1 text-lg font-semibold">{failedCount}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">저장 완료</p>
            <p className="mt-1 text-lg font-semibold text-emerald-600">{savedCount}</p>
          </div>
          <div className="rounded-md border bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-500">저장 실패</p>
            <p className="mt-1 text-lg font-semibold text-rose-600">{saveFailedCount}</p>
          </div>
        </CardContent>
        <CardContent className="pt-0">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm text-gray-600">
              <span>생성 진행률</span>
              <span>
                {completedCount + failedCount} / {job.requested_generation_count} 처리 ({progressPercent}%)
                {isGenerationInProgress ? ' · 생성 중…' : ''}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className={`h-full rounded-full bg-primary transition-all ${isGenerationInProgress ? 'animate-pulse' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {isGenerationInProgress ? (
              <div className="relative h-2 overflow-hidden rounded-full bg-primary/10">
                <div className="absolute inset-y-0 left-0 w-1/3 animate-[loading-bar_1.2s_ease-in-out_infinite] rounded-full bg-primary/50" />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="sticky top-20 z-20 border-primary/20 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <Button variant="outline" size="sm" onClick={toggleSelectAll} disabled={isGenerationInProgress || saveableItemIds.length === 0}>
              {selectedItemIds.length === saveableItemIds.length && saveableItemIds.length > 0 ? '전체 해제' : '전체 선택'}
            </Button>
            <span>선택 {selectedItemIds.length}건</span>
            <span>저장 가능 {saveableItemIds.length}건</span>
            {isStartingRun ? <Badge variant="outline">작업 실행 중…</Badge> : null}
            {savedCount > 0 ? <Badge className="bg-emerald-100 text-emerald-700">{savedCount}건 저장됨</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/library/purchased?jobId=${job.id}`)}
              disabled={isGenerationInProgress || savedCount === 0}
            >
              영어문제 관리에서 보기
            </Button>
            <Button
              onClick={() => void handleSaveItems(selectedItemIds, '{count}개의 문제를 저장했습니다.')}
              disabled={isGenerationInProgress || selectedItemIds.length === 0 || savingItemIds.length > 0}
            >
              {savingItemIds.length > 0 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              선택한 문제 저장
            </Button>
          </div>
        </CardContent>
      </Card>

      {completedPreviewItems.length > 0 ? (
        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">생성 결과</h2>
            <p className="mt-1 text-sm text-gray-500">문항별 생성 결과를 검토한 뒤 필요한 문제만 저장하세요.</p>
          </div>
          <div className="grid gap-6">
            {completedPreviewItems.map(({ item, generatedQuestion }) => (
              generatedQuestion ? (
              <BatchQuestionPreviewCard
                key={item.id}
                questionNumber={item.question_number}
                problemTypeName={item.problem_type_name}
                generatedQuestion={generatedQuestion}
                isSelected={selectedItemIds.includes(item.id)}
                saveStatus={item.save_status}
                saveErrorMessage={item.save_error_message}
                isSaving={savingItemIds.includes(item.id)}
                disableActions={isGenerationInProgress}
                onSelectChange={(checked) => {
                  setSelectedItemIds((current) => {
                    if (checked) {
                      return Array.from(new Set([...current, item.id]))
                    }

                    return current.filter((id) => id !== item.id)
                  })
                }}
                onSave={() => void handleSaveItems([item.id], '문제 1개를 저장했습니다.')}
              />
              ) : null
            ))}
          </div>
        </section>
      ) : null}

      {items.some((item) => item.status !== 'completed' || parseStagedGeneratedQuestion(item.generated_question) === null) ? (
        <Card>
          <CardHeader>
            <CardTitle>진행/예외 항목</CardTitle>
            <CardDescription>아직 검토할 수 없거나 재시도가 필요한 항목입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {items
              .filter((item) => item.status !== 'completed' || parseStagedGeneratedQuestion(item.generated_question) === null)
              .map((item) => (
                <div key={item.id} className="rounded-lg border px-4 py-3 text-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium text-gray-900">{item.question_number}번 · {item.problem_type_name}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.status}</Badge>
                        <span className="text-xs text-gray-500">시도 {item.attempt_count}회</span>
                        {item.save_status !== 'unsaved' ? (
                          <Badge variant="outline">{item.save_status}</Badge>
                        ) : null}
                      </div>
                      {item.status === 'completed' && item.generated_question === null ? (
                        <p className="flex items-center gap-1 text-amber-600">
                          <AlertCircle className="h-4 w-4" />
                          미리보기 데이터가 없어 저장할 수 없습니다.
                        </p>
                      ) : null}
                      {item.error_message ? <p className="text-rose-600">{item.error_message}</p> : null}
                      {item.save_error_message ? <p className="text-rose-600">{item.save_error_message}</p> : null}
                    </div>
                    {item.status === 'completed' && item.question_id ? (
                      <div className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        저장 완료
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
