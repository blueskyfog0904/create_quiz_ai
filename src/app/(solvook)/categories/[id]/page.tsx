import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { unstable_cache } from 'next/cache'
import {
  getMarketCategoryItemDetail,
  listMarketCategoryMenu,
  listMarketItemsForCategory,
} from '@/lib/market-categories-server'
import { CategoryItemsView } from './_components/category-items-view'
import { normalizeListPage, normalizeListPageSize } from '@/lib/list-pagination'

export const metadata: Metadata = {
  title: '카테고리 | 써머썬 연구소',
  description: '카테고리에 등록된 수업 자료를 확인합니다.',
}

// 왼쪽 카테고리 목록(항목별 상품 수 포함)은 페이지마다 같은 값이라 60초 공유 캐시로 읽는다.
// 상단 메가메뉴 API(/api/market/category-menu)도 같은 데이터를 60초 캐시한다.
const getCachedCategoryMenu = unstable_cache(
  () => listMarketCategoryMenu(true),
  ['category-menu-with-counts'],
  { revalidate: 60 }
)

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ q?: string | string[]; sort?: string; page?: string; pageSize?: string }>
}) {
  await connection()
  const { id } = await params
  const query = await searchParams
  const filters = {
    q: (Array.isArray(query.q) ? query.q[0] : query.q)?.trim() ?? '',
    sort: query.sort === 'latest' ? 'latest' as const : 'views' as const,
    page: normalizeListPage(query.page),
    pageSize: normalizeListPageSize(query.pageSize),
  }

  const category = await getMarketCategoryItemDetail(id)
  if (!category) {
    notFound()
  }

  const [result, menu] = await Promise.all([
    listMarketItemsForCategory(id, filters, category),
    getCachedCategoryMenu(),
  ])
  const { rows, ...pagination } = result

  return (
    <Suspense fallback={null}>
      <CategoryItemsView
        category={category}
        rows={rows}
        pagination={pagination}
        filters={filters}
        tree={menu[category.workspaceSubject]}
      />
    </Suspense>
  )
}
