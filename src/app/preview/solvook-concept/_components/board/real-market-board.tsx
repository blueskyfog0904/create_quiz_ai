import Link from 'next/link'
import { Search } from 'lucide-react'
import {
  StudioContainer,
  StudioFilterPanel,
} from '@/components/design-system'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { MarketBoardData, MarketBoardSort } from '@/lib/market-board'
import { BoardCategorySidebar } from './board-category-sidebar'
import { RealMarketBoardResults } from './real-market-board-results'

const SUBJECT_LABELS = {
  english: '영어',
  korean: '국어',
} as const

export interface RealMarketBoardFilterState {
  search: string
  year: string
  sort: MarketBoardSort
}

function nativeSelectClassName() {
  return 'flex h-11 w-full rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-text)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]'
}

export function RealMarketBoard({
  data,
  filters,
}: {
  data: MarketBoardData
  filters: RealMarketBoardFilterState
}) {
  const subjectLabel = SUBJECT_LABELS[data.subject]

  return (
    <div className="studio-reference-gutter overflow-x-hidden py-6 sm:py-8">
      <StudioContainer className="relative space-y-6">
        <div
          data-slot="market-board-layout"
          className="grid gap-6"
        >
            <BoardCategorySidebar
              groups={data.groups}
              categorySlug={data.category.slug}
              subject={data.subject}
              search={filters.search}
              year={filters.year}
              sort={filters.sort}
            />

            <div data-slot="market-board-content" className="min-w-0 space-y-6">
              <header>
                <div>
                  <p className="text-sm font-medium text-[var(--studio-muted)]">
                    {subjectLabel} / {data.category.title}
                  </p>
                  <h1 className="mt-2 break-keep text-3xl font-black tracking-[-0.04em] text-[var(--studio-ink)]">
                    {data.category.title}
                  </h1>
                </div>
              </header>

              <form method="get" className="space-y-6">
                <input type="hidden" name="subject" value={data.subject} />
                <input type="hidden" name="sort" value={filters.sort} />

                <StudioFilterPanel
                  fields={(
                    <>
                      <div className="min-w-0 flex-[1.8]">
                        <label htmlFor="board-title-search" className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]">
                          제목 검색
                        </label>
                        <div className="relative">
                          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--studio-muted)]" />
                          <Input
                            id="board-title-search"
                            name="search"
                            defaultValue={filters.search}
                            placeholder="자료 제목을 검색하세요"
                            className="min-h-11 pl-9"
                          />
                        </div>
                      </div>

                      <div className="min-w-0">
                        <label htmlFor="board-year" className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]">
                          연도
                        </label>
                        <select
                          id="board-year"
                          name="year"
                          defaultValue={filters.year}
                          className={nativeSelectClassName()}
                        >
                          <option value="">전체</option>
                          {data.filters.years.map((year) => (
                            <option key={year} value={String(year)}>
                              {year}년
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  activeFilters={(
                    <>
                      {filters.search ? (
                        <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                          검색: {filters.search}
                        </Badge>
                      ) : null}
                      {filters.year ? (
                        <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                          연도: {filters.year}
                        </Badge>
                      ) : null}
                    </>
                  )}
                  actions={(
                    <>
                      <Button type="submit" variant="brand">
                        필터 적용
                      </Button>
                      <Button asChild variant="brandOutline">
                        <Link href={`/preview/solvook-concept/boards/${data.category.slug}?subject=${data.subject}`}>
                          초기화
                        </Link>
                      </Button>
                    </>
                  )}
                />
              </form>

              <RealMarketBoardResults
                data={data}
                categorySlug={data.category.slug}
                subject={data.subject}
                search={filters.search}
                year={filters.year}
                sort={filters.sort}
              />
            </div>
        </div>
      </StudioContainer>
    </div>
  )
}
