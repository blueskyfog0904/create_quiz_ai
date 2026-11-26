import type { Metadata } from 'next'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { searchCachedMarketItemsForSubject } from '@/lib/market-search-cache'
import { getMarketItemDisplay } from '@/lib/market-item-options-server'
import type { MarketSearchSort } from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SearchView } from './_components/search-view'
import { normalizeListPage, normalizeListPageSize } from '@/lib/list-pagination'

export const metadata: Metadata = {
  title: '자료 검색',
  description: '과목 전체 문제마켓 자료를 검색하고 상세 필터로 좁혀보는 검색 결과',
}

function resolveSubject(value?: string): WorkspaceSubject {
  return value === 'korean' ? 'korean' : 'english'
}

function toArray(value: string | string[] | undefined): string[] {
  if (!value) return []
  const values = Array.isArray(value) ? value : [value]
  return values.map((entry) => entry.trim()).filter(Boolean)
}

function resolveSort(value: string | string[] | undefined): MarketSearchSort {
  return value === 'latest' || value === 'price_asc' ? value : 'views'
}

export default async function MarketSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection()
  const params = await searchParams
  const subject = resolveSubject(typeof params.subject === 'string' ? params.subject : undefined)
  const q = typeof params.q === 'string' ? params.q : ''
  const selections = {
    category: toArray(params.category),
    type: toArray(params.type),
    year: toArray(params.year),
    grade: toArray(params.grade),
  }
  const sort = resolveSort(params.sort)
  const page = normalizeListPage(params.page)

  // 17번: 필터 이름(DB 상품 표시 설정). 검색과 함께 읽는다. 못 읽으면 이름만 숨기고 필터 동작은 그대로 둔다.
  const facetLabelsPromise = getMarketItemDisplay().then((display) => display.facetLabels).catch((error) => {
    console.error('[search] 필터 이름 읽기 실패', error instanceof Error ? error.message : error)
    return null
  })
  const result = await searchCachedMarketItemsForSubject(subject, {
    q,
    categoryIds: selections.category,
    typeSlugs: selections.type,
    years: selections.year,
    grades: selections.grade,
    sort,
    page,
    pageSize: normalizeListPageSize(params.pageSize),
  })
  const facetLabels = await facetLabelsPromise

  return (
    <Suspense fallback={null}>
      <SearchView
        subject={subject}
        q={q}
        result={result}
        selections={selections}
        sort={sort}
        facetLabels={facetLabels}
      />
    </Suspense>
  )
}
