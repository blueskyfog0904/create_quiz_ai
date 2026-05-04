'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

const BACKFILL_BATCH_SIZE = 500

type AuditSummary = {
  unassigned_admin_original_count?: number
  affected_saved_copy_count?: number
  excluded_ai_generated_count?: number
  duplicate_saved_copy_group_count?: number
  missing_admin_original_metadata_count?: number
  missing_saved_copy_metadata_count?: number
  mismatched_saved_copy_metadata_count?: number
}

type BackfillCandidate = {
  question_id: string
  question_text: string
  problem_type_id: string | null
  current_year_id: string | null
  current_book_id: string | null
  affected_saved_copy_count: number
  missing_metadata: boolean
  has_saved_copy_mismatch: boolean
  total_count?: number
}

type BackfillResult = {
  admin_updated_count: number
  copied_updated_count: number
}

type BackfillResponse = {
  audit: AuditSummary | null
  candidates: BackfillCandidate[]
  pagination: {
    limit: number
    offset: number
    total: number
  }
}

interface QuestionBankBackfillClientProps {
  workspaceSubject: WorkspaceSubject
}

function countValue(value: number | undefined) {
  return value ?? 0
}

function getErrorMessage(body: { error?: string }) {
  return body.error ?? '문제은행 백필 요청 처리에 실패했습니다.'
}

