import 'server-only'

import { listActiveMarketItemSamplePagesForItems } from '@/lib/market-sample-pages-server'
import type { MarketSearchRow } from '@/lib/market-search-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'

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
  items: { id: string; title: string }[]
}

export interface MarketCategoryMenu {
  english: MegaMenuGroup[]
  korean: MegaMenuGroup[]
}

// 공개 메가메뉴 트리: 활성 그룹 + 활성 항목만, sort_order 정렬.
export async function listMarketCategoryMenu(): Promise<MarketCategoryMenu> {
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
export async function listMarketItemsForCategory(categoryItemId: string): Promise<MarketSearchRow[]> {
  const detail = await getMarketCategoryItemDetail(categoryItemId)
  if (!detail) {
    return []
  }
  const workspaceSubject = detail.workspaceSubject

  const supabase = createAdminClient()
  const [itemsResult, menuResult, subproductsResult, typeCategoriesResult] = await Promise.all([
    supabase
      .from('market_items')
      .select('id, title, summary, thumbnail_url, menu_entry_id, exam_year, grade_level, question_count, view_count, published_at, created_at')
      .eq('category_item_id', categoryItemId)
      .eq('workspace_subject', workspaceSubject)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('market_menu_entries')
      .select('id, slug, title')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_visible', true)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('market_item_subproducts')
      .select('item_id, category_id, price_credits')
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('market_subproduct_categories')
      .select('id, slug, name')
      .eq('workspace_subject', workspaceSubject),
  ])

  for (const result of [itemsResult, menuResult, subproductsResult, typeCategoriesResult]) {
    if (result.error) {
      throw new Error(result.error.message)
    }
  }

  const menuMap = new Map((menuResult.data ?? []).map((entry) => [entry.id, entry]))
  const typeCategoryMap = new Map((typeCategoriesResult.data ?? []).map((category) => [category.id, category]))

  const minPriceByItem = new Map<string, number>()
  const typeNamesByItem = new Map<string, Set<string>>()
  for (const subproduct of subproductsResult.data ?? []) {
    const current = minPriceByItem.get(subproduct.item_id)
    if (current === undefined || subproduct.price_credits < current) {
      minPriceByItem.set(subproduct.item_id, subproduct.price_credits)
    }
    const category = typeCategoryMap.get(subproduct.category_id)
    if (category) {
      const names = typeNamesByItem.get(subproduct.item_id) ?? new Set<string>()
      names.add(category.name)
      typeNamesByItem.set(subproduct.item_id, names)
    }
  }

  const rows = (itemsResult.data ?? [])
    // 노출 메뉴에 속한 아이템만 (숨김/비활성 메뉴의 카탈로그 유출 방지 — 검색과 동일)
    .filter((item) => menuMap.has(item.menu_entry_id))
    .map((item) => {
      const menu = menuMap.get(item.menu_entry_id)!
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
        typeNames: Array.from(typeNamesByItem.get(item.id) ?? []),
      }
    })
    .sort((a, b) => b.viewCount - a.viewCount || (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))

  const samplePageMap = await listActiveMarketItemSamplePagesForItems(
    rows.map((row) => row.itemId),
    workspaceSubject
  )

  return rows.map((row) => ({
    ...row,
    sampleAvailable: (samplePageMap.get(row.itemId)?.length ?? 0) > 0,
  }))
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
      .select('id, group_id, title, sort_order, is_active')
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
    current.push({ id: item.id, title: item.title, sort_order: item.sort_order, is_active: item.is_active })
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
  input: { title?: string; sortOrder?: number; isActive?: boolean }
) {
  const patch: { title?: string; sort_order?: number; is_active?: boolean } = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) {
      throw new MarketCategoryError(400, '항목 이름을 입력해주세요.')
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
    .from('market_category_items')
    .update(patch)
    .eq('id', itemId)
    .select('*')
    .maybeSingle()

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
