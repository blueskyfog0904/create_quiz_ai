import 'server-only'

import { listActiveMarketItemSamplePagesForItems } from '@/lib/market-sample-pages-server'
import type { MarketSearchRow } from '@/lib/market-search-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { isWorkspaceSubject, type WorkspaceSubject } from '@/lib/workspace-subject'
import { getListPagination } from '@/lib/list-pagination'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import { MARKET_IMAGES_BUCKET, MARKET_THUMBNAIL_EMBED, toMarketThumbnailUrl } from '@/lib/market-images'
import {
  applyCategoryItemCounts,
  buildCategoryTree,
  collectSubtreeIds,
  findCategoryPath,
  MARKET_CATEGORY_MAX_DEPTH,
  type MarketCategoryNode,
  type MarketCategoryTree,
} from '@/lib/market-category-tree'

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

// 공개 트리: 활성 칸만, 조상 중 비활성이 있으면 그 아래 전체를 뺀다. 노드는 한 쿼리로 읽는다.
// includeCounts면 공개 상품을 한 번에 읽어 칸마다 하위 합산 개수를 채운다(칸 수와 무관한 쿼리 수).
export async function listMarketCategoryTree(includeCounts = false): Promise<MarketCategoryTree> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_category_items')
    .select('id, workspace_subject, parent_id, depth, title, sort_order, created_at')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    throw new Error(error.message)
  }
  const tree = buildCategoryTree(data ?? [])

  if (includeCounts) {
    // 노출 게시판의 상품만 센다(게시판 게이트는 S3에서 제거).
    const { data: entries, error: entriesError } = await supabase.from('market_menu_entries').select('id')
      .eq('is_visible', true).eq('is_active', true).is('deleted_at', null)
    if (entriesError) throw new Error(entriesError.message)
    const menuIds = (entries ?? []).map((entry) => entry.id)
    const items = menuIds.length === 0 ? [] : await readAllQueryRows((from, to) => supabase
      .from('market_items')
      .select('id, category_item_id, workspace_subject')
      .eq('status', 'published').eq('is_active', true).is('deleted_at', null).in('menu_entry_id', menuIds)
      .order('id').range(from, to))
    // 과목별로 센다(목록 조회와 같은 과목 조건).
    const directCounts = { english: new Map<string, number>(), korean: new Map<string, number>() }
    for (const item of items) {
      if (!item.category_item_id || !isWorkspaceSubject(item.workspace_subject)) continue
      const counts = directCounts[item.workspace_subject]
      counts.set(item.category_item_id, (counts.get(item.category_item_id) ?? 0) + 1)
    }
    applyCategoryItemCounts(tree.english, directCounts.english)
    applyCategoryItemCounts(tree.korean, directCounts.korean)
  }
  return tree
}

export interface MarketCategoryNodeSummary {
  id: string
  title: string
  itemCount?: number
}

export interface MarketCategoryNodeDetail {
  id: string
  title: string
  depth: number
  workspaceSubject: WorkspaceSubject
  ancestors: { id: string; title: string }[]
  children: MarketCategoryNodeSummary[]
  // 같은 부모 아래 칸(자신 포함). 말단 칸의 '더 자세히 찾기'에 쓴다.
  siblings: MarketCategoryNodeSummary[]
  subtreeIds: string[]
}

const toSummary = ({ id, title, itemCount }: MarketCategoryNode): MarketCategoryNodeSummary => ({ id, title, itemCount })