export default function QuestionBankBackfillClient({ workspaceSubject }: QuestionBankBackfillClientProps) {
  const [audit, setAudit] = useState<AuditSummary | null>(null)
  const [candidates, setCandidates] = useState<BackfillCandidate[]>([])
  const [pagination, setPagination] = useState({ limit: 100, offset: 0, total: 0 })
  const [search, setSearch] = useState('')
  const [filterYearId, setFilterYearId] = useState('')
  const [filterBookId, setFilterBookId] = useState('')
  const [problemTypeId, setProblemTypeId] = useState('')
  const [yearId, setYearId] = useState('')
  const [bookId, setBookId] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<BackfillResult | null>(null)
  const [resultMode, setResultMode] = useState<'dry-run' | 'apply' | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const endpoint = useMemo(() => {
    const params = new URLSearchParams({
      subject: workspaceSubject,
      limit: String(pagination.limit),
      offset: String(pagination.offset),
    })

    if (search.trim()) params.set('search', search.trim())
    if (filterYearId.trim()) params.set('yearId', filterYearId.trim())
    if (filterBookId.trim()) params.set('bookId', filterBookId.trim())
    if (problemTypeId.trim()) params.set('problemTypeId', problemTypeId.trim())

    return `/api/admin/question-bank/backfill?${params.toString()}`
  }, [workspaceSubject, pagination.limit, pagination.offset, search, filterYearId, filterBookId, problemTypeId])

  const loadBackfillState = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const response = await fetch(endpoint)
      const body = await response.json()

      if (!response.ok) {
        setErrorMessage(getErrorMessage(body))
        return
      }

      const data = body as BackfillResponse
      setAudit(data.audit)
      setCandidates(data.candidates ?? [])
      const nextPagination = data.pagination ?? { limit: 100, offset: 0, total: 0 }
      setPagination((current) => (
        current.limit === nextPagination.limit
        && current.offset === nextPagination.offset
        && current.total === nextPagination.total
          ? current
          : nextPagination
      ))
    } catch (error) {
      setErrorMessage('문제은행 백필 감사 정보를 불러오지 못했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [endpoint])

  useEffect(() => {
    loadBackfillState()
  }, [loadBackfillState])

  const selectedCount = selectedIds.size
  const currentPageIds = candidates.map((candidate) => candidate.question_id)
  const currentPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedIds.has(id))

  const toggleCandidate = (questionId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current)

      if (next.has(questionId)) {
        next.delete(questionId)
      } else if (next.size < BACKFILL_BATCH_SIZE) {
        next.add(questionId)
      }

      return next
    })
  }

  const selectCurrentPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)

      for (const questionId of currentPageIds) {
        if (next.size >= BACKFILL_BATCH_SIZE) break
        next.add(questionId)
      }

      return next
    })
  }

  const clearCurrentPage = () => {
    setSelectedIds((current) => {
      const next = new Set(current)

      for (const questionId of currentPageIds) {
        next.delete(questionId)
      }

      return next
    })
  }

  const runBackfill = async (dryRun: boolean) => {
    setIsSubmitting(true)
    setErrorMessage(null)
    setResult(null)
    setResultMode(null)

    try {
      const response = await fetch(`/api/admin/question-bank/backfill?subject=${workspaceSubject}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceQuestionIds: Array.from(selectedIds),
          yearId: yearId.trim(),
          bookId: bookId.trim(),
          dryRun,
        }),
      })
      const body = await response.json()

      if (!response.ok) {
        setErrorMessage(getErrorMessage(body))
        return
      }

      setResult(body.result ?? null)
      setResultMode(dryRun ? 'dry-run' : 'apply')
      if (!dryRun) {
        await loadBackfillState()
      }
    } catch (error) {
      setErrorMessage('문제은행 백필 요청을 완료하지 못했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = selectedCount > 0 && selectedCount <= BACKFILL_BATCH_SIZE && yearId.trim() && bookId.trim() && !isSubmitting

  return (
    <div className="space-y-6">
      {errorMessage && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>감사 요약</CardTitle>
          <CardDescription>관리자 원본, 저장본, AI 생성 제외 대상, 중복 저장본, 누락/패리티 현황을 확인합니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">미분류 관리자 원본</div>
              <div className="text-2xl font-semibold">{countValue(audit?.unassigned_admin_original_count)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">영향받는 저장본</div>
              <div className="text-2xl font-semibold">{countValue(audit?.affected_saved_copy_count)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">AI 생성 제외</div>
              <div className="text-2xl font-semibold">{countValue(audit?.excluded_ai_generated_count)}</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="text-sm text-muted-foreground">중복 저장본</div>
              <div className="text-2xl font-semibold">{countValue(audit?.duplicate_saved_copy_group_count)}</div>
            </div>
            <div className="rounded-md border p-3 md:col-span-2">
              <div className="text-sm text-muted-foreground">누락 메타데이터</div>
              <div className="text-2xl font-semibold">
                관리자 {countValue(audit?.missing_admin_original_metadata_count)} · 저장본 {countValue(audit?.missing_saved_copy_metadata_count)}
              </div>
            </div>
            <div className="rounded-md border p-3 md:col-span-2">
              <div className="text-sm text-muted-foreground">패리티 불일치</div>
              <div className="text-2xl font-semibold">{countValue(audit?.mismatched_saved_copy_metadata_count)}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>후보 필터 및 대상 메타데이터</CardTitle>
          <CardDescription>필터/페이지 기준으로 후보를 불러온 뒤 최대 500개까지 선택해 드라이런 또는 적용합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="backfill-search">검색</Label>
              <Input id="backfill-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="문항 내용" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-year-id">필터 yearId</Label>
              <Input id="filter-year-id" value={filterYearId} onChange={(event) => setFilterYearId(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-book-id">필터 bookId</Label>
              <Input id="filter-book-id" value={filterBookId} onChange={(event) => setFilterBookId(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="filter-problem-type-id">problemTypeId</Label>
              <Input id="filter-problem-type-id" value={problemTypeId} onChange={(event) => setProblemTypeId(event.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="target-year-id">적용할 yearId</Label>
              <Input id="target-year-id" value={yearId} onChange={(event) => setYearId(event.target.value)} placeholder="활성 연도 UUID" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="target-book-id">적용할 bookId</Label>
              <Input id="target-book-id" value={bookId} onChange={(event) => setBookId(event.target.value)} placeholder="활성 교재 UUID" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={loadBackfillState} disabled={isLoading}>후보 새로고침</Button>
            <Button type="button" variant="outline" onClick={currentPageSelected ? clearCurrentPage : selectCurrentPage} disabled={candidates.length === 0}>
              {currentPageSelected ? '현재 페이지 선택 해제' : '현재 페이지 전체 선택'}
            </Button>
            <Button type="button" variant="outline" onClick={() => setSelectedIds(new Set())} disabled={selectedCount === 0}>전체 선택 해제</Button>
            <span className="text-sm text-muted-foreground">선택 {selectedCount} / 최대 500</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => runBackfill(true)} disabled={!canSubmit}>드라이런</Button>
            <Button type="button" onClick={() => runBackfill(false)} disabled={!canSubmit}>적용</Button>
          </div>

          {result && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="font-medium">{resultMode === 'dry-run' ? '드라이런' : '적용'} 결과</div>
              <div>admin_updated_count: {result.admin_updated_count}</div>
              <div>copied_updated_count: {result.copied_updated_count}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>후보 목록</CardTitle>
          <CardDescription>총 {pagination.total}개 중 {pagination.offset + 1}부터 {pagination.offset + candidates.length}까지 표시합니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" disabled={pagination.offset === 0 || isLoading} onClick={() => setPagination((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}>이전</Button>
            <Button type="button" variant="outline" disabled={pagination.offset + pagination.limit >= pagination.total || isLoading} onClick={() => setPagination((current) => ({ ...current, offset: current.offset + current.limit }))}>다음</Button>
            <Label htmlFor="candidate-limit" className="text-sm">페이지 크기</Label>
            <Input
              id="candidate-limit"
              className="w-24"
              value={pagination.limit}
              onChange={(event) => setPagination((current) => ({ ...current, limit: Math.min(Number(event.target.value) || 100, BACKFILL_BATCH_SIZE), offset: 0 }))}
            />
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">불러오는 중입니다.</p>
          ) : candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">백필 후보가 없습니다.</p>
          ) : candidates.map((candidate) => (
            <label key={candidate.question_id} className="flex gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={selectedIds.has(candidate.question_id)}
                onChange={() => toggleCandidate(candidate.question_id)}
              />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="font-medium">{candidate.question_text}</div>
                <div className="text-muted-foreground">{candidate.question_id}</div>
                <div className="text-muted-foreground">
                  저장본 {candidate.affected_saved_copy_count} · 누락 {candidate.missing_metadata ? '예' : '아니오'} · 패리티 {candidate.has_saved_copy_mismatch ? '불일치' : '정상'}
                </div>
                <div className="text-muted-foreground">
                  현재 yearId {candidate.current_year_id ?? '-'} · bookId {candidate.current_book_id ?? '-'} · problemTypeId {candidate.problem_type_id ?? '-'}
                </div>
              </div>
            </label>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>적용 후 검증 가이드</CardTitle>
          <CardDescription>적용 뒤 SQL 콘솔에서 left join 누락 메타데이터 점검과 saved copy parity 확인을 수행하세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1) 관리자 원본과 저장본을 question metadata에 left join 하여 누락된 question_id가 남았는지 확인합니다.</p>
          <p>2) saved copy parity 검증: 저장본의 year_id/book_id가 shared 원본 메타데이터와 같은지 비교합니다.</p>
        </CardContent>
      </Card>
    </div>
  )
}
