import 'server-only'

import { listActiveMarketItemSamplePagesForItems } from '@/lib/market-sample-pages-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import { getListPagination } from '@/lib/list-pagination'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import { MARKET_THUMBNAIL_EMBED, toMarketThumbnailUrl } from '@/lib/market-images'
import {
  buildCategoryTree,
  collectSubtreeIds,
  findCategoryPath,
  type MarketCategoryPathNode,
} from '@/lib/market-category-tree'

export type MarketSearchSort = 'views' | 'latest' | 'price_asc'

export interface MarketSearchFilters {
  q?: string
  // 카테고리 칸 id. 고른 칸의 하위 칸 상품까지 포함한다. 공개 트리에 없는 값(예전 게시판 slug 등)은 무시한다.
  categoryIds?: string[]
  typeSlugs?: string[]
  years?: string[]
  grades?: string[]
  sort?: MarketSearchSort
  page?: number
  pageSize?: number
}

export interface MarketSearchRow {
  itemId: string
  title: string
  summary: string | null
  thumbnailUrl: string | null
  // 상품이 연결된 카테고리 칸 id(미지정이면 null)
  categoryId: string | null
  // depth1 → 연결 칸까지의 경로. 칸이 비활성이거나 공개 트리에 없으면 빈 배열(노출은 상품 상태만으로 정한다).
  categoryPath: MarketCategoryPathNode[]
  examYear: number | null
  gradeLevel: string | null
  questionCount: number | null
  viewCount: number
  /** 카테고리 페이지 정렬용(published_at ?? created_at). 검색 결과에는 없을 수 있다. */
  publishedAt?: string | null
  /** 카테고리 페이지 표시용 별점 요약. 검색 결과에는 없을 수 있다. */
  ratingAverage?: number | null
  ratingCount?: number
  minPriceCredits: number | null
  typeNames: string[]
  sampleAvailable: boolean
}

export interface MarketSearchFacetOption {
  value: string
  label: string
  count: number
}

