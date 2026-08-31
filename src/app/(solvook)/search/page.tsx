import type { Metadata } from 'next'
import { Suspense } from 'react'
import { connection } from 'next/server'
import { searchMarketItemsForSubject, type MarketSearchSort } from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { SearchView } from './_components/search-view'

export const metadata: Metadata = {
  title: '자료 검색 | 써머썬 스튜디오',
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
  const page = Number(typeof params.page === 'string' ? params.page : '1') || 1

  const result = await searchMarketItemsForSubject(subject, {
    q,
    categorySlugs: selections.category,
    typeSlugs: selections.type,
    years: selections.year,
    grades: selections.grade,
    sort,
    page,
  })

  return (
    <Suspense fallback={null}>
      <SearchView
        subject={subject}
        q={q}
        result={result}
        selections={selections}
        sort={sort}
      />
    </Suspense>
  )
}
