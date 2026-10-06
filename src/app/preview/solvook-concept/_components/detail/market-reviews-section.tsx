'use client'

import { useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Star, ThumbsUp, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { MarketItemReviewsResult, MarketReviewSort } from '@/lib/market-reviews-server'

interface MarketReviewsSectionProps {
  itemId: string
  isLoggedIn: boolean
  reviews: MarketItemReviewsResult
  sort: MarketReviewSort
}

const ROLE_LABELS: Record<string, string> = {
  teacher: '교사',
  instructor: '강사',
  student: '학생',
  parent: '학부모',
  academy_instructor: '학원강사',
}

function formatReviewDate(value: string) {
  const date = new Date(value)
  const yy = String(date.getFullYear()).slice(2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}.${mm}.${dd}`
}

function Stars({ value, size = 'sm' }: { value: number; size?: 'sm' | 'lg' }) {
  const sizeClass = size === 'lg' ? 'size-7' : 'size-4'
  return (
    <span aria-label={`별점 ${value}점`} className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          aria-hidden="true"
          className={`${sizeClass} ${step <= value ? 'fill-current text-amber-400' : 'fill-current text-[var(--studio-border)]'}`}
        />
      ))}
    </span>
  )
}

export function MarketReviewsSection({ itemId, isLoggedIn, reviews, sort }: MarketReviewsSectionProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [draftRating, setDraftRating] = useState(reviews.viewer.myReview?.rating ?? 5)
  const [draftTagIds, setDraftTagIds] = useState<string[]>(reviews.viewer.myReview?.tagIds ?? [])
  const [draftContent, setDraftContent] = useState(reviews.viewer.myReview?.content ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [votingReviewId, setVotingReviewId] = useState<string | null>(null)

  const { summary, viewer } = reviews
  const roundedAverage = summary.average === null ? 0 : Math.round(summary.average)

  // 정렬 변경 시 기존 파라미터(subject 포함)를 반드시 보존한다 — subject 누락 시 상세가 404
  const handleSortChange = (nextSort: MarketReviewSort) => {
    const params = new URLSearchParams(searchParams.toString())
    if (nextSort === 'latest') params.delete('reviewSort')
    else params.set('reviewSort', nextSort)
    router.replace(`${pathname}?${params.toString()}#market-reviews`, { scroll: false })
  }

  const openWriteForm = () => {
    setDraftRating(reviews.viewer.myReview?.rating ?? 5)
    setDraftTagIds(reviews.viewer.myReview?.tagIds ?? [])
    setDraftContent(reviews.viewer.myReview?.content ?? '')
    setIsFormOpen(true)
  }

  const toggleDraftTag = (tagId: string) => {
    setDraftTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    )
  }

  const submitReview = async () => {
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/market/items/${itemId}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: draftRating,
          content: draftContent.trim() || null,
          tagIds: draftTagIds,
        }),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error?.message ?? '후기 등록에 실패했습니다.')
      }
      setIsFormOpen(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : '후기 등록에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteMyReview = async () => {
    if (!reviews.viewer.myReview) return
    if (!confirm('작성한 후기를 삭제하시겠습니까?')) return
    try {
      const response = await fetch(`/api/market/reviews/${reviews.viewer.myReview.id}`, { method: 'DELETE' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error?.message ?? '후기 삭제에 실패했습니다.')
      }
      setIsFormOpen(false)
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : '후기 삭제에 실패했습니다.')
    }
  }

  const toggleVote = async (reviewId: string, isMine: boolean) => {
    if (!isLoggedIn) {
      alert('로그인 후 이용할 수 있습니다.')
      return
    }
    if (isMine) return
    setVotingReviewId(reviewId)
    try {
      const response = await fetch(`/api/market/reviews/${reviewId}/vote`, { method: 'POST' })
      const result = await response.json().catch(() => null)
      if (!response.ok || !result?.success) {
        throw new Error(result?.error?.message ?? '처리에 실패했습니다.')
      }
      router.refresh()
    } catch (error) {
      alert(error instanceof Error ? error.message : '처리에 실패했습니다.')
    } finally {
      setVotingReviewId(null)
    }
  }

  return (
    <section
      id="market-reviews"
      aria-labelledby="market-reviews-heading"
      className="scroll-mt-36 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="market-reviews-heading" className="text-2xl font-extrabold text-[var(--studio-ink)]">
            평점 및 후기 <span className="text-[var(--studio-primary)]">{summary.count}</span>
          </h2>
        </div>
        {summary.count > 1 && (
          <select
            value={sort}
            onChange={(event) => handleSortChange(event.target.value as MarketReviewSort)}
            aria-label="후기 정렬"
            className="min-h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <option value="latest">작성일순</option>
            <option value="helpful">도움순</option>
          </select>
        )}
      </div>

      <div className="mt-5 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-5 py-7 text-center">
        {summary.count > 0 ? (
          <>
            <Stars value={roundedAverage} size="lg" />
            <p className="mt-3 text-xl font-semibold text-[var(--studio-ink)]">
              전체 후기 평균 {summary.average!.toFixed(1)}점
            </p>
          </>
        ) : (
          <p className="text-sm text-[var(--studio-muted)]">
            아직 등록된 후기가 없습니다. 첫 후기를 남겨보세요.
          </p>
        )}
      </div>

      {/* 작성 영역 */}
      <div className="mt-5">
        {viewer.canWrite ? (
          isFormOpen || !viewer.myReview ? (
            <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] p-5">
              <p className="text-sm font-bold text-[var(--studio-ink)]">
                {viewer.myReview ? '내 후기 수정' : '후기 작성'}
              </p>
              <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="별점 선택">
                {[1, 2, 3, 4, 5].map((step) => (
                  <button
                    key={step}
                    type="button"
                    role="radio"
                    aria-checked={draftRating === step}
                    aria-label={`${step}점`}
                    onClick={() => setDraftRating(step)}
                    className="rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                  >
                    <Star
                      aria-hidden="true"
                      className={`size-7 ${step <= draftRating ? 'fill-current text-amber-400' : 'fill-current text-[var(--studio-border)]'}`}
                    />
                  </button>
                ))}
                <span className="ml-2 text-sm font-semibold text-[var(--studio-ink)]">{draftRating}점</span>
              </div>
              {reviews.activeTags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {reviews.activeTags.map((tag) => {
                    const selected = draftTagIds.includes(tag.id)
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleDraftTag(tag.id)}
                        className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                          selected
                            ? 'border-[var(--studio-primary)] bg-[var(--studio-primary-soft)] font-semibold text-[var(--studio-primary)]'
                            : 'border-[var(--studio-border)] text-[var(--studio-text)] hover:border-[var(--studio-primary-border)]'
                        }`}
                      >
                        {tag.label}
                      </button>
                    )
                  })}
                </div>
              )}
              <textarea
                value={draftContent}
                onChange={(event) => setDraftContent(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="자료에 대한 후기를 남겨주세요. (선택)"
                className="mt-4 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 py-2.5 text-sm text-[var(--studio-ink)] outline-none placeholder:text-[var(--studio-muted)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              />
              <div className="mt-3 flex items-center justify-end gap-2">
                {viewer.myReview && (
                  <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>
                    취소
                  </Button>
                )}
                <Button type="button" variant="brand" disabled={isSubmitting} onClick={() => void submitReview()}>
                  {isSubmitting ? '등록 중…' : viewer.myReview ? '후기 수정' : '후기 등록'}
                </Button>
              </div>
            </div>
          ) : null
        ) : (
          <p className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-4 py-3 text-sm text-[var(--studio-muted)]">
            {isLoggedIn
              ? '구매한 자료에만 후기를 작성할 수 있습니다.'
              : '로그인 후 구매한 자료에 후기를 작성할 수 있습니다.'}
          </p>
        )}
      </div>

      {/* 후기 목록 */}
      {reviews.reviews.length > 0 && (
        <ul className="mt-2 divide-y divide-[var(--studio-border)]">
          {reviews.reviews.map((review) => {
            const roleLabel = review.author.role ? ROLE_LABELS[review.author.role] : null
            return (
              <li key={review.id} className="py-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {review.author.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 외부 아바타 URL
                      <img src={review.author.avatarUrl} alt="" className="size-11 rounded-full border border-[var(--studio-border)] object-cover" />
                    ) : (
                      <span className="grid size-11 place-items-center rounded-full bg-[var(--studio-background)] text-[var(--studio-muted)]">
                        <UserRound aria-hidden="true" className="size-5" />
                      </span>
                    )}
                    <div>
                      <p className="flex items-center gap-2 text-sm font-bold text-[var(--studio-ink)]">
                        {review.author.name}
                        {roleLabel && (
                          <span className="rounded border border-[var(--studio-border)] px-1.5 py-0.5 text-xs font-medium text-[var(--studio-muted)]">
                            {roleLabel}
                          </span>
                        )}
                        {review.isMine && (
                          <span className="rounded bg-[var(--studio-primary-soft)] px-1.5 py-0.5 text-xs font-semibold text-[var(--studio-primary)]">
                            내 후기
                          </span>
                        )}
                      </p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-[var(--studio-muted)]">
                        <Stars value={review.rating} />
                        {formatReviewDate(review.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {review.isMine ? (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={openWriteForm}>
                          수정
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => void deleteMyReview()}>
                          삭제
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={votingReviewId === review.id}
                        onClick={() => void toggleVote(review.id, review.isMine)}
                        className={`inline-flex min-h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                          review.votedByViewer
                            ? 'border-[var(--studio-primary)] bg-[var(--studio-primary-soft)] text-[var(--studio-primary)]'
                            : 'border-[var(--studio-control-border)] text-[var(--studio-text)] hover:border-[var(--studio-primary-border)] hover:text-[var(--studio-primary)]'
                        }`}
                      >
                        {votingReviewId === review.id ? (
                          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                        ) : (
                          <ThumbsUp aria-hidden="true" className="size-4" />
                        )}
                        도움이 됐어요 {review.helpfulCount}
                      </button>
                    )}
                  </div>
                </div>
                {review.content && (
                  <p className="mt-4 whitespace-pre-line break-keep text-sm leading-6 text-[var(--studio-text)]">
                    {review.content}
                  </p>
                )}
                {review.tagLabels.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {review.tagLabels.map((label) => (
                      <span
                        key={`${review.id}-${label}`}
                        className="inline-flex items-center rounded-md bg-[var(--studio-background)] px-2.5 py-1.5 text-sm text-[var(--studio-text)]"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
