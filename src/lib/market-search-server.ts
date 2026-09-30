import 'server-only'

import { listActiveMarketItemSamplePagesForItems } from '@/lib/market-sample-pages-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import { getListPagination } from '@/lib/list-pagination'
import { readAllQueryRows } from '@/lib/read-all-query-rows'

export type MarketSearchSort = 'views' | 'latest' | 'price_asc'

export interface MarketSearchFilters {
  q?: string
  categorySlugs?: string[]
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
  categorySlug: string
  categoryTitle: string
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

  const [items, menuResult, subproducts, typeCategoriesResult] = await Promise.all([
    readAllQueryRows((from, to) => supabase
      .from('market_items')
      .select('id, title, summary, thumbnail_url, menu_entry_id, exam_year, grade_level, question_count, view_count, published_at, created_at')
      .eq('workspace_subject', workspaceSubject)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null).order('id').range(from, to)),
    supabase
      .from('market_menu_entries')
      .select('id, slug, title')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_visible', true)
      .eq('is_active', true)
      .is('deleted_at', null),
    readAllQueryRows((from, to) => supabase
      .from('market_item_subproducts')
      .select('item_id, category_id, price_credits')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .is('deleted_at', null).order('id').range(from, to)),
    supabase
      .from('market_subproduct_categories')
      .select('id, slug, name')
      .eq('workspace_subject', workspaceSubject),
  ])

  for (const result of [menuResult, typeCategoriesResult]) {
    if (result.error) {
      throw new Error(result.error.message)
    }
  }

  const menuMap = new Map((menuResult.data ?? []).map((entry) => [entry.id, entry]))
  const typeCategoryMap = new Map((typeCategoriesResult.data ?? []).map((category) => [category.id, category]))

  const minPriceByItem = new Map<string, number>()
  const typeSlugsByItem = new Map<string, Set<string>>()
  for (const subproduct of subproducts) {
    const current = minPriceByItem.get(subproduct.item_id)
    if (current === undefined || subproduct.price_credits < current) {
      minPriceByItem.set(subproduct.item_id, subproduct.price_credits)
    }
    const category = typeCategoryMap.get(subproduct.category_id)
    if (category) {
      const slugs = typeSlugsByItem.get(subproduct.item_id) ?? new Set<string>()
      slugs.add(category.slug)
      typeSlugsByItem.set(subproduct.item_id, slugs)
    }
  }

  const typeNameBySlug = new Map((typeCategoriesResult.data ?? []).map((category) => [category.slug, category.name]))
  const keyword = (filters.q ?? '').trim().toLowerCase().normalize('NFC')
  const matched = items
    // 노출 메뉴에 속한 아이템만 검색 대상 (숨김/비활성 메뉴의 카탈로그 유출 방지)
    .filter((item) => menuMap.has(item.menu_entry_id))
    .map((item) => {
      const menu = menuMap.get(item.menu_entry_id)!
      const itemTypeSlugs = Array.from(typeSlugsByItem.get(item.id) ?? [])
      return {
        itemId: item.id,
        title: item.title,
        summary: item.summary,
        thumbnailUrl: item.thumbnail_url,
        categorySlug: menu.slug,
        categoryTitle: menu.title,
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
      return `${row.title} ${row.summary ?? ''} ${row.categoryTitle}`.toLowerCase().normalize('NFC').includes(keyword)
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
  const categoryCounts = countBy((row) => (row.categorySlug ? [row.categorySlug] : []))
  const typeCounts = countBy((row) => row.typeSlugs)
  const yearCounts = countBy((row) => (row.examYear ? [String(row.examYear)] : []))
  const gradeCounts = countBy((row) => (row.gradeLevel ? [row.gradeLevel] : []))

  const menuTitleBySlug = new Map((menuResult.data ?? []).map((entry) => [entry.slug, entry.title]))
  const toOptions = (counts: Map<string, number>, labelOf: (value: string) => string) =>
    Array.from(counts.entries())
      .map(([value, count]) => ({ value, label: labelOf(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'))

  const hasAny = (selected: string[] | undefined, values: string[]) =>
    !selected?.length || selected.some((value) => values.includes(value))

  const filtered = matched.filter((row) =>
    hasAny(filters.categorySlugs, row.categorySlug ? [row.categorySlug] : [])
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
      categories: toOptions(categoryCounts, (value) => menuTitleBySlug.get(value) ?? value),
      types: toOptions(typeCounts, (value) => typeNameBySlug.get(value) ?? value),
      years: toOptions(yearCounts, (value) => value),
      grades: toOptions(gradeCounts, (value) => value),
    },
  }
}
