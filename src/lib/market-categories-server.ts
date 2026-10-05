import 'server-only'

import { listActiveMarketItemSamplePagesForItems } from '@/lib/market-sample-pages-server'
import type { MarketSearchRow } from '@/lib/market-search-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { getListPagination } from '@/lib/list-pagination'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import { MARKET_IMAGES_BUCKET, MARKET_THUMBNAIL_EMBED, toMarketThumbnailUrl } from '@/lib/market-images'

// admin-accounts-server의 AdminAccountError와 동일한 status+message 패턴
export class MarketCategoryError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'MarketCategoryError'
    this.status = status
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface MegaMenuGroup {
  id: string
  title: string
  itemCount?: number
  items: { id: string; title: string; itemCount?: number }[]
}

export interface MarketCategoryMenu {
  english: MegaMenuGroup[]
  korean: MegaMenuGroup[]
}

// 공개 메가메뉴 트리: 활성 그룹 + 활성 항목만, sort_order 정렬.
export async function listMarketCategoryMenu(includeCounts = false): Promise<MarketCategoryMenu> {
  const supabase = createAdminClient()

  const [groupsResult, itemsResult] = await Promise.all([
    supabase
      .from('market_category_groups')
      .select('id, workspace_subject, title')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('market_category_items')
      .select('id, group_id, title')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (groupsResult.error) {
    throw new Error(groupsResult.error.message)
  }
  if (itemsResult.error) {
    throw new Error(itemsResult.error.message)
  }

  const itemsByGroup = new Map<string, { id: string; title: string }[]>()
  for (const item of itemsResult.data ?? []) {
    const current = itemsByGroup.get(item.group_id) ?? []
    current.push({ id: item.id, title: item.title })
    itemsByGroup.set(item.group_id, current)
  }

  const menu: MarketCategoryMenu = { english: [], korean: [] }
  for (const group of groupsResult.data ?? []) {
    if (!isWorkspaceSubject(group.workspace_subject)) continue
    const items = itemsByGroup.get(group.id) ?? []
    // 활성 항목이 없는 그룹은 링크 없는 제목만 남으므로 메뉴에서 제외한다
    if (items.length === 0) continue
    menu[group.workspace_subject].push({
      id: group.id,
      title: group.title,
      items,
    })
  }

  if (includeCounts) {
    await Promise.all((['english', 'korean'] as const).map(async (subject) => {
      const { data: entries, error } = await supabase.from('market_menu_entries').select('id')
        .eq('workspace_subject', subject).eq('is_visible', true).eq('is_active', true).is('deleted_at', null)
      if (error) throw new Error(error.message)
      const menuIds = (entries ?? []).map((entry) => entry.id)
      await Promise.all(menu[subject].map(async (group) => {
        await Promise.all(group.items.map(async (item) => {
          if (menuIds.length === 0) {
            item.itemCount = 0
            return
          }
          const { count, error: countError } = await supabase.from('market_items').select('id', { count: 'exact', head: true })
            .eq('category_item_id', item.id).eq('workspace_subject', subject)
            .eq('status', 'published').eq('is_active', true).is('deleted_at', null).in('menu_entry_id', menuIds)
          if (countError) throw new Error(countError.message)
          item.itemCount = count ?? 0
        }))
        group.itemCount = group.items.reduce((sum, item) => sum + (item.itemCount ?? 0), 0)
      }))
    }))
  }
  return menu
}

export interface MarketCategoryItemDetail {
  id: string
  title: string
  workspaceSubject: WorkspaceSubject
  groupTitle: string
}

// 카테고리 페이지 헤더용: 활성 항목 + 활성 그룹. uuid 형식이 아니거나 없거나 비활성이면 null.
export async function getMarketCategoryItemDetail(id: string): Promise<MarketCategoryItemDetail | null> {
  if (!UUID_PATTERN.test(id)) {
    return null
  }

  const supabase = createAdminClient()
  const { data: item, error } = await supabase
    .from('market_category_items')
    .select('id, group_id, workspace_subject, title')
    .eq('id', id)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }
  if (!item || !isWorkspaceSubject(item.workspace_subject)) {
    return null
  }

  const { data: group, error: groupError } = await supabase
    .from('market_category_groups')
    .select('id, title')
    .eq('id', item.group_id)
    .eq('is_active', true)
    .maybeSingle()

  if (groupError) {
    throw new Error(groupError.message)
  }
  if (!group) {
    return null
  }

  return {
    id: item.id,
    title: item.title,
    workspaceSubject: item.workspace_subject,
    groupTitle: group.title,
  }
}

// 카테고리에 등록된 공개 상품 카드 데이터.
// market-search-server.searchMarketItemsForSubject와 동일한 조립 방식(메뉴 노출 가드,
// 서브상품 최저가, 유형명, 샘플 가용성)을 category_item_id 필터로 재현한다.
export interface CategoryListFilters {
  q?: string
  sort?: 'views' | 'latest'
  page?: number
  pageSize?: number
}

export async function listMarketItemsForCategory(categoryItemId: string, filters: CategoryListFilters = {}) {
  const empty = { rows: [] as MarketSearchRow[], ...getListPagination(0, 1, filters.pageSize) }
  const detail = await getMarketCategoryItemDetail(categoryItemId)
  if (!detail) {
    return empty
  }
  const workspaceSubject = detail.workspaceSubject

  const supabase = createAdminClient()
  const menuResult = await supabase
    .from('market_menu_entries')
    .select('id, slug, title')
    .eq('workspace_subject', workspaceSubject)
    .eq('is_visible', true)
    .eq('is_active', true)
    .is('deleted_at', null)
  if (menuResult.error) throw new Error(menuResult.error.message)
  const menuIds = (menuResult.data ?? []).map((entry) => entry.id)
  if (menuIds.length === 0) return empty
  const keyword = (filters.q ?? '').trim().normalize('NFC').toLowerCase()
  const matchingMenuIds = (menuResult.data ?? [])
    .filter((entry) => entry.title.normalize('NFC').toLowerCase().includes(keyword)).map((entry) => entry.id)
  function itemQuery(head = false) {
    let query = supabase.from('market_items')
      .select(`id, title, summary, menu_entry_id, exam_year, grade_level, question_count, view_count, published_at, created_at, ${MARKET_THUMBNAIL_EMBED}`, { count: 'exact', head })
      .eq('category_item_id', categoryItemId).eq('workspace_subject', workspaceSubject)
      .eq('status', 'published').eq('is_active', true).is('deleted_at', null).in('menu_entry_id', menuIds)
    if (keyword) {
      const terms = [...new Set([keyword, keyword.normalize('NFD')])].flatMap((term) => {
        const escaped = term.replace(/[\\%_]/g, '\\$&')
        return ['title', 'summary'].map((column) => `${column}.ilike.${JSON.stringify(`%${escaped}%`)}`)
      })
      if (matchingMenuIds.length > 0) terms.push(`menu_entry_id.in.(${matchingMenuIds.join(',')})`)
      query = query.or(terms.join(','))
    }
    return query
  }
  const { count, error: countError } = await itemQuery(true)
  if (countError) throw new Error(countError.message)
  const pagination = getListPagination(count ?? 0, filters.page, filters.pageSize)
  if (!pagination.totalCount) return { ...empty, ...pagination }
  let query = itemQuery()
  if (filters.sort !== 'latest') query = query.order('view_count', { ascending: false })
  const itemsResult = await query.order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false }).order('id', { ascending: true })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1)
  if (itemsResult.error) throw new Error(itemsResult.error.message)
  const itemIds = (itemsResult.data ?? []).map((item) => item.id)
  if (!itemIds.length) return { ...empty, ...pagination }
  const [subproducts, typeCategoriesResult, reviews] = await Promise.all([
    readAllQueryRows((from, to) => supabase
      .from('market_item_subproducts')
      .select('item_id, category_id, price_credits')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .is('deleted_at', null).in('item_id', itemIds).order('id').range(from, to)),
    // 구성 배지 순서는 분류의 sort_order(같으면 이름순)를 따른다.
    supabase
      .from('market_subproduct_categories')
      .select('id, slug, name, sort_order')
      .eq('workspace_subject', workspaceSubject)
      .order('sort_order').order('name'),
    readAllQueryRows((from, to) => supabase
      .from('market_item_reviews')
      .select('item_id, rating')
      .eq('workspace_subject', workspaceSubject)
      .is('deleted_at', null).in('item_id', itemIds).order('id').range(from, to)),
  ])

  if (typeCategoriesResult.error) throw new Error(typeCategoriesResult.error.message)

  const menuMap = new Map((menuResult.data ?? []).map((entry) => [entry.id, entry]))
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
  const typeNamesOf = (itemId: string) => {
    const categoryIds = typeCategoryIdsByItem.get(itemId)
    return Array.from(new Set(typeCategories
      .filter((category) => categoryIds?.has(category.id))
      .map((category) => category.name)))
  }

  // 별점 요약 (market-item-list-enrichment의 집계 방식과 동일)
  const ratingTotals = new Map<string, { total: number; count: number }>()
  for (const review of reviews) {
    const current = ratingTotals.get(review.item_id) ?? { total: 0, count: 0 }
    current.total += review.rating
    current.count += 1
    ratingTotals.set(review.item_id, current)
  }

  const rows = (itemsResult.data ?? [])
    // 노출 메뉴에 속한 아이템만 (숨김/비활성 메뉴의 카탈로그 유출 방지 — 검색과 동일)
    .filter((item) => menuMap.has(item.menu_entry_id))
    .map((item) => {
      const menu = menuMap.get(item.menu_entry_id)!
      const rating = ratingTotals.get(item.id)
      return {
        itemId: item.id,
        title: item.title,
        summary: item.summary,
        thumbnailUrl: toMarketThumbnailUrl(supabase, item),
        categorySlug: menu.slug,
        categoryTitle: menu.title,
        examYear: item.exam_year,
        gradeLevel: item.grade_level,
        questionCount: item.question_count,
        viewCount: item.view_count,
        publishedAt: item.published_at ?? item.created_at,
        ratingAverage: rating ? rating.total / rating.count : null,
        ratingCount: rating?.count ?? 0,
        minPriceCredits: minPriceByItem.get(item.id) ?? null,
        typeNames: typeNamesOf(item.id),
      }
    })

  const samplePageMap = await listActiveMarketItemSamplePagesForItems(
    rows.map((row) => row.itemId),
    workspaceSubject
  )

  return {
    ...pagination,
    rows: rows.map((row) => ({
      ...row,
      sampleAvailable: (samplePageMap.get(row.itemId)?.length ?? 0) > 0,
    })),
  }
}

