import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import {
  getMarketCategoryNodeDetail,
  listMarketItemsForCategory,
} from '@/lib/market-categories-server'
import { getCachedCategoryNodes, getCachedCategoryTree } from '@/lib/market-category-tree-cache'
import { CategoryItemsView } from './_components/category-items-view'
import { normalizeListPage, normalizeListPageSize } from '@/lib/list-pagination'

export const metadata: Metadata = {
  title: '카테고리 | 써머썬 연구소',
  description: '카테고리에 등록된 수업 자료를 확인합니다.',
}

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

  // layout이 같은 요청에서 노드 캐시를 채웠으므로 추가 쿼리 없이 칸 정보(조상·하위 칸)를 만든다.
  const category = await getMarketCategoryNodeDetail(id, await getCachedCategoryNodes())
  if (!category) {
    notFound()
  }

  const [result, tree] = await Promise.all([
    listMarketItemsForCategory(id, filters, category),
    getCachedCategoryTree(),
  ])
  const { rows, ...pagination } = result

  return (
    <Suspense fallback={null}>
      <CategoryItemsView
        category={category}
        rows={rows}
        pagination={pagination}
        filters={filters}
        tree={tree[category.workspaceSubject]}
      />
    </Suspense>
  )
}
