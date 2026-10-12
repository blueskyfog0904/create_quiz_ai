'use client'

import { useEffect, useRef, useState, useTransition, type MouseEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { StudioContainer } from '@/components/design-system/studio-container'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import { StudioListPagination } from '@/components/design-system/studio-list-pagination'
import { Button } from '@/components/ui/button'
import { updateListQuery } from '@/lib/list-pagination'
import { MarketCategorySidebar } from '@/components/market/MarketCategorySidebar'
import { MarketItemListRow } from '@/components/market/market-item-list-row'
import MarketSamplePreviewDialog from '@/components/market/market-sample-preview-dialog'
import type { MarketCategoryNodeDetail, MarketCategoryNodeSummary } from '@/lib/market-categories-server'
import { findCategoryPath, type MarketCategoryNode } from '@/lib/market-category-tree'
import type { MarketSearchRow } from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface CategoryItemsViewProps {
  category: MarketCategoryNodeDetail
  rows: MarketSearchRow[]
  // 상품 수가 들어 있는 같은 과목 트리(사이드바·'더 자세히 찾기'의 (N))
  tree: MarketCategoryNode[]
  pagination: { page: number; pageSize: number; totalCount: number; totalPages: number }
  filters: { q: string; sort: 'views' | 'latest' }
}

type SortOption = 'views' | 'latest'

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'views', label: '인기순' },
  { value: 'latest', label: '최신순' },
]

interface FinderRow {
  items: MarketCategoryNodeSummary[]
  activeId: string | null
}

// '더 자세히 찾기' 줄 구성: 맨 위는 depth2 칸 격자, 그 아래로 경로에서 고른 칸의 하위 칸(depth3·4·5)을 한 줄씩.
// 각 줄에서 현재 경로에 있는 칸을 강조한다. 개수 트리에 이 칸이 없으면(60초 캐시 경계) 칸 정보로 한 줄만 그린다.
function buildFinderRows(
  path: MarketCategoryNode[] | null,
  category: MarketCategoryNodeDetail
): FinderRow[] {
  if (!path) {
    const items = category.children.length > 0 ? category.children : category.siblings
    return items.length > 0 ? [{ items, activeId: category.id }] : []
  }
  const rows: FinderRow[] = []
  for (let index = 0; index < path.length; index += 1) {
    const children = path[index].children
    if (children.length === 0) break
    rows.push({ items: children, activeId: path[index + 1]?.id ?? null })
  }
  return rows
}

function FinderLabel({ item }: { item: MarketCategoryNodeSummary }) {
  return (
    <span className="break-keep">
      {item.title}
      {item.itemCount !== undefined ? (
        <> <span className="whitespace-nowrap text-[var(--studio-muted)]">({item.itemCount.toLocaleString()})</span></>
      ) : null}
    </span>
  )
}

