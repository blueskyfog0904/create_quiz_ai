'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
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
      if (id === requestId.current) setData(result.data)
    } catch (error) {
      alert(error instanceof Error ? error.message : '후기를 불러오지 못했습니다.')
    } finally {
      if (id === requestId.current) setIsLoading(false)
    }
  }, [workspaceSubject, ratingFilter, search, page, pageSize])

  useEffect(() => {
    void loadReviews()
  }, [loadReviews])

  const deleteReview = async (review: AdminReviewRow) => {
    if (!confirm(`이 후기를 삭제하시겠습니까?\n\n${review.itemTitle}\n"${review.content ?? '(본문 없음)'}"`)) return
    setDeletingId(review.id)
    try {
      const response = await fetch(`/api/admin/reviews/${review.id}`, { method: 'DELETE' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error ?? '삭제에 실패했습니다.')
      }
      await loadReviews()
    } catch (error) {
      alert(error instanceof Error ? error.message : '삭제에 실패했습니다.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={ratingFilter}
          onChange={(event) => {
            setRatingFilter(event.target.value)
            setPage(1)
          }}
          aria-label="별점 필터"
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">전체 별점</option>
          {[5, 4, 3, 2, 1].map((rating) => (
            <option key={rating} value={rating}>{rating}점</option>
          ))}
        </select>
        <form
          className="flex items-center gap-2"
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
            className="w-64"
          />
          <Button type="submit" variant="outline">검색</Button>
        </form>
        {data && <span className="text-sm text-muted-foreground">총 {data.totalCount.toLocaleString()}건</span>}
      </div>

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left">
              <th className="px-4 py-3 font-medium">자료</th>
              <th className="w-16 px-4 py-3 font-medium">별점</th>
              <th className="px-4 py-3 font-medium">본문·태그</th>
              <th className="w-28 px-4 py-3 font-medium">작성자</th>
              <th className="w-20 px-4 py-3 font-medium">도움</th>
              <th className="w-28 px-4 py-3 font-medium">작성일</th>
              <th className="w-20 px-4 py-3 font-medium">작업</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">불러오는 중…</td></tr>
            ) : !data || data.rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">후기가 없습니다.</td></tr>
            ) : (
              data.rows.map((review) => (
                <tr key={review.id} className="border-b align-top last:border-b-0">
                  <td className="max-w-64 break-keep px-4 py-3">{review.itemTitle}</td>
                  <td className="px-4 py-3">★ {review.rating}</td>
                  <td className="px-4 py-3">
                    <p className="whitespace-pre-line break-keep">{review.content ?? <span className="text-muted-foreground">(본문 없음)</span>}</p>
                    {review.tagLabels.length > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">{review.tagLabels.join(' · ')}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">{review.authorName}</td>
                  <td className="px-4 py-3">{review.helpfulCount}</td>
                  <td className="px-4 py-3">{formatDate(review.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                      disabled={deletingId === review.id}
                      onClick={() => void deleteReview(review)}
                    >
                      {deletingId === review.id ? '삭제 중…' : '삭제'}
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {data && <StudioListPagination page={data.page} pageSize={pageSize} totalCount={data.totalCount} onPageChange={setPage} onPageSizeChange={listQuery.setPageSize} />}
    </div>
  )
}