// 카테고리 페이지용 칸 정보. uuid 형식이 아니거나 공개 트리에 없으면(없거나 자기·조상 중 비활성) null.
// 트리를 넘기면 추가 쿼리 없이 찾는다.
export async function getMarketCategoryNodeDetail(
  id: string,
  tree?: MarketCategoryTree
): Promise<MarketCategoryNodeDetail | null> {
  if (!UUID_PATTERN.test(id)) {
    return null
  }

  const source = tree ?? await listMarketCategoryTree()
  for (const workspaceSubject of ['korean', 'english'] as const) {
    const path = findCategoryPath(source[workspaceSubject], id)
    if (!path) continue
    const node = path[path.length - 1]
    const parent = path.length > 1 ? path[path.length - 2] : null
    return {
      id: node.id,
      title: node.title,
      depth: node.depth,
      workspaceSubject,
      ancestors: path.slice(0, -1).map(({ id: ancestorId, title }) => ({ id: ancestorId, title })),
      children: node.children.map(toSummary),
      siblings: (parent ? parent.children : source[workspaceSubject]).map(toSummary),
      subtreeIds: collectSubtreeIds(node),
    }
  }
  return null
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

// 칸과 하위 칸 전체의 상품을 보여 준다.
// 페이지가 이미 조회한 칸 정보(knownDetail)를 넘기면 같은 조회를 다시 하지 않는다.
export async function listMarketItemsForCategory(
  categoryItemId: string,
  filters: CategoryListFilters = {},
  knownDetail?: MarketCategoryNodeDetail
) {
  const empty = { rows: [] as MarketSearchRow[], ...getListPagination(0, 1, filters.pageSize) }
  const detail = knownDetail ?? await getMarketCategoryNodeDetail(categoryItemId)
  if (!detail) {
    return empty
  }
  const workspaceSubject = detail.workspaceSubject
  const subtreeIds = detail.subtreeIds

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
      .in('category_item_id', subtreeIds).eq('workspace_subject', workspaceSubject)
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
  const menuMap = new Map((menuResult.data ?? []).map((entry) => [entry.id, entry]))
  // 샘플 가용성도 화면에 나갈 아이템(노출 메뉴 소속) 기준으로, 나머지 보강 조회와 함께 한 번에 읽는다.
  const visibleItemIds = (itemsResult.data ?? [])
    .filter((item) => menuMap.has(item.menu_entry_id)).map((item) => item.id)
  const [subproducts, typeCategoriesResult, reviews, samplePageMap] = await Promise.all([
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
    listActiveMarketItemSamplePagesForItems(visibleItemIds, workspaceSubject),
  ])

  if (typeCategoriesResult.error) throw new Error(typeCategoriesResult.error.message)

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

export interface AdminCategoryNode {
  id: string
  title: string
  depth: number
  sortOrder: number
  isActive: boolean
  // 칸 기본 이미지. 상품 이미지가 없을 때 표시된다.
  defaultImage: { id: string; publicUrl: string } | null
  // 자기 칸 + 하위 칸에 연결된 상품 행 수(삭제된 상품 포함 — DB 삭제 차단과 같은 기준)
  productCount: number
  deletedProductCount: number
  children: AdminCategoryNode[]
}

// 관리자 트리: 비활성 포함, 칸마다 하위 합산 상품 수.
export async function listMarketCategoryTreeForAdmin(subject: WorkspaceSubject): Promise<AdminCategoryNode[]> {
  const supabase = createAdminClient()

  const [nodesResult, products] = await Promise.all([
    supabase
      .from('market_category_items')
      .select('id, parent_id, depth, title, sort_order, is_active, created_at, default_image:market_images(id, storage_path)')
      .eq('workspace_subject', subject)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    readAllQueryRows((from, to) => supabase
      .from('market_items')
      .select('id, category_item_id, deleted_at')
      .eq('workspace_subject', subject)
      .order('id').range(from, to)),
  ])

  if (nodesResult.error) {
    throw new MarketCategoryError(500, `카테고리를 불러오지 못했습니다: ${nodesResult.error.message}`)
  }

  const directCounts = new Map<string, { total: number; deleted: number }>()
  for (const product of products) {
    if (!product.category_item_id) continue
    const current = directCounts.get(product.category_item_id) ?? { total: 0, deleted: 0 }
    current.total += 1
    if (product.deleted_at) current.deleted += 1
    directCounts.set(product.category_item_id, current)
  }

  const rows = [...(nodesResult.data ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
  const nodes = new Map<string, AdminCategoryNode>()
  for (const row of rows) {
    const defaultImage = row.default_image as { id: string; storage_path: string } | null
    nodes.set(row.id, {
      id: row.id,
      title: row.title,
      depth: row.depth,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      defaultImage: defaultImage
        ? { id: defaultImage.id, publicUrl: supabase.storage.from(MARKET_IMAGES_BUCKET).getPublicUrl(defaultImage.storage_path).data.publicUrl }
        : null,
      productCount: 0,
      deletedProductCount: 0,
      children: [],
    })
  }
  const roots: AdminCategoryNode[] = []
  for (const row of rows) {
    const node = nodes.get(row.id)!
    if (row.parent_id === null) roots.push(node)
    else nodes.get(row.parent_id)?.children.push(node)
  }

  const fillCounts = (list: AdminCategoryNode[]) => {
    for (const node of list) {
      fillCounts(node.children)
      const direct = directCounts.get(node.id)
      node.productCount = (direct?.total ?? 0) + node.children.reduce((sum, child) => sum + child.productCount, 0)
      node.deletedProductCount = (direct?.deleted ?? 0) + node.children.reduce((sum, child) => sum + child.deletedProductCount, 0)
    }
  }
  fillCounts(roots)
  return roots
}

export async function createCategoryNode(input: {
  workspaceSubject: WorkspaceSubject
  parentId: string | null
  title: string
  sortOrder?: number
}) {
  const title = input.title.trim()
  if (!title) {
    throw new MarketCategoryError(400, '칸 이름을 입력해주세요.')
  }

  const supabase = createAdminClient()
  let depth = 1
  if (input.parentId) {
    const { data: parent, error: parentError } = await supabase
      .from('market_category_items')
      .select('id, workspace_subject, depth')
      .eq('id', input.parentId)
      .maybeSingle()

    if (parentError) {
      throw new MarketCategoryError(500, `상위 칸을 확인하지 못했습니다: ${parentError.message}`)
    }
    if (!parent) {
      throw new MarketCategoryError(404, '상위 칸을 찾을 수 없습니다.')
    }
    if (parent.workspace_subject !== input.workspaceSubject) {
      throw new MarketCategoryError(400, '같은 과목의 칸 아래에만 추가할 수 있습니다.')
    }
    if (parent.depth >= MARKET_CATEGORY_MAX_DEPTH) {
      throw new MarketCategoryError(400, `depth${MARKET_CATEGORY_MAX_DEPTH} 아래에는 칸을 추가할 수 없습니다.`)
    }
    depth = parent.depth + 1
  }

  const { data, error } = await supabase
    .from('market_category_items')
    .insert({
      workspace_subject: input.workspaceSubject,
      parent_id: input.parentId,
      depth,
      title,
      sort_order: input.sortOrder ?? 0,
    })
    .select('*')
    .single()

  if (error) {
    throw new MarketCategoryError(500, `칸을 만들지 못했습니다: ${error.message}`)
  }
  return data
}

export async function updateCategoryNode(
  nodeId: string,
  input: { title?: string; sortOrder?: number; isActive?: boolean; defaultImageId?: string | null }
) {
  const patch: { title?: string; sort_order?: number; is_active?: boolean; default_image_id?: string | null } = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) {
      throw new MarketCategoryError(400, '칸 이름을 입력해주세요.')
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
    .eq('id', nodeId)
    .select('*')
    .maybeSingle()

  if (error?.code === '23503' && /default_image_id_fkey/.test(error.message)) {
    throw new MarketCategoryError(404, '선택한 이미지를 찾을 수 없습니다. 이미지를 다시 선택해주세요.')
  }
  if (error) {
    throw new MarketCategoryError(500, `칸을 수정하지 못했습니다: ${error.message}`)
  }
  if (!data) {
    throw new MarketCategoryError(404, '칸을 찾을 수 없습니다.')
  }
  return data
}

const LINKED_PRODUCTS_MESSAGE = '연결된 상품이 있어 삭제할 수 없습니다. 비활성화하거나 상품을 옮긴 뒤 삭제해주세요.'
const CHILD_NODES_MESSAGE = '하위 칸을 먼저 삭제해주세요.'

// 자기·하위 칸에 상품이 있거나(삭제된 상품 포함) 하위 칸이 있으면 409로 막는다. 상품 연결은 풀지 않는다.
export async function deleteCategoryNode(nodeId: string) {
  const supabase = createAdminClient()
  const { data: nodes, error: nodesError } = await supabase
    .from('market_category_items')
    .select('id, parent_id')
  if (nodesError) {
    throw new MarketCategoryError(500, `칸을 확인하지 못했습니다: ${nodesError.message}`)
  }
  if (!(nodes ?? []).some((node) => node.id === nodeId)) {
    throw new MarketCategoryError(404, '칸을 찾을 수 없습니다.')
  }

  const childrenByParent = new Map<string, string[]>()
  for (const node of nodes ?? []) {
    if (!node.parent_id) continue
    childrenByParent.set(node.parent_id, [...(childrenByParent.get(node.parent_id) ?? []), node.id])
  }
  const subtreeIds: string[] = []
  const collect = (id: string) => {
    subtreeIds.push(id)
    for (const childId of childrenByParent.get(id) ?? []) collect(childId)
  }
  collect(nodeId)

  const products = await readAllQueryRows((from, to) => supabase
    .from('market_items')
    .select('id, deleted_at')
    .in('category_item_id', subtreeIds)
    .order('id').range(from, to))
  if (products.length > 0) {
    const deletedCount = products.filter((product) => product.deleted_at).length
    throw new MarketCategoryError(409, deletedCount > 0
      ? `${LINKED_PRODUCTS_MESSAGE} (삭제된 상품 ${deletedCount}개 포함)`
      : LINKED_PRODUCTS_MESSAGE)
  }
  if ((childrenByParent.get(nodeId) ?? []).length > 0) {
    throw new MarketCategoryError(409, CHILD_NODES_MESSAGE)
  }

  const { data, error } = await supabase
    .from('market_category_items')
    .delete()
    .eq('id', nodeId)
    .select('id')
    .maybeSingle()

  // 확인과 삭제 사이에 상품·하위 칸이 생긴 경우: 제약 이름으로 구분한다.
  if (error?.code === '23503') {
    const detail = `${error.message} ${error.details ?? ''}`
    if (detail.includes('market_items_category_item_subject_fkey')) {
      throw new MarketCategoryError(409, LINKED_PRODUCTS_MESSAGE)
    }
    if (detail.includes('market_category_items_parent_subject_fkey')) {
      throw new MarketCategoryError(409, CHILD_NODES_MESSAGE)
    }
    throw new MarketCategoryError(409, '다른 데이터가 이 칸을 참조하고 있어 삭제할 수 없습니다.')
  }
  if (error) {
    throw new MarketCategoryError(500, `칸을 삭제하지 못했습니다: ${error.message}`)
  }
  if (!data) {
    throw new MarketCategoryError(404, '칸을 찾을 수 없습니다.')
  }
}