// 상품 저장 시 카테고리 지정값의 과목 검증용 (비활성 항목 포함 조회). 없으면 null.
export async function getMarketCategoryItemWorkspaceSubject(id: string): Promise<WorkspaceSubject | null> {
  if (!UUID_PATTERN.test(id)) {
    return null
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_category_items')
    .select('workspace_subject')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }
  if (!data || !isWorkspaceSubject(data.workspace_subject)) {
    return null
  }
  return data.workspace_subject
}

export interface AdminCategoryItem {
  id: string
  title: string
  sort_order: number
  is_active: boolean
  // 카테고리 항목 기본 이미지(제안 E). 상품 이미지가 없을 때 표시된다.
  default_image: { id: string; publicUrl: string } | null
}

export interface AdminCategoryGroup {
  id: string
  workspace_subject: WorkspaceSubject
  title: string
  sort_order: number
  is_active: boolean
  items: AdminCategoryItem[]
}

// 관리자 트리: 비활성 포함, 그룹별 항목.
export async function listMarketCategoryTreeForAdmin(subject: WorkspaceSubject): Promise<AdminCategoryGroup[]> {
  const supabase = createAdminClient()

  const [groupsResult, itemsResult] = await Promise.all([
    supabase
      .from('market_category_groups')
      .select('id, workspace_subject, title, sort_order, is_active')
      .eq('workspace_subject', subject)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('market_category_items')
      .select('id, group_id, title, sort_order, is_active, default_image:market_images(id, storage_path)')
      .eq('workspace_subject', subject)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
  ])

  if (groupsResult.error) {
    throw new MarketCategoryError(500, `카테고리 그룹을 불러오지 못했습니다: ${groupsResult.error.message}`)
  }
  if (itemsResult.error) {
    throw new MarketCategoryError(500, `카테고리 항목을 불러오지 못했습니다: ${itemsResult.error.message}`)
  }

  const itemsByGroup = new Map<string, AdminCategoryItem[]>()
  for (const item of itemsResult.data ?? []) {
    const current = itemsByGroup.get(item.group_id) ?? []
    const defaultImage = item.default_image as { id: string; storage_path: string } | null
    current.push({
      id: item.id,
      title: item.title,
      sort_order: item.sort_order,
      is_active: item.is_active,
      default_image: defaultImage
        ? { id: defaultImage.id, publicUrl: supabase.storage.from(MARKET_IMAGES_BUCKET).getPublicUrl(defaultImage.storage_path).data.publicUrl }
        : null,
    })
    itemsByGroup.set(item.group_id, current)
  }

  return (groupsResult.data ?? [])
    .filter((group) => isWorkspaceSubject(group.workspace_subject))
    .map((group) => ({
      id: group.id,
      workspace_subject: group.workspace_subject as WorkspaceSubject,
      title: group.title,
      sort_order: group.sort_order,
      is_active: group.is_active,
      items: itemsByGroup.get(group.id) ?? [],
    }))
}

