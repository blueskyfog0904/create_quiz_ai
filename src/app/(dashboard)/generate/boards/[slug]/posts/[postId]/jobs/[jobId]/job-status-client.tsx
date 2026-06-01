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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Database } from '@/types/supabase'
import { parseStagedGeneratedQuestion } from '@/lib/questions/generated-question-staging'
import type { WorkspaceSubject } from '../../../../../../workspace-subject'

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
  initialItems: JobStatusItem[]
  workspaceSubject: WorkspaceSubject
}

const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled', 'partially_completed']

interface DraftQuestionMeta {
  rating: number
  tags: string[]
}

export default function JobStatusClient({
  board,
  post,
  initialJob,
  initialItems,
  workspaceSubject,
}: JobStatusClientProps) {
  const router = useRouter()
  const [job, setJob] = useState(initialJob)
  const [items, setItems] = useState(initialItems)
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([])
  const [savingItemIds, setSavingItemIds] = useState<string[]>([])
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [isStartingRun, setIsStartingRun] = useState(false)
  const [showCompleteDialog, setShowCompleteDialog] = useState(false)
  const [draftQuestionMeta, setDraftQuestionMeta] = useState<Record<string, DraftQuestionMeta>>({})
  const hasStartedRunRef = useRef(false)
  const hasShownCompleteDialogRef = useRef(false)

  const completedCount = items.filter((item) => item.status === 'completed').length
  const failedCount = items.filter((item) => item.status === 'failed').length
  const savedCount = items.filter((item) => item.save_status === 'saved').length
  const saveFailedCount = items.filter((item) => item.save_status === 'save_failed').length
  const isGenerationInProgress = isStartingRun || !TERMINAL_JOB_STATUSES.includes(job.status)
  const isPartialSuccess = completedCount > 0 && failedCount > 0
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
  const canSaveCompletedItems = saveableItemIds.length > 0 && savingItemIds.length === 0
  const canOpenPurchased = savedCount > 0
  const retryInProgress = isRetrying || (job.status === 'running' && completedCount > 0)
  const exceptionItems = useMemo(() => items
    .filter((item) => item.status !== 'completed' || parseStagedGeneratedQuestion(item.generated_question) === null), [items])
  const failedReasonGroups = useMemo(() => {
    const groups = new Map<string, { message: string; count: number }>()

    for (const item of exceptionItems.filter((currentItem) => currentItem.status === 'failed')) {
      const message = item.error_message?.trim() || item.save_error_message?.trim() || '원인을 확인할 수 없는 오류'
      const existing = groups.get(message)

      if (existing) {
        existing.count += 1
        continue
      }

      groups.set(message, { message, count: 1 })
    }

    return Array.from(groups.values()).sort((left, right) => right.count - left.count)
  }, [exceptionItems])

  const getDraftMeta = useCallback((itemId: string): DraftQuestionMeta => (
    draftQuestionMeta[itemId] ?? { rating: 0, tags: [] }
  ), [draftQuestionMeta])

  useEffect(() => {
    setSelectedItemIds((current) => {
      const currentValidIds = current.filter((id) => saveableItemIds.includes(id))

      if (currentValidIds.length > 0) {
        return currentValidIds
      }

      return saveableItemIds
    })
  }, [saveableItemIds])

  useEffect(() => {
    setDraftQuestionMeta((current) => {
      const next = { ...current }
      let changed = false

      for (const { item } of completedPreviewItems) {
        if (!next[item.id]) {
          next[item.id] = { rating: 0, tags: [] }
          changed = true
        }
      }

      return changed ? next : current
    })
  }, [completedPreviewItems])

  const refreshJob = useCallback(async (silent = false) => {
    if (!silent) {
      setIsRefreshing(true)
    }

    try {
      const params = new URLSearchParams({ workspaceSubject })
      const res = await fetch(`/api/generate/listboard-jobs/${job.id}?${params.toString()}`, {
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
  }, [job.id, workspaceSubject])

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
            workspaceSubject,
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
  }, [job.id, job.status, refreshJob, workspaceSubject])

  useEffect(() => {
    if (!hasStartedRunRef.current) {
      return
    }

    if (isGenerationInProgress) {
      return
    }

    if (hasShownCompleteDialogRef.current) {
      return
    }

    if (completedCount + failedCount === 0) {
      return
    }

    hasShownCompleteDialogRef.current = true
    setShowCompleteDialog(true)
  }, [completedCount, failedCount, isGenerationInProgress])

  const handleRetryFailed = async () => {
    setIsRetrying(true)
    hasShownCompleteDialogRef.current = false
    try {
      const params = new URLSearchParams({ workspaceSubject })
      const res = await fetch(`/api/generate/listboard-jobs/${job.id}/retry?${params.toString()}`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '실패 항목 재시도에 실패했습니다.')
      }

      if (data.data.failedRetries > 0) {
        const retryFailureMessage = data.data.completedRetries > 0
          ? `재시도 ${data.data.retriedCount}건 중 ${data.data.completedRetries}건 성공, ${data.data.failedRetries}건은 다시 실패했습니다.`
          : `재시도 ${data.data.retriedCount}건이 다시 실패했습니다.`

        toast.error(`${retryFailureMessage} 남은 실패 ${data.data.remainingFailedCount}건의 사유를 확인해주세요.`)
      } else {
        toast.success(`실패 항목 ${data.data.retriedCount}건 재시도를 완료했습니다.`)
      }

      await refreshJob(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '재시도 중 오류가 발생했습니다.')
    } finally {
      setIsRetrying(false)
    }
  }

  const updateDraftMeta = (itemId: string, updates: Partial<DraftQuestionMeta>) => {
    setDraftQuestionMeta((current) => ({
      ...current,
      [itemId]: {
        rating: current[itemId]?.rating ?? 0,
        tags: current[itemId]?.tags ?? [],
        ...updates,
      },
    }))
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
        body: JSON.stringify({
          workspaceSubject,
          items: jobItemIds.map((jobItemId) => ({
            jobItemId,
            rating: getDraftMeta(jobItemId).rating,
            tags: getDraftMeta(jobItemId).tags,
          })),
        }),
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || '선택 저장에 실패했습니다.')
      }

      if (data.data.savedCount > 0) {
        toast.success(successMessage.replace('{count}', String(data.data.savedCount)))
      }

      if (data.data.skippedCount > 0) {
        toast.info(`요청한 ${data.data.requestedCount}건 중 ${data.data.skippedCount}건은 이미 저장되었거나 저장 대상이 아니어서 건너뛰었습니다.`)
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
          <h1 className="text-3xl font-bold text-gray-900">문제 생성 결과 진행창</h1>
          <p className="mt-2 text-gray-500">{post.title} 게시글 기준 생성 결과를 확인하고 선택 저장할 수 있습니다.</p>
          {isPartialSuccess ? (
            <p className="mt-2 text-sm font-medium text-amber-700">
              성공한 문제는 지금 저장할 수 있고, 실패한 문제는 재시도할 수 있습니다.
            </p>
          ) : null}
          {retryInProgress ? (
            <p className="mt-1 text-sm text-primary">
              재시도 중에도 이미 생성된 문제는 계속 저장할 수 있습니다.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Button
            variant="outline"
            size="icon"
            onClick={() => void refreshJob()}
            disabled={isGenerationInProgress || isRefreshing}
            aria-label="새로고침"
            title="새로고침"
            className="shrink-0"
          >
            {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          {failedCount > 0 && job.status !== 'running' && !isStartingRun ? (
            <Button onClick={() => void handleRetryFailed()} disabled={isGenerationInProgress || isRetrying} className="shrink-0 whitespace-nowrap">
              {isRetrying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              실패 항목 재시도
            </Button>
          ) : null}
          <Button variant="outline" asChild className="shrink-0 whitespace-nowrap">
            <Link
              href={`/generate/boards/${board.slug}/posts/${post.id}`}
              aria-disabled={isGenerationInProgress}
              className={`whitespace-nowrap ${isGenerationInProgress ? 'pointer-events-none opacity-50' : ''}`}
            >
              선택 화면으로 돌아가기
            </Link>
          </Button>
          <Button
            onClick={() => router.push(`/library/purchased?jobId=${job.id}`)}
            disabled={!canOpenPurchased}
            className="shrink-0 whitespace-nowrap"
          >
            저장 문제 확인
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
            {isGenerationInProgress ? (
              <div className="flex items-center justify-center gap-3 rounded-lg border border-primary/10 bg-primary/5 px-4 py-4 text-primary">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm font-medium">문제 생성 진행 중입니다. 잠시만 기다려주세요…</span>
              </div>
            ) : (
              <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="sticky top-20 z-20 border-primary/20 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
            <Button variant="outline" size="sm" onClick={toggleSelectAll} disabled={!canSaveCompletedItems}>
              {selectedItemIds.length === saveableItemIds.length && saveableItemIds.length > 0 ? '전체 해제' : '전체 선택'}
            </Button>
            <span>선택 {selectedItemIds.length}건</span>
            <span>저장 가능 {saveableItemIds.length}건</span>
            {isStartingRun ? <Badge variant="outline">작업 실행 중…</Badge> : null}
            {savedCount > 0 ? <Badge className="bg-emerald-100 text-emerald-700">{savedCount}건 저장됨</Badge> : null}
            {retryInProgress && canSaveCompletedItems ? <Badge className="bg-primary/10 text-primary">완료 항목 저장 가능</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push(`/library/purchased?jobId=${job.id}`)}
              disabled={!canOpenPurchased}
            >
              영어문제 관리에서 보기
            </Button>
            <Button
              onClick={() => void handleSaveItems(selectedItemIds, '{count}개의 문제를 저장했습니다.')}
              disabled={!canSaveCompletedItems || selectedItemIds.length === 0}
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
                rating={getDraftMeta(item.id).rating}
                tags={getDraftMeta(item.id).tags}
                isSelected={selectedItemIds.includes(item.id)}
                saveStatus={item.save_status}
                saveErrorMessage={item.save_error_message}
                isSaving={savingItemIds.includes(item.id)}
                disableActions={savingItemIds.includes(item.id)}
                onRatingChange={(rating) => updateDraftMeta(item.id, { rating })}
                onAddTag={(tag) => {
                  const nextTag = tag.trim()
                  if (!nextTag) return
                  const currentTags = getDraftMeta(item.id).tags
                  if (currentTags.includes(nextTag)) {
                    toast.error('이미 존재하는 태그입니다.')
                    return
                  }
                  updateDraftMeta(item.id, { tags: [...currentTags, nextTag] })
                }}
                onRemoveTag={(tag) => {
                  updateDraftMeta(item.id, {
                    tags: getDraftMeta(item.id).tags.filter((currentTag) => currentTag !== tag),
                  })
                }}
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

      {exceptionItems.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>진행/예외 항목</CardTitle>
            <CardDescription>아직 검토할 수 없거나 재시도가 필요한 항목입니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {failedReasonGroups.length > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <p className="font-medium text-amber-900">최근 실패 사유</p>
                  <Badge className="w-fit bg-amber-100 text-amber-800">{failedCount}건 재시도 필요</Badge>
                </div>
                <ul className="mt-3 space-y-2 text-amber-900">
                  {failedReasonGroups.slice(0, 3).map((group) => (
                    <li key={group.message} className="flex items-start justify-between gap-3">
                      <span className="leading-6">{group.message}</span>
                      <span className="shrink-0 text-xs font-medium text-amber-700">{group.count}건</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-amber-700">같은 실패 사유가 반복되면 문항 정보를 확인한 뒤 다시 재시도하세요.</p>
              </div>
            ) : null}
            {exceptionItems.map((item) => (
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

      <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isPartialSuccess
                ? '일부 문제 생성이 실패했습니다.'
                : failedCount > 0
                  ? '문제 생성에 실패했습니다.'
                  : '문제 생성이 완료되었습니다.'}
            </DialogTitle>
            <DialogDescription>
              {isPartialSuccess
                ? '성공한 문제는 지금 저장할 수 있고, 실패한 문제는 재시도할 수 있습니다.'
                : failedCount > 0
                  ? '실패한 항목을 재시도해 다시 생성해 주세요.'
                  : '생성 결과를 확인하고 필요한 문제를 저장할 수 있습니다.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setShowCompleteDialog(false)}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