// 솔북 '더 자세히 찾기': depth2 칸은 표 형태 격자(마지막 줄도 빈 칸 없이 너비를 나눠 채움), 하위 depth는 버튼 줄
function DetailFinder({ rows, subject, currentId }: { rows: FinderRow[]; subject: WorkspaceSubject; currentId: string }) {
  const [grid, ...levels] = rows
  const hrefOf = (id: string) => `/categories/${id}?subject=${subject}`
  // 지금 보고 있는 칸은 page, 그 위 경로의 칸은 true
  const currentOf = (id: string, active: boolean) => (active ? (id === currentId ? 'page' : 'true') : undefined)

  return (
    <section aria-label="더 자세히 찾기" className="mt-8">
      <h2 className="text-lg font-bold text-[var(--studio-ink)]">더 자세히 찾기</h2>
      <div className="mt-3 flex flex-wrap gap-px overflow-hidden rounded-md border border-[var(--studio-border)] bg-[var(--studio-border)]">
        {grid.items.map((item) => {
          const active = item.id === grid.activeId
          return (
            <Link
              key={item.id}
              href={hrefOf(item.id)}
              aria-current={currentOf(item.id, active)}
              className={`flex min-h-12 grow basis-[calc(50%-1px)] items-center justify-center bg-[var(--studio-surface)] px-3 py-2 text-center text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)] md:basis-[calc(25%-1px)] ${
                active
                  ? 'font-semibold text-[var(--studio-primary)]'
                  : 'text-[var(--studio-text)] hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)]'
              }`}
            >
              <FinderLabel item={item} />
            </Link>
          )
        })}
      </div>
      {levels.map((level, index) => (
        <div key={index} className="mt-3 flex flex-wrap gap-3">
          {level.items.map((item) => {
            const active = item.id === level.activeId
            return (
              <Link
                key={item.id}
                href={hrefOf(item.id)}
                aria-current={currentOf(item.id, active)}
                className={`flex min-h-10 min-w-28 flex-1 items-center justify-center rounded-md border border-[var(--studio-border)] bg-[var(--studio-surface)] px-3 py-1.5 text-center text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                  active
                    ? 'font-semibold text-[var(--studio-primary)]'
                    : 'text-[var(--studio-text)] hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)]'
                }`}
              >
                <FinderLabel item={item} />
              </Link>
            )
          })}
        </div>
      ))}
    </section>
  )
}