export async function createCategoryGroup(input: {
  workspaceSubject: WorkspaceSubject
  title: string
  sortOrder?: number
}) {
  const title = input.title.trim()
  if (!title) {
    throw new MarketCategoryError(400, '그룹 이름을 입력해주세요.')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_category_groups')
    .insert({
      workspace_subject: input.workspaceSubject,
      title,
      sort_order: input.sortOrder ?? 0,
    })
    .select('*')
    .single()

  if (error) {
    throw new MarketCategoryError(500, `카테고리 그룹을 생성하지 못했습니다: ${error.message}`)
  }
  return data
}

export async function updateCategoryGroup(
  groupId: string,
  input: { title?: string; sortOrder?: number; isActive?: boolean }
) {
  const patch: { title?: string; sort_order?: number; is_active?: boolean } = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) {
      throw new MarketCategoryError(400, '그룹 이름을 입력해주세요.')
    }
    patch.title = title
  }
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder
  if (input.isActive !== undefined) patch.is_active = input.isActive
  if (Object.keys(patch).length === 0) {
    throw new MarketCategoryError(400, '변경할 내용이 없습니다.')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_category_groups')
    .update(patch)
    .eq('id', groupId)
    .select('*')
    .maybeSingle()

  if (error) {
    throw new MarketCategoryError(500, `카테고리 그룹을 수정하지 못했습니다: ${error.message}`)
  }
  if (!data) {
    throw new MarketCategoryError(404, '카테고리 그룹을 찾을 수 없습니다.')
  }
  return data
}

