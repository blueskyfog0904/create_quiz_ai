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
  searchParams: Promise<{ q?: string | string[]; sort?: string; page?: string; pageSize?: string; filter?: string | string[] }>
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

  // 노드 캐시(적중이면 쿼리 없음)로 칸 정보(조상·하위 칸)를 만든다. 존재 확인(404)은 layout이 이미 했다.
  const nodes = await getCachedCategoryNodes()
  const node = await getMarketCategoryNodeDetail(id, nodes)
  if (!node) {
    notFound()
  }

  // 페이지는 depth1~2 칸 기준이고, depth3 이상은 그 페이지 안의 필터(?filter=칸 id)로 고른다.
  // depth3 이상 칸 주소로 들어오면 그 칸의 depth2 페이지에서 그 칸을 고른 상태로 보여 준다.
  const pathIds = [...node.ancestors.map((ancestor) => ancestor.id), node.id]
  const baseId = pathIds[Math.min(pathIds.length, 2) - 1]
  const category = baseId === node.id ? node : await getMarketCategoryNodeDetail(baseId, nodes)
  if (!category) {
    notFound()
  }
  const filterId = Array.isArray(query.filter) ? query.filter[0] : query.filter
  const filtered = filterId && filterId !== node.id ? await getMarketCategoryNodeDetail(filterId, nodes) : null
  const selected = filtered && filtered.ancestors.some((ancestor) => ancestor.id === category.id) ? filtered : node

  const [result, tree] = await Promise.all([
    listMarketItemsForCategory(selected.id, filters, selected),
    getCachedCategoryTree(),
  ])
  const { rows, ...pagination } = result

  return (
    <Suspense fallback={null}>
      <CategoryItemsView
        category={category}
        selected={selected}
        rows={rows}
        pagination={pagination}
        filters={filters}
        tree={tree[category.workspaceSubject]}
      />
    </Suspense>
  )
}
