'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, type MouseEvent } from 'react'
import {
  FileImage,
  FileText,
  Star,
} from 'lucide-react'
import {
  StudioBoardShell,
  StudioEmptyState,
  StudioPagination,
  StudioSelectContent,
} from '@/components/design-system'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type {
  MarketBoardData,
  MarketBoardRow,
  MarketBoardSort,
} from '@/lib/market-board'
import MarketSamplePreviewDialog from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface RealMarketBoardResultsProps {
  data: MarketBoardData
  categorySlug: string
  subject: WorkspaceSubject
  search: string
  year: string
  sort: MarketBoardSort
}

function buildBoardHref({
  categorySlug,
  subject,
  search,
  year,
  sort,
  page,
}: {
  categorySlug: string
  subject: WorkspaceSubject
  search: string
  year: string
  sort: MarketBoardSort
  page?: number
}) {
  const pathname = `/preview/solvook-concept/boards/${categorySlug}`
  const query = new URLSearchParams()

  query.set('subject', subject)

  if (search) query.set('search', search)
  if (year) query.set('year', year)
  if (sort === 'latest') query.set('sort', sort)
  if (page && page > 1) query.set('page', String(page))

  return `${pathname}?${query.toString()}`
}

function Thumbnail({ row }: { row: MarketBoardRow }) {
  if (row.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- public preview rows can point to remote thumbnails outside Next image optimization.
      <img
        src={row.thumbnailUrl}
        alt=""
        className="h-[79px] w-[56px] rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] object-cover"
      />
    )
  }

  return (
    <div className="flex h-[79px] w-[56px] items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]">
      <FileImage aria-hidden="true" className="h-4 w-4" />
    </div>
  )
}

export function RealMarketBoardResults({
  data,
  categorySlug,
  subject,
  search,
  year,
  sort,
}: RealMarketBoardResultsProps) {
  const router = useRouter()
  const sampleTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [samplePreviewPrefetchKey, setSamplePreviewPrefetchKey] = useState(0)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)

  function prefetchSamplePreview(itemId: string) {
    setSamplePreviewItemId(itemId)
    setSamplePreviewPrefetchKey((key) => key + 1)
  }

  function openSamplePreview(event: MouseEvent<HTMLButtonElement>, itemId: string) {
    sampleTriggerRef.current = event.currentTarget
    setSamplePreviewItemId(itemId)
    setIsSamplePreviewOpen(true)
  }

  const summary = (
    <div className="space-y-1">
      <p className="text-sm font-extrabold text-[var(--studio-ink)]">
        총 {data.total.toLocaleString()}개 자료
      </p>
      <p className="text-sm text-[var(--studio-muted)]">
        {data.pagination.page} / {Math.max(data.pagination.pageCount, 1)} 페이지
      </p>
    </div>
  )

  const toolbar = (
    <Select
      value={sort}
      onValueChange={(value) => {
        const nextSort: MarketBoardSort = value === 'latest' ? 'latest' : 'views'
        router.push(buildBoardHref({
          categorySlug,
          subject,
          search,
          year,
          sort: nextSort,
        }), { scroll: false })
      }}
    >
      <SelectTrigger
        aria-label="자료 정렬"
        className="min-h-11 w-28 border-0 bg-transparent shadow-none focus-visible:ring-[var(--studio-focus-ring)]"
      >
        <SelectValue />
      </SelectTrigger>
      <StudioSelectContent align="end">
        <SelectItem value="views">인기순</SelectItem>
        <SelectItem value="latest">최신순</SelectItem>
      </StudioSelectContent>
    </Select>
  )

  const pagination = data.total > 0 ? (
    <StudioPagination
      page={data.pagination.page}
      totalPages={Math.max(data.pagination.pageCount, 1)}
      onPageChange={() => {}}
      navigationText={{
        first: '<<',
        previous: '<',
        next: '>',
        last: '>>',
      }}
      getPageHref={(page) => buildBoardHref({
        categorySlug,
        subject,
        search,
        year,
        sort,
        page,
      })}
    />
  ) : null

  const results = data.rows.length === 0 ? (
    <StudioEmptyState
      icon={<FileText className="size-6" />}
      title="조건에 맞는 자료가 없습니다"
      description="검색어나 필터를 조정해 다른 공개 자료를 찾아보세요."
      action={(
        <Button asChild variant="brandOutline">
          <Link href={`/preview/solvook-concept/boards/${categorySlug}?subject=${subject}`}>
            필터 초기화
          </Link>
        </Button>
      )}
    />
  ) : (
    <div className="bg-[var(--studio-surface)]">
      <ul role="list" className="divide-y divide-[var(--studio-border)]">
        {data.rows.map((row) => {
          const detailHref = `/preview/solvook-concept/boards/ebs-literature/posts/jingsori-2027?subject=${subject}`
          const metadataLabels = Array.from(new Set([
            ...row.sourceFields.map((field) => field.value),
            row.materialType,
            row.questionCount !== null ? `${row.questionCount}문항` : null,
          ].filter((value): value is string => Boolean(value)))).slice(0, 2)

          return (
            <li key={row.id} className="px-4 py-5 sm:px-5">
              <div className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 md:grid-cols-[56px_minmax(0,1fr)_auto] md:gap-x-5">
                <Thumbnail row={row} />

                <div className="min-w-0">
                  <Link
                    href={detailHref}
                    className="flex min-h-11 items-center break-keep text-lg font-semibold leading-7 text-[var(--studio-text)] outline-none transition hover:text-[var(--studio-primary)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                  >
                    {row.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <p className="[font-family:var(--studio-font-price)] text-base font-semibold leading-6 text-[var(--studio-ink)]">
                      {row.startingPriceCredits === null
                        ? '가격 정보 없음'
                        : `${row.startingPriceCredits.toLocaleString('ko-KR')} 크레딧`}
                    </p>
                    <span aria-hidden="true" className="text-[var(--studio-border)]">·</span>
                    <p className="flex items-center gap-1 text-xs text-[var(--studio-muted)]">
                      <Star
                        aria-hidden="true"
                        className="size-4 fill-current text-amber-400"
                      />
                      {row.ratingAverage === null
                        ? '0.0'
                        : `${row.ratingAverage.toFixed(1)} (${row.ratingCount.toLocaleString('ko-KR')})`}
                    </p>
                  </div>
                </div>

                <div className="col-start-2 flex flex-wrap items-center justify-between gap-3 md:col-start-3 md:row-start-1 md:flex-col md:items-end md:self-center">
                  {metadataLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 md:justify-end">
                      {metadataLabels.map((label) => (
                        <span
                          key={`${row.id}-${label}`}
                          className="rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] px-2 py-1 text-xs font-semibold text-[var(--studio-primary)]"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {row.sample.available ? (
                    <Button
                      type="button"
                      variant="brandOutline"
                      onFocus={() => prefetchSamplePreview(row.id)}
                      onMouseEnter={() => prefetchSamplePreview(row.id)}
                      onClick={(event) => openSamplePreview(event, row.id)}
                    >
                      샘플보기
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )

  return (
    <>
      <StudioBoardShell
        summary={summary}
        toolbar={toolbar}
        pagination={pagination}
        results={results}
      />

      {samplePreviewItemId ? (
        <MarketSamplePreviewDialog
          key={samplePreviewItemId}
          itemId={samplePreviewItemId}
          workspaceSubject={subject}
          open={isSamplePreviewOpen}
          prefetchKey={samplePreviewPrefetchKey}
          onOpenChange={setIsSamplePreviewOpen}
          returnFocusRef={sampleTriggerRef}
        />
      ) : null}
    </>
  )
}
