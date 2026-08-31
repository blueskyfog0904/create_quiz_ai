'use client'

import { useEffect, useRef, useState, useTransition, type MouseEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, FileImage, Loader2, RotateCcw, SearchX, X } from 'lucide-react'
import MarketSamplePreviewDialog from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog'
import { StudioContainer, StudioEmptyState, StudioPagination } from '@/components/design-system'
import type { MarketSearchResult, MarketSearchSort } from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface SearchSelections {
  category: string[]
  type: string[]
  year: string[]
  grade: string[]
}

interface SearchViewProps {
  subject: WorkspaceSubject
  q: string
  result: MarketSearchResult
  selections: SearchSelections
  sort: MarketSearchSort
}

type FacetKey = keyof SearchSelections

const FACET_DEFS: { key: FacetKey; label: string }[] = [
  { key: 'category', label: '카테고리' },
  { key: 'type', label: '자료유형' },
  { key: 'year', label: '연도' },
  { key: 'grade', label: '학년' },
]

const SORT_OPTIONS: { value: MarketSearchSort; label: string }[] = [
  { value: 'views', label: '인기순' },
  { value: 'latest', label: '최신순' },
  { value: 'price_asc', label: '낮은 가격순' },
]

export function SearchView({ subject, q, result, selections, sort }: SearchViewProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [openFacetKey, setOpenFacetKey] = useState<FacetKey | null>(null)
  const facetBarRef = useRef<HTMLDivElement | null>(null)
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

  useEffect(() => {
    if (!openFacetKey) return

    function handlePointerDown(event: PointerEvent) {
      if (facetBarRef.current && !facetBarRef.current.contains(event.target as Node)) {
        setOpenFacetKey(null)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenFacetKey(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [openFacetKey])

  const facetOptionsByKey: Record<FacetKey, MarketSearchResult['facets']['categories']> = {
    category: result.facets.categories,
    type: result.facets.types,
    year: result.facets.years,
    grade: result.facets.grades,
  }

  const pushWith = (overrides: {
    selections?: SearchSelections
    sort?: MarketSearchSort
    page?: number
  }) => {
    const nextSelections = overrides.selections ?? selections
    const nextSort = overrides.sort ?? sort
    const nextPage = overrides.page ?? 1

    const params = new URLSearchParams()
    params.set('subject', subject)
    if (q) params.set('q', q)
    for (const facet of FACET_DEFS) {
      for (const value of nextSelections[facet.key]) {
        params.append(facet.key, value)
      }
    }
    if (nextSort !== 'views') params.set('sort', nextSort)
    if (nextPage > 1) params.set('page', String(nextPage))

    startTransition(() => {
      router.push(`/search?${params.toString()}`)
    })
  }

  const toggleFacetValue = (facetKey: FacetKey, value: string) => {
    const current = selections[facetKey]
    const nextValues = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value]
    pushWith({ selections: { ...selections, [facetKey]: nextValues } })
  }

  const resetFilters = () => {
    setOpenFacetKey(null)
    pushWith({ selections: { category: [], type: [], year: [], grade: [] } })
  }

  const activeChips = FACET_DEFS.flatMap((facet) =>
    selections[facet.key].map((value) => ({
      facetKey: facet.key,
      value,
      label: facetOptionsByKey[facet.key].find((option) => option.value === value)?.label ?? value,
    }))
  )

  const subjectLabel = subject === 'korean' ? '국어' : '영어'

  return (
    <StudioContainer className="py-8 sm:py-10">
      <p className="text-sm font-semibold text-[var(--studio-primary)]">{subjectLabel} 자료 검색</p>
      <h1 className="mt-1 text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">
        {q ? (
          <>
            &lsquo;{q}&rsquo; 검색 결과{' '}
            <span className="text-[var(--studio-muted)]">{result.totalCount}건</span>
          </>
        ) : (
          <>
            전체 자료 <span className="text-[var(--studio-muted)]">{result.totalCount}건</span>
          </>
        )}
      </h1>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-[var(--studio-ink)]">상세 필터</span>
        <div ref={facetBarRef} className="flex flex-wrap items-center gap-2">
          {FACET_DEFS.map((facet) => {
            const options = facetOptionsByKey[facet.key]
            const selectedCount = selections[facet.key].length
            const disabled = options.length === 0 && selectedCount === 0
            const open = openFacetKey === facet.key
            return (
              <div key={facet.key} className="relative">
                <button
                  type="button"
                  disabled={disabled}
                  aria-haspopup="true"
                  aria-expanded={open}
                  onClick={() => setOpenFacetKey(open ? null : facet.key)}
                  className={`inline-flex min-h-10 items-center gap-1 rounded-lg border bg-[var(--studio-surface)] px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                    selectedCount > 0
                      ? 'border-[var(--studio-ink)] font-bold text-[var(--studio-ink)]'
                      : disabled
                        ? 'cursor-not-allowed border-[var(--studio-border)] font-medium text-[var(--studio-muted)] opacity-50'
                        : 'border-[var(--studio-control-border)] font-medium text-[var(--studio-muted)] hover:border-[var(--studio-ink)] hover:text-[var(--studio-ink)]'
                  }`}
                >
                  {facet.label}
                  {selectedCount > 0 && <span>{selectedCount}</span>}
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                  />
                </button>
                {open && (
                  <div className="absolute left-0 top-full z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] py-2 shadow-[var(--studio-shadow-card)]">
                    {options.map((option) => {
                      const checked = selections[facet.key].includes(option.value)
                      return (
                        <label
                          key={option.value}
                          className="flex min-h-10 cursor-pointer items-center gap-2.5 px-4 text-sm text-[var(--studio-ink)] hover:bg-[var(--studio-background)]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleFacetValue(facet.key, option.value)}
                            className="size-4 accent-[var(--studio-primary)]"
                          />
                          <span className="min-w-0 flex-1 break-keep">{option.label}</span>
                          <span className="text-xs text-[var(--studio-muted)]">{option.count}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isPending && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-[var(--studio-muted)]" />}
          <select
            value={sort}
            onChange={(event) => pushWith({ sort: event.target.value as MarketSearchSort })}
            aria-label="정렬"
            className="min-h-10 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-3 text-sm text-[var(--studio-ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-black/5 px-4 py-2">
          {activeChips.map((chip) => (
            <button
              key={`${chip.facetKey}:${chip.value}`}
              type="button"
              onClick={() => toggleFacetValue(chip.facetKey, chip.value)}
              aria-label={`${chip.label} 필터 제거`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-[var(--studio-text)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
            >
              {chip.label}
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md text-sm font-medium text-[var(--studio-text)] outline-none hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            초기화
          </button>
        </div>
      )}

      <div
        aria-busy={isPending}
        className={isPending ? 'pointer-events-none opacity-50 transition-opacity' : 'transition-opacity'}
      >
        {result.rows.length === 0 ? (
          <div className="mt-6">
            <StudioEmptyState
              icon={<SearchX className="size-6" aria-hidden />}
              title="조건에 맞는 자료가 없습니다"
              description="검색어를 바꾸거나 상세 필터를 조정해 보세요."
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {result.rows.map((row) => (
              <article
                key={row.itemId}
                className="relative flex flex-col rounded-md border border-[var(--studio-border)] bg-[var(--studio-surface)] transition-colors hover:border-[var(--studio-primary-border)]"
              >
                <div className="flex flex-1 gap-4 p-5">
                  <div className="flex w-[92px] shrink-0 flex-col gap-2.5">
                    {row.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 어드민이 등록한 외부 썸네일 URL을 그대로 사용
                      <img
                        src={row.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="h-[130px] w-[92px] rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] object-contain"
                      />
                    ) : (
                      <div className="flex h-[130px] w-[92px] items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]">
                        <FileImage aria-hidden="true" className="h-5 w-5" />
                      </div>
                    )}
                    {row.sampleAvailable && (
                      <button
                        type="button"
                        onFocus={() => prefetchSamplePreview(row.itemId)}
                        onMouseEnter={() => prefetchSamplePreview(row.itemId)}
                        onClick={(event) => openSamplePreview(event, row.itemId)}
                        className="relative z-10 inline-flex min-h-9 w-full items-center justify-center rounded-md border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-2 text-sm font-semibold text-[var(--studio-muted)] outline-none transition-colors hover:border-[var(--studio-ink)] hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                      >
                        샘플 보기
                      </button>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    {row.questionCount ? (
                      <span className="inline-flex items-center rounded bg-[var(--studio-primary-soft)] px-2 py-0.5 text-sm font-semibold text-[var(--studio-primary)]">
                        {row.questionCount}문항
                      </span>
                    ) : null}
                    <h2 className="mt-1.5">
                      {row.categorySlug ? (
                        <Link
                          href={`/preview/solvook-concept/boards/${row.categorySlug}/items/${row.itemId}?subject=${subject}`}
                          className="break-keep text-base font-semibold leading-6 text-[var(--studio-ink)] outline-none after:absolute after:inset-0 hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                        >
                          {row.title}
                        </Link>
                      ) : (
                        <span className="break-keep text-base font-semibold leading-6 text-[var(--studio-ink)]">
                          {row.title}
                        </span>
                      )}
                    </h2>
                    <p className="mt-1 text-base text-[var(--studio-muted)]">{row.categoryTitle}</p>
                    {row.minPriceCredits !== null ? (
                      <p className="mt-4 [font-family:var(--studio-font-price)] text-xl font-bold text-[var(--studio-text)]">
                        {row.minPriceCredits.toLocaleString()} 크레딧~
                      </p>
                    ) : null}
                  </div>
                </div>

                {row.typeNames.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--studio-border)] px-5 py-3 text-sm text-[var(--studio-muted)]">
                    {row.typeNames.map((name, index) => (
                      <span key={name} className="flex items-center gap-2">
                        {index > 0 && (
                          <span aria-hidden="true" className="text-[var(--studio-border)]">
                            |
                          </span>
                        )}
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        {result.totalPages > 1 && (
          <div className="mt-6">
            <StudioPagination
              page={result.page}
              totalPages={result.totalPages}
              onPageChange={(nextPage) => pushWith({ selections, sort, page: nextPage })}
            />
          </div>
        )}
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
