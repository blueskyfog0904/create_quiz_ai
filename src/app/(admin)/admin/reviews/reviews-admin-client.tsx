'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { useAdminConfirm } from '@/components/admin/kit/admin-confirm-dialog'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminFilterBar } from '@/components/admin/kit/admin-filter-bar'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { ADMIN_UNAVAILABLE } from '@/lib/admin-format'
import { useListQuery } from '@/hooks/use-list-query'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface AdminReviewRow {
  id: string
  itemTitle: string
  rating: number
  content: string | null
  tagLabels: string[]
  helpfulCount: number
  authorName: string
  createdAt: string
}

interface AdminReviewsData {
  rows: AdminReviewRow[]
  totalCount: number
  page: number
  totalPages: number
}

const FILTER_SELECT_CLASS =
  'h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-text)] max-sm:w-full'

// 날짜 표기는 지금 모양(YYYY.MM.DD) 그대로(20번: 대표가 바꾸기로 정하기 전까지).
function formatDate(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

export default function ReviewsAdminClient({ workspaceSubject }: { workspaceSubject: WorkspaceSubject }) {
  const [data, setData] = useState<AdminReviewsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const listQuery = useListQuery()
  const { page, pageSize, setPage } = listQuery
  const ratingFilter = listQuery.params.get('rating') ?? ''
  const search = listQuery.params.get('q') ?? ''
  const setRatingFilter = (rating: string) => listQuery.update({ rating, page: 1 })
  const setSearch = (q: string) => listQuery.update({ q, page: 1 })
  const requestId = useRef(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  // 20번: 브라우저 알림 창 대신 같은 문구를 화면 안에 보인다(읽기 = 표 실패 칸·오류 띠, 삭제 = 오류 띠).
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const actionErrorRef = useRef<HTMLDivElement>(null)
  const { ask, dialog: confirmDialog } = useAdminConfirm()

  const loadReviews = useCallback(async () => {
    const id = ++requestId.current
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ subject: workspaceSubject, page: String(page), pageSize: String(pageSize) })
      if (ratingFilter) params.set('rating', ratingFilter)
      if (search) params.set('search', search)
      const response = await fetch(`/api/admin/reviews?${params.toString()}`)
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '후기를 불러오지 못했습니다.')
      }
      if (id === requestId.current) {
        setData(result.data)
        setLoadError(null)
      }
    } catch (error) {
      if (id === requestId.current) setLoadError(error instanceof Error ? error.message : '후기를 불러오지 못했습니다.')
    } finally {
      if (id === requestId.current) setIsLoading(false)
    }
  }, [workspaceSubject, ratingFilter, search, page, pageSize])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  // 알림 창은 늘 보였으므로, 위쪽 띠도 오류가 생기면 그 자리로 옮겨 보인다.
  useEffect(() => {
    if (actionError) actionErrorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [actionError])

  const deleteReview = async (review: AdminReviewRow) => {
    // (가) 먼저 묻기: 확인 전에는 요청을 보내지 않는다.
    const confirmed = await ask({
      title: '이 후기를 삭제하시겠습니까?',
      description: <span data-admin-pii="" className="whitespace-pre-line break-keep">{`${review.itemTitle}\n"${review.content ?? '(본문 없음)'}"`}</span>,
      confirmLabel: '삭제',
      danger: true,
    })
    if (!confirmed) return
    setActionError(null)
    setDeletingId(review.id)
    try {
      const response = await fetch(`/api/admin/reviews/${review.id}`, { method: 'DELETE' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '삭제에 실패했습니다.')
      }
      await loadReviews()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '삭제에 실패했습니다.')
    } finally {
      setDeletingId(null)
    }
  }

  const columns: AdminDataTableColumn<AdminReviewRow>[] = [
    { key: 'item', header: '자료', className: 'max-w-64 break-keep', cell: (review) => review.itemTitle },
    { key: 'rating', header: '별점', className: 'whitespace-nowrap', cell: (review) => `★ ${review.rating}` },
    {
      key: 'content',
      header: '본문·태그',
      // 후기 본문은 화면 비교 때 가린다.
      pii: true,
      cell: (review) => (
        <>
          <p className="whitespace-pre-line break-keep">{review.content ?? <span className="text-[var(--studio-muted)]">(본문 없음)</span>}</p>
          {review.tagLabels.length > 0 && (
            <p className="mt-1 text-xs text-[var(--studio-muted)]">{review.tagLabels.join(' · ')}</p>
          )}
        </>
      ),
    },
    { key: 'author', header: '작성자', className: 'w-28', cell: (review) => review.authorName },
    { key: 'helpful', header: '도움', numeric: true, className: 'w-20', cell: (review) => review.helpfulCount },
    { key: 'createdAt', header: '작성일', className: 'w-28 whitespace-nowrap', cell: (review) => formatDate(review.createdAt) },
    {
      key: 'actions',
      header: '작업',
      cell: (review) => (
        <Button
          type="button"
          size="sm"
          variant="adminTable"
          className="text-[var(--admin-tone-danger-text)]"
          disabled={deletingId === review.id}
          onClick={() => void deleteReview(review)}
        >
          {deletingId === review.id ? '삭제 중…' : '삭제'}
        </Button>
      ),
    },
  ]

  const tableState = isLoading ? (
    <AdminTableState kind="loading" />
  ) : loadError && !data ? (
    <AdminTableState kind="error" message={loadError} onRetry={() => void loadReviews()} />
  ) : !data || data.rows.length === 0 ? (
    <AdminTableState kind="empty" message="후기가 없습니다." />
  ) : undefined

  return (
    <div className="space-y-4">
      <AdminFilterBar
        className="mb-0"
        search={
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault()
              setSearch(String(new FormData(event.currentTarget).get('q') ?? '').trim())
              setPage(1)
            }}
          >
            <Input
              key={search}
              name="q"
              defaultValue={search}
              placeholder="자료명·본문 검색"
              aria-label="후기 검색"
              className="w-64 max-sm:w-full"
            />
            <Button type="submit" variant="brand">검색</Button>
          </form>
        }
        filters={
          <select
            value={ratingFilter}
            onChange={(event) => {
              setRatingFilter(event.target.value)
              setPage(1)
            }}
            aria-label="별점 필터"
            className={FILTER_SELECT_CLASS}
          >
            <option value="">전체 별점</option>
            {[5, 4, 3, 2, 1].map((rating) => (
              <option key={rating} value={rating}>{rating}점</option>
            ))}
          </select>
        }
        resultCount={data ? data.totalCount : loadError ? ADMIN_UNAVAILABLE : undefined}
      />

      {actionError ? <div ref={actionErrorRef}><AdminNotice kind="error">{actionError}</AdminNotice></div> : null}
      {loadError && data ? <AdminNotice kind="error" onRetry={() => void loadReviews()}>{loadError}</AdminNotice> : null}

      {/* 1단계 메모: 이 표만 가로 넘침 틀이 없어 좁은 폭에서 카드 밖으로 삐져나왔다 → 표 부품(표 안 가로 스크롤). */}
      <AdminDataTable
        caption="후기 목록"
        columns={columns}
        rows={data?.rows ?? []}
        getRowKey={(review) => review.id}
        minWidth={860}
        state={tableState}
      />

      {data && <StudioListPagination page={data.page} pageSize={pageSize} totalCount={data.totalCount} onPageChange={setPage} onPageSizeChange={listQuery.setPageSize} />}

      {confirmDialog}
    </div>
  )
}
