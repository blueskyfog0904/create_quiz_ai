'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FileText } from 'lucide-react'
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
import type { MarketBoardData, MarketBoardSort } from '@/lib/market-board'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialList } from '../market-material-list'

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

export function RealMarketBoardResults({
  data,
  categorySlug,
  subject,
  search,
  year,
  sort,
}: RealMarketBoardResultsProps) {
  const router = useRouter()

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
      <MarketMaterialList
        subject={subject}
        items={data.rows.map((row) => ({
          id: row.id,
          title: row.title,
          thumbnailUrl: row.thumbnailUrl,
          detailHref: `/preview/solvook-concept/boards/${categorySlug}/items/${row.id}?subject=${subject}`,
          metadataLabels: Array.from(new Set([
            ...row.sourceFields.map((field) => field.value),
            row.materialType,
            row.questionCount !== null ? `${row.questionCount}문항` : null,
          ].filter((value): value is string => Boolean(value)))).slice(0, 2),
          sampleAvailable: row.sample.available,
          startingPriceCredits: row.startingPriceCredits,
          ratingAverage: row.ratingAverage,
          ratingCount: row.ratingCount,
        }))}
      />
    </div>
  )

  return (
    <StudioBoardShell
      summary={summary}
      toolbar={toolbar}
      pagination={pagination}
      results={results}
    />
  )
}