// 그룹 삭제 시 하위 항목은 FK on delete cascade로 함께 삭제되고,
// 삭제된 항목에 연결돼 있던 상품(market_items.category_item_id)은
// 복합 FK on delete set null로 카테고리 연결만 해제된다(상품은 유지).
export async function deleteCategoryGroup(groupId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_category_groups')
    .delete()
    .eq('id', groupId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new MarketCategoryError(500, `카테고리 그룹을 삭제하지 못했습니다: ${error.message}`)
  }
  if (!data) {
    throw new MarketCategoryError(404, '카테고리 그룹을 찾을 수 없습니다.')
  }
}

export async function createCategoryItem(input: {
  groupId: string
  title: string
  sortOrder?: number
}) {
  const title = input.title.trim()
  if (!title) {
    throw new MarketCategoryError(400, '항목 이름을 입력해주세요.')
  }

  const supabase = createAdminClient()
  const { data: group, error: groupError } = await supabase
    .from('market_category_groups')
    .select('id, workspace_subject')
    .eq('id', input.groupId)
    .maybeSingle()

  if (groupError) {
    throw new MarketCategoryError(500, `카테고리 그룹을 확인하지 못했습니다: ${groupError.message}`)
  }
  if (!group) {
    throw new MarketCategoryError(404, '카테고리 그룹을 찾을 수 없습니다.')
  }

  const { data, error } = await supabase
    .from('market_category_items')
    .insert({
      group_id: group.id,
      // 그룹의 workspace_subject를 복사해 과목 정합 유지
      workspace_subject: group.workspace_subject,
      title,
      sort_order: input.sortOrder ?? 0,
    })
    .select('*')
    .single()

  if (error) {
    throw new MarketCategoryError(500, `카테고리 항목을 생성하지 못했습니다: ${error.message}`)
  }
  return data
}

export async function updateCategoryItem(
  itemId: string,
  input: { title?: string; sortOrder?: number; isActive?: boolean; defaultImageId?: string | null }
) {
  const patch: { title?: string; sort_order?: number; is_active?: boolean; default_image_id?: string | null } = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) {
      throw new MarketCategoryError(400, '항목 이름을 입력해주세요.')
    }
    patch.title = title
  }
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder
  if (input.isActive !== undefined) patch.is_active = input.isActive
  if (input.defaultImageId !== undefined) patch.default_image_id = input.defaultImageId
  if (Object.keys(patch).length === 0) {
    throw new MarketCategoryError(400, '변경할 내용이 없습니다.')
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_category_items')
    .update(patch)
    .eq('id', itemId)
    .select('*')
    .maybeSingle()

  if (error?.code === '23503' && /default_image_id_fkey/.test(error.message)) {
    throw new MarketCategoryError(404, '선택한 이미지를 찾을 수 없습니다. 이미지를 다시 선택해주세요.')
  }
  if (error) {
    throw new MarketCategoryError(500, `카테고리 항목을 수정하지 못했습니다: ${error.message}`)
  }
  if (!data) {
    throw new MarketCategoryError(404, '카테고리 항목을 찾을 수 없습니다.')
  }
  return data
}

// 항목 삭제 시 연결 상품은 복합 FK on delete set null로 카테고리 연결만 해제된다.
export async function deleteCategoryItem(itemId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_category_items')
    .delete()
    .eq('id', itemId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new MarketCategoryError(500, `카테고리 항목을 삭제하지 못했습니다: ${error.message}`)
  }
  if (!data) {
    throw new MarketCategoryError(404, '카테고리 항목을 찾을 수 없습니다.')
  }
}
