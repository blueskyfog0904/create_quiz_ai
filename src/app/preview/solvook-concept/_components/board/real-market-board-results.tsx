'use client'

import Link from 'next/link'
import { useRef, useState, type MouseEvent } from 'react'
import {
  FileImage,
  FileText,
} from 'lucide-react'
import {
  StudioBoardShell,
  StudioEmptyState,
  StudioPagination,
} from '@/components/design-system'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  MarketBoardData,
  MarketBoardRow,
  MarketBoardSort,
} from '@/lib/market-board'
import MarketSamplePreviewDialog from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const SORT_OPTIONS: Array<{ value: MarketBoardSort; label: string }> = [
  { value: 'latest', label: '최신순' },
  { value: 'views', label: '조회순' },
  { value: 'questions', label: '문항순' },
]

interface RealMarketBoardResultsProps {
  data: MarketBoardData
  categorySlug: string
  subject: WorkspaceSubject
  search: string
  year: string
  month: string
  grade: string
  sourceType: string
  source1: string
  source2: string
  source3: string
  source4: string
  sort: MarketBoardSort
  pageSize: number
}

function formatPublishedDate(value: string) {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}.${month}.${day}`
}

function formatExamMeta(row: MarketBoardRow) {
  const segments = [
    row.examYear ? `${row.examYear}년` : null,
    row.examMonth ? `${row.examMonth}월` : null,
    row.gradeLevel,
  ].filter(Boolean)

  return segments.length > 0 ? segments.join(' · ') : '출제 정보 없음'
}

function buildBoardHref({
  categorySlug,
  subject,
  search,
  year,
  month,
  grade,
  sourceType,
  source1,
  source2,
  source3,
  source4,
  sort,
  page,
  pageSize,
}: {
  categorySlug: string
  subject: WorkspaceSubject
  search: string
  year: string
  month: string
  grade: string
  sourceType: string
  source1: string
  source2: string
  source3: string
  source4: string
  sort: MarketBoardSort
  page?: number
  pageSize: number
}) {
  const pathname = `/preview/solvook-concept/boards/${categorySlug}`
  const query = new URLSearchParams()

  query.set('subject', subject)

  if (search) query.set('search', search)
  if (year) query.set('year', year)
  if (month) query.set('month', month)
  if (grade) query.set('grade', grade)
  if (sourceType) query.set('sourceType', sourceType)
  if (source1) query.set('source1', source1)
  if (source2) query.set('source2', source2)
  if (source3) query.set('source3', source3)
  if (source4) query.set('source4', source4)
  if (sort !== 'latest') query.set('sort', sort)
  if (pageSize !== 10) query.set('pageSize', String(pageSize))
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
        className="h-[79px] w-[56px] rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] object-cover md:h-[132px] md:w-[94px] md:self-center"
      />
    )
  }

  return (
    <div className="flex h-[79px] w-[56px] items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)] md:h-[132px] md:w-[94px] md:self-center">
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
  month,
  grade,
  sourceType,
  source1,
  source2,
  source3,
  source4,
  sort,
  pageSize,
}: RealMarketBoardResultsProps) {
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
    <>
      <div className="flex flex-wrap items-center gap-2">
        {SORT_OPTIONS.map((option) => (
          <Button
            key={option.value}
            asChild
            variant={sort === option.value ? 'brand' : 'brandGhost'}
            className="px-3"
          >
            <Link
              aria-current={sort === option.value ? 'page' : undefined}
              href={buildBoardHref({
                categorySlug,
                subject,
                search,
                year,
                month,
                grade,
                sourceType,
                source1,
                source2,
                source3,
                source4,
                sort: option.value,
                pageSize,
              })}
            >
              {option.label}
            </Link>
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PAGE_SIZE_OPTIONS.map((option) => (
          <Button
            key={option}
            asChild
            variant={pageSize === option ? 'brandOutline' : 'brandGhost'}
            className="px-3"
          >
            <Link
              aria-current={pageSize === option ? 'page' : undefined}
              href={buildBoardHref({
                categorySlug,
                subject,
                search,
                year,
                month,
                grade,
                sourceType,
                source1,
                source2,
                source3,
                source4,
                sort,
                pageSize: option,
              })}
            >
              {option}개씩
            </Link>
          </Button>
        ))}
      </div>
    </>
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
        month,
        grade,
        sourceType,
        source1,
        source2,
        source3,
        source4,
        sort,
        page,
        pageSize,
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
    <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] shadow-[var(--studio-shadow-card)]">
      <ul role="list" className="divide-y divide-[var(--studio-border)]">
        {data.rows.map((row) => {
          const detailHref = `/${subject}/market/${categorySlug}/items/${row.id}`

          return (
            <li key={row.id} className="px-4 py-4 sm:px-5">
              <div className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 md:grid-cols-[96px_minmax(0,1fr)_auto] md:gap-x-5">
                <Thumbnail row={row} />

                <div className="min-w-0 space-y-3">
                  <div className="min-w-0">
                    <Link
                      href={detailHref}
                      className="block min-h-11 break-keep text-sm font-semibold leading-5 text-[var(--studio-text)] outline-none transition hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                    >
                      {row.title}
                    </Link>
                    <p className="mt-0.5 text-xs leading-5 text-[var(--studio-muted)]">
                      {formatExamMeta(row)}
                    </p>
                  </div>

                  {row.summary ? (
                    <p className="break-keep text-sm leading-6 text-[var(--studio-text)]">
                      {row.summary}
                    </p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                      {row.categoryTitle}
                    </Badge>
                    {row.materialType ? (
                      <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                        {row.materialType}
                      </Badge>
                    ) : null}
                    {row.questionCount !== null ? (
                      <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                        {row.questionCount}문항
                      </Badge>
                    ) : null}
                    <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                      조회 {row.viewCount.toLocaleString()}
                    </Badge>
                    <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                      {formatPublishedDate(row.publishedAt)}
                    </Badge>
                  </div>

                  {row.sourceFields.length > 0 ? (
                    <dl className="grid gap-2 text-sm text-[var(--studio-text)] sm:grid-cols-2">
                      {row.sourceFields.map((field) => (
                        <div key={`${row.id}-${field.label}`} className="min-w-0">
                          <dt className="text-xs font-extrabold text-[var(--studio-muted)]">
                            {field.label}
                          </dt>
                          <dd className="mt-0.5 break-keep">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}

                  {row.fileTypeLabels.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {row.fileTypeLabels.map((label) => (
                        <Badge
                          key={`${row.id}-${label}`}
                          variant="outline"
                          className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]"
                        >
                          {label}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>

                {row.sample.available ? (
                  <Button
                    type="button"
                    variant="brandOutline"
                    className="col-start-2 justify-self-end md:col-start-3 md:row-start-1 md:self-center"
                    onFocus={() => prefetchSamplePreview(row.id)}
                    onMouseEnter={() => prefetchSamplePreview(row.id)}
                    onClick={(event) => openSamplePreview(event, row.id)}
                  >
                    샘플보기
                  </Button>
                ) : null}
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
