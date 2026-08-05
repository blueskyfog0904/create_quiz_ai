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
  const currentGroupId = data.category.groupId ?? `ungrouped:${data.subject}`
  const activeSourceConfig = data.filters.sourceConfigs.find((config) => (
    config.typeName === filters.sourceType
  )) ?? null

  return (
    <div className="studio-reference-gutter overflow-x-hidden py-6 sm:py-8">
      <StudioContainer className="space-y-6">
        <div
          data-slot="market-board-layout"
          className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-x-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-x-12"
        >
            <BoardCategorySidebar
              groups={data.groups}
              categorySlug={data.category.slug}
              currentGroupId={currentGroupId}
              subject={data.subject}
              search={filters.search}
              year={filters.year}
              month={filters.month}
              grade={filters.grade}
              sourceType={filters.sourceType}
              source1={filters.source1}
              source2={filters.source2}
              source3={filters.source3}
              source4={filters.source4}
              sort={filters.sort}
              pageSize={filters.pageSize}
            />

            <div data-slot="market-board-content" className="min-w-0 space-y-6">
              <header>
                <div>
                  <p className="text-xs font-extrabold tracking-[0.13em] text-[var(--studio-primary)]">
                    {subjectLabel} MARKET BOARD
                  </p>
                  <h1 className="mt-2 break-keep text-3xl font-black tracking-[-0.04em] text-[var(--studio-ink)]">
                    {data.category.title}
                  </h1>
                  <p className="mt-3 max-w-2xl break-keep text-sm leading-6 text-[var(--studio-muted)]">
                    {data.category.description ?? `${subjectLabel} 공개 자료를 실제 카테고리 기준으로 탐색하는 프리뷰 게시판입니다.`}
                  </p>
                </div>
              </header>

              <form method="get" className="space-y-6">
                <input type="hidden" name="subject" value={data.subject} />
                <input type="hidden" name="sort" value={filters.sort} />
                <input type="hidden" name="pageSize" value={String(filters.pageSize)} />

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

                      <div className="min-w-0">
                        <label htmlFor="board-month" className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]">
                          월
                        </label>
                        <select
                          id="board-month"
                          name="month"
                          defaultValue={filters.month}
                          className={nativeSelectClassName()}
                        >
                          <option value="">전체</option>
                          {data.filters.months.map((month) => (
                            <option key={month} value={String(month)}>
                              {month}월
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <label htmlFor="board-grade" className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]">
                          학년
                        </label>
                        <select
                          id="board-grade"
                          name="grade"
                          defaultValue={filters.grade}
                          className={nativeSelectClassName()}
                        >
                          <option value="">전체</option>
                          {data.filters.grades.map((grade) => (
                            <option key={grade} value={grade}>
                              {grade}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="min-w-0">
                        <label htmlFor="board-source-type" className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]">
                          출처 유형
                        </label>
                        <select
                          id="board-source-type"
                          name="sourceType"
                          defaultValue={filters.sourceType}
                          className={nativeSelectClassName()}
                        >
                          <option value="">전체</option>
                          {data.filters.sourceConfigs.map((config) => (
                            <option key={config.typeName} value={config.typeName}>
                              {config.typeName}
                            </option>
                          ))}
                        </select>
                      </div>

                      {activeSourceConfig && filters.sourceType === activeSourceConfig.typeName
                        ? activeSourceConfig.fields.map((field) => (
                          <div key={field.key} className="min-w-0">
                            <label htmlFor={`board-${field.key}`} className="mb-1.5 block text-xs font-extrabold text-[var(--studio-text)]">
                              {field.label}
                            </label>
                            <select
                              id={`board-${field.key}`}
                              name={field.key}
                              defaultValue={filters[field.key]}
                              className={nativeSelectClassName()}
                            >
                              <option value="">전체</option>
                              {field.options.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))
                        : null}
                    </>
                  )}
                  activeFilters={(
                    <>
                      {filters.search ? (
                        <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                          검색: {filters.search}
                        </Badge>
                      ) : null}
                      {filters.sourceType ? (
                        <Badge variant="outline" className="border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-text)]">
                          출처: {filters.sourceType}
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
                month={filters.month}
                grade={filters.grade}
                sourceType={filters.sourceType}
                source1={filters.source1}
                source2={filters.source2}
                source3={filters.source3}
                source4={filters.source4}
                sort={filters.sort}
                pageSize={filters.pageSize}
              />
            </div>
        </div>
      </StudioContainer>
    </div>
  )
}