export interface MarketSearchResult {
  rows: MarketSearchRow[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  facets: {
    categories: MarketSearchFacetOption[]
    types: MarketSearchFacetOption[]
    years: MarketSearchFacetOption[]
    grades: MarketSearchFacetOption[]
  }
}

// 과목 전체 공개 자료를 검색어 + 상세 필터로 조회한다.
// 카탈로그 규모가 작아(수백 건) 과목 전체를 1회 로드 후 서버 메모리에서
// 필터·패싯 집계·정렬·페이지네이션을 수행한다.
// 집계 대상은 고정 정렬로 분할 조회해 PostgREST 응답 상한에 따른 누락을 막는다.
export async function searchMarketItemsForSubject(
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT,
  filters: MarketSearchFilters = {}
): Promise<MarketSearchResult> {
  const supabase = createAdminClient()

  const [items, nodesResult, subproducts, typeCategoriesResult] = await Promise.all([
    readAllQueryRows((from, to) => supabase
      .from('market_items')
      .select(`id, title, summary, category_item_id, exam_year, grade_level, question_count, view_count, published_at, created_at, ${MARKET_THUMBNAIL_EMBED}`)
      .eq('workspace_subject', workspaceSubject)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null).order('id').range(from, to)),
    // 카테고리 경로용 활성 칸 전체(한 쿼리). 경로는 메모리에서 조립한다.
    supabase
      .from('market_category_items')
      .select('id, workspace_subject, parent_id, depth, title, sort_order, created_at')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true),
    readAllQueryRows((from, to) => supabase
      .from('market_item_subproducts')
      .select('item_id, category_id, price_credits')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .is('deleted_at', null).order('id').range(from, to)),
    // 구성 배지와 '유형' 필터 순서는 분류의 sort_order(같으면 이름순)를 따른다.
    supabase
      .from('market_subproduct_categories')
      .select('id, slug, name, sort_order')
      .eq('workspace_subject', workspaceSubject)
      .order('sort_order').order('name'),
  ])

  for (const result of [nodesResult, typeCategoriesResult]) {
    if (result.error) {
      throw new Error(result.error.message)
    }
  }

  const categoryRoots = buildCategoryTree(nodesResult.data ?? [])[workspaceSubject]
  const categoryPathOf = (categoryId: string | null): MarketCategoryPathNode[] => (categoryId
    ? (findCategoryPath(categoryRoots, categoryId) ?? []).map(({ id, title }) => ({ id, title }))
    : [])
  const typeCategories = typeCategoriesResult.data ?? []

  const minPriceByItem = new Map<string, number>()
  const typeCategoryIdsByItem = new Map<string, Set<string>>()
  for (const subproduct of subproducts) {
    const current = minPriceByItem.get(subproduct.item_id)
    if (current === undefined || subproduct.price_credits < current) {
      minPriceByItem.set(subproduct.item_id, subproduct.price_credits)
    }
    const categoryIds = typeCategoryIdsByItem.get(subproduct.item_id) ?? new Set<string>()
    categoryIds.add(subproduct.category_id)
    typeCategoryIdsByItem.set(subproduct.item_id, categoryIds)
  }
  // 정렬된 분류 목록을 상품의 분류로 걸러 배지를 만든다(서브상품 id 순서와 무관하게 항상 같은 순서).
  const typeSlugsOf = (itemId: string) => {
    const categoryIds = typeCategoryIdsByItem.get(itemId)
    return Array.from(new Set(typeCategories
      .filter((category) => categoryIds?.has(category.id))
      .map((category) => category.slug)))
  }
  const typeSlugOrder = Array.from(new Set(typeCategories.map((category) => category.slug)))

  const typeNameBySlug = new Map(typeCategories.map((category) => [category.slug, category.name]))
  const keyword = (filters.q ?? '').trim().toLowerCase().normalize('NFC')
  const matched = items
    .map((item) => {
      const itemTypeSlugs = typeSlugsOf(item.id)
      return {
        itemId: item.id,
        title: item.title,
        summary: item.summary,
        thumbnailUrl: toMarketThumbnailUrl(supabase, item),
        categoryId: item.category_item_id,
        categoryPath: categoryPathOf(item.category_item_id),
        examYear: item.exam_year,
        gradeLevel: item.grade_level,
        questionCount: item.question_count,
        viewCount: item.view_count,
        publishedAt: item.published_at ?? item.created_at,
        minPriceCredits: minPriceByItem.get(item.id) ?? null,
        typeSlugs: itemTypeSlugs,
        typeNames: itemTypeSlugs.map((slug) => typeNameBySlug.get(slug) ?? slug),
      }
    })
    .filter((row) => {
      if (!keyword) return true
      const categoryText = row.categoryPath.map((node) => node.title).join(' ')
      return `${row.title} ${row.summary ?? ''} ${categoryText}`.toLowerCase().normalize('NFC').includes(keyword)
    })

  // 패싯 옵션은 검색어 적용 결과 전체 기준으로 집계 (선택 필터와 무관하게 안정적인 개수 표시)
  const countBy = <T>(values: (row: typeof matched[number]) => T[]) => {
    const counts = new Map<T, number>()
    for (const row of matched) {
      for (const value of new Set(values(row))) {
        counts.set(value, (counts.get(value) ?? 0) + 1)
      }
    }
    return counts
  }
  // '카테고리' 패싯은 depth1~2 단위: 상품의 depth2 조상(없으면 depth1) 칸으로 묶는다.
  const categoryFacetLabels = new Map<string, string>()
  const categoryCounts = countBy((row) => {
    const facetPath = row.categoryPath.slice(0, 2)
    const facetNode = facetPath[facetPath.length - 1]
    if (!facetNode) return []
    categoryFacetLabels.set(facetNode.id, facetPath.map((node) => node.title).join(' > '))
    return [facetNode.id]
  })
  const typeCounts = countBy((row) => row.typeSlugs)
  const yearCounts = countBy((row) => (row.examYear ? [String(row.examYear)] : []))
  const gradeCounts = countBy((row) => (row.gradeLevel ? [row.gradeLevel] : []))

  const toOptions = (counts: Map<string, number>, labelOf: (value: string) => string) =>
    Array.from(counts.entries())
      .map(([value, count]) => ({ value, label: labelOf(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))

  const hasAny = (selected: string[] | undefined, values: string[]) =>
    !selected?.length || selected.some((value) => values.includes(value))

  // 고른 칸이 경로에 있으면(= 그 칸이나 하위 칸 상품) 포함. 공개 트리에 없는 값은 버려 전체 결과가 된다.
  const knownCategoryIds = new Set(categoryRoots.flatMap((node) => collectSubtreeIds(node)))
  const categoryIds = filters.categoryIds?.filter((id) => knownCategoryIds.has(id))
  const filtered = matched.filter((row) =>
    hasAny(categoryIds, row.categoryPath.map((node) => node.id))
    && hasAny(filters.typeSlugs, row.typeSlugs)
    && hasAny(filters.years, row.examYear ? [String(row.examYear)] : [])
    && hasAny(filters.grades, row.gradeLevel ? [row.gradeLevel] : [])
  )

  const sort: MarketSearchSort = filters.sort ?? 'views'
  filtered.sort((a, b) => {
    if (sort === 'latest') {
      return (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.itemId.localeCompare(b.itemId)
    }
    if (sort === 'price_asc') {
      return (a.minPriceCredits ?? Number.MAX_SAFE_INTEGER) - (b.minPriceCredits ?? Number.MAX_SAFE_INTEGER) || a.itemId.localeCompare(b.itemId)
    }
    return b.viewCount - a.viewCount || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') || a.itemId.localeCompare(b.itemId)
  })

  const totalCount = filtered.length
  const { pageSize, page, totalPages } = getListPagination(totalCount, filters.page, filters.pageSize)
  const pagedRows = filtered.slice((page - 1) * pageSize, page * pageSize)

  // 샘플 미리보기 가용 여부는 현재 페이지 행에 대해서만 조회
  const samplePageMap = await listActiveMarketItemSamplePagesForItems(
    pagedRows.map((row) => row.itemId),
    workspaceSubject
  )
  const rows = pagedRows.map(({ publishedAt: _publishedAt, typeSlugs: _typeSlugs, ...row }) => ({
    ...row,
    sampleAvailable: (samplePageMap.get(row.itemId)?.length ?? 0) > 0,
  }))

  return {
    rows,
    totalCount,
    page,
    pageSize,
    totalPages,
    facets: {
      categories: toOptions(categoryCounts, (value) => categoryFacetLabels.get(value) ?? value),
      // '유형' 옵션은 다른 필터와 달리 가나다순이 아니라 배지와 같은 분류 순서로 보여 준다.
      types: typeSlugOrder
        .filter((slug) => typeCounts.has(slug))
        .map((slug) => ({ value: slug, label: typeNameBySlug.get(slug) ?? slug, count: typeCounts.get(slug) ?? 0 })),
      years: toOptions(yearCounts, (value) => value),
      grades: toOptions(gradeCounts, (value) => value),
    },
  }
}