export function CategoryItemsView({ category, rows, tree, pagination, filters }: CategoryItemsViewProps) {
  const subject = category.workspaceSubject
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  // 상품 수는 개수 트리에서 읽는다.
  const finderRows = buildFinderRows(findCategoryPath(tree, category.id), category)

  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const sort = filters.sort
  const filteredRows = rows
  function hrefFor(changes: Record<string, string | number | null>) {
    return `/categories/${category.id}?${updateListQuery(searchParams.toString(), { subject, ...changes })}#market-results`
  }
  function navigate(changes: Record<string, string | number | null>) {
    startTransition(() => router.push(hrefFor(changes)))
  }
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)

  const sampleTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [samplePreviewPrefetchKey, setSamplePreviewPrefetchKey] = useState(0)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)

  useEffect(() => {
    if (!sortMenuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setSortMenuOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setSortMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [sortMenuOpen])

  const sortLabel = SORT_OPTIONS.find((option) => option.value === sort)?.label ?? '인기순'

  function prefetchSamplePreview(itemId: string) {
    setSamplePreviewItemId(itemId)
    setSamplePreviewPrefetchKey((key) => key + 1)
  }

  function openSamplePreview(event: MouseEvent<HTMLButtonElement>, itemId: string) {
    sampleTriggerRef.current = event.currentTarget
    setSamplePreviewItemId(itemId)
    setIsSamplePreviewOpen(true)
  }

  return (
    <StudioContainer className="py-8 sm:py-10">
      <div className="flex items-start gap-10">
        <aside className="sticky top-36 hidden w-56 shrink-0 self-start lg:block">
          <MarketCategorySidebar
            key={category.id}
            tree={tree}
            subject={subject}
            activeId={category.id}
          />
        </aside>

        <div className="min-w-0 flex-1" aria-busy={isPending}>
          <nav aria-label="현재 위치" className="flex flex-wrap items-center gap-x-1.5 break-keep text-sm text-[var(--studio-muted)]">
            <Link href={`/?subject=${subject}`} className="rounded-sm outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]">
              {subjectLabel}
            </Link>
            {category.ancestors.map((ancestor) => (
              <span key={ancestor.id} className="contents">
                <span aria-hidden="true">/</span>
                <Link
                  href={`/categories/${ancestor.id}?subject=${subject}`}
                  className="rounded-sm outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  {ancestor.title}
                </Link>
              </span>
            ))}
            <span aria-hidden="true">/</span>
            <span aria-current="page">{category.title}</span>
          </nav>
          <h1 className="mt-1 break-keep text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">
            {category.title}
          </h1>

          {finderRows.length > 0 && <DetailFinder rows={finderRows} subject={subject} currentId={category.id} />}

          {rows.length === 0 && !filters.q ? (
            <div className="mt-8">
              <StudioEmptyState
                icon={<FolderOpen className="size-6" aria-hidden />}
                title="아직 등록된 자료가 없습니다"
                description="이 카테고리에 자료가 등록되면 이곳에서 확인할 수 있습니다."
              />
            </div>
          ) : (
            <>
              <div id="market-results" className="mt-8 flex scroll-mt-36 flex-wrap items-center gap-3">
                <p className="text-sm text-[var(--studio-muted)]">
                  총 {pagination.totalCount.toLocaleString()}개
                  {isPending && <span role="status" className="ml-2">불러오는 중…</span>}
                </p>
                <div className="ml-auto flex flex-wrap items-center gap-3">
                  <form className="flex items-center gap-2" onSubmit={(event) => {
                    event.preventDefault()
                    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim()
                    navigate({ q, page: 1 })
                  }}>
                  <input
                    key={filters.q}
                    name="q"
                    type="search"
                    defaultValue={filters.q}
                    placeholder="자료명 검색"
                    aria-label="자료 검색"
                    className="min-h-10 w-40 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] sm:w-56"
                  />
                  <Button type="submit" variant="outline" className="min-h-11" disabled={isPending}>검색</Button>
                  </form>
                  <div ref={sortMenuRef} className="relative">
                    <button
                      type="button"
                      aria-haspopup="true"
                      aria-expanded={sortMenuOpen}
                      onClick={() => setSortMenuOpen((open) => !open)}
                      className="inline-flex min-h-10 items-center gap-1 rounded-md px-1.5 text-sm font-medium text-[var(--studio-ink)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                    >
                      {sortLabel}
                      <ChevronDown
                        aria-hidden="true"
                        className={`h-4 w-4 transition-transform ${sortMenuOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {sortMenuOpen && (
                      <div
                        role="radiogroup"
                        aria-label="정렬"
                        className="absolute right-0 top-full z-20 mt-1 w-32 rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] py-1.5 shadow-[var(--studio-shadow-card)]"
                      >
                        {SORT_OPTIONS.map((option) => {
                          const selected = option.value === sort
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => {
                                navigate({ sort: option.value, page: 1 })
                                setSortMenuOpen(false)
                              }}
                              className={`flex min-h-9 w-full items-center px-3.5 text-left text-sm outline-none hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--studio-focus-ring)] ${
                                selected
                                  ? 'font-semibold text-[var(--studio-primary)]'
                                  : 'text-[var(--studio-ink)]'
                              }`}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {filteredRows.length === 0 ? (
                <div className="mt-6">
                  <StudioEmptyState
                    icon={<FolderOpen className="size-6" aria-hidden />}
                    title="조건에 맞는 자료가 없습니다"
                    description="검색어를 변경해 보세요."
                  />
                </div>
              ) : (
                // 솔북식: 한 줄에 상품 1개, 행 사이 hairline 구분선
                <ul className="mt-3 divide-y divide-[var(--studio-border)] border-t border-[var(--studio-border)]">
                  {filteredRows.map((row) => (
                    <MarketItemListRow
                      key={row.itemId}
                      row={row}
                      subject={subject}
                      onSamplePrefetch={prefetchSamplePreview}
                      onSampleOpen={openSamplePreview}
                    />
                  ))}
                </ul>
              )}
              <StudioListPagination
                page={pagination.page}
                pageSize={pagination.pageSize}
                totalCount={pagination.totalCount}
                onPageChange={() => {}}
                getPageHref={(page) => hrefFor({ page })}
                onPageSizeChange={(pageSize) => navigate({ pageSize, page: 1 })}
              />
            </>
          )}
        </div>
      </div>

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
    </StudioContainer>
  )
}
