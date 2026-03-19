import { createAdminClient } from '@/lib/supabase/bypass'
import type { Tables, TablesInsert, TablesUpdate } from '@/types/supabase'

export type MarketItem = Tables<'market_items'>
export type MarketItemFile = Tables<'market_item_files'>
export type MarketPurchase = Tables<'market_purchases'>
export type MarketDownloadEvent = Tables<'market_download_events'>
export type MarketItemViewEvent = Tables<'market_item_view_events'>

export interface MarketLibraryRow {
  itemId: string
  categorySlug: string | null
  categoryTitle: string
  title: string
  summary: string | null
  purchasedAt: string
  lastDownloadedAt: string | null
  pdfOwned: boolean
  hwpOwned: boolean
  pdfPurchasedAt: string | null
  hwpPurchasedAt: string | null
  pdfDownloadUrl: string | null
  hwpDownloadUrl: string | null
  pdfAvailable: boolean
  hwpAvailable: boolean
  pdfFileName: string | null
  hwpFileName: string | null
}

export interface MarketLibraryRow {
  itemId: string
  categorySlug: string | null
  categoryTitle: string
  title: string
  summary: string | null
  purchasedAt: string
  lastDownloadedAt: string | null
  pdfOwned: boolean
  hwpOwned: boolean
  pdfPurchasedAt: string | null
  hwpPurchasedAt: string | null
  pdfDownloadUrl: string | null
  hwpDownloadUrl: string | null
  pdfAvailable: boolean
  hwpAvailable: boolean
  pdfFileName: string | null
  hwpFileName: string | null
}

export interface MarketItemListFilters {
  search?: string
  assetKind?: 'pdf' | 'hwp' | 'sample' | 'all'
  gradeLevel?: string
  examYear?: number
  examMonth?: number
  sort?: 'latest' | 'views' | 'price_asc'
}

export async function getMarketItemFilterOptions(menuEntryId: string) {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_items')
    .select('exam_year, exam_month, grade_level')
    .eq('menu_entry_id', menuEntryId)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (error) {
    throw new Error(error.message)
  }

  const years = Array.from(new Set((data ?? []).map((item) => item.exam_year).filter((value): value is number => value !== null))).sort((a, b) => b - a)
  const months = Array.from(new Set((data ?? []).map((item) => item.exam_month).filter((value): value is number => value !== null))).sort((a, b) => a - b)
  const grades = Array.from(new Set((data ?? []).map((item) => item.grade_level).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'ko'))

  return { years, months, grades }
}

function getAdminSupabase() {
  return createAdminClient()
}

function normalizeText(value?: string | null) {
  return value?.trim() ?? ''
}

function normalizeNullableText(value?: string | null) {
  const normalized = normalizeText(value)
  return normalized.length > 0 ? normalized : null
}

function ensureNonNegativeInteger(value: number | null | undefined, label: string) {
  if (value === null || value === undefined || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label}은(는) 0 이상의 정수여야 합니다.`)
  }
}

function validateMarketItemInput(input: {
  title?: string | null
  pdf_price?: number | null
  hwp_price?: number | null
}) {
  const title = normalizeText(input.title)
  if (!title) {
    throw new Error('상품 제목을 입력해주세요.')
  }

  if (title.length > 120) {
    throw new Error('상품 제목은 120자 이하로 입력해주세요.')
  }

  ensureNonNegativeInteger(input.pdf_price ?? 0, 'PDF 가격')
  ensureNonNegativeInteger(input.hwp_price ?? 0, 'HWP 가격')

  return {
    title,
    pdfPrice: input.pdf_price ?? 0,
    hwpPrice: input.hwp_price ?? 0,
  }
}

export async function listMarketItemsForAdmin(menuEntryId?: string): Promise<MarketItem[]> {
  const supabase = getAdminSupabase()

  let query = supabase
    .from('market_items')
    .select('*')
    .is('deleted_at', null)
    .order('sort_order')
    .order('created_at', { ascending: false })

  if (menuEntryId) {
    query = query.eq('menu_entry_id', menuEntryId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function listPublishedMarketItems(menuEntryId: string, filters: MarketItemListFilters = {}): Promise<MarketItem[]> {
  const supabase = getAdminSupabase()

  let query = supabase
    .from('market_items')
    .select('*')
    .eq('menu_entry_id', menuEntryId)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)

  if (filters.search) {
    query = query.ilike('title', `%${filters.search.trim()}%`)
  }

  if (filters.gradeLevel) {
    query = query.eq('grade_level', filters.gradeLevel)
  }

  if (filters.examYear !== undefined) {
    query = query.eq('exam_year', filters.examYear)
  }

  if (filters.examMonth !== undefined) {
    query = query.eq('exam_month', filters.examMonth)
  }

  if (filters.assetKind === 'pdf') {
    query = query.gt('pdf_price', 0)
  }

  if (filters.assetKind === 'hwp') {
    query = query.gt('hwp_price', 0)
  }

  if (filters.sort === 'views') {
    query = query.order('view_count', { ascending: false }).order('published_at', { ascending: false })
  } else if (filters.sort === 'price_asc') {
    query = query.order('pdf_price', { ascending: true }).order('hwp_price', { ascending: true })
  } else {
    query = query.order('published_at', { ascending: false }).order('created_at', { ascending: false })
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getMarketItemById(id: string): Promise<MarketItem | null> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function getPublishedMarketItemById(id: string): Promise<MarketItem | null> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .eq('id', id)
    .eq('status', 'published')
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function listMarketItemFiles(itemId: string, includeInactive = false): Promise<MarketItemFile[]> {
  const supabase = getAdminSupabase()

  let query = supabase
    .from('market_item_files')
    .select('*')
    .eq('item_id', itemId)
    .order('asset_kind')
    .order('version', { ascending: false })
    .order('created_at', { ascending: false })

  if (!includeInactive) {
    query = query.eq('is_active', true).is('deleted_at', null)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function getActiveMarketItemFile(itemId: string, assetKind: 'sample' | 'pdf' | 'hwp'): Promise<MarketItemFile | null> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_item_files')
    .select('*')
    .eq('item_id', itemId)
    .eq('asset_kind', assetKind)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function createMarketItem(
  input: Pick<TablesInsert<'market_items'>,
    'menu_entry_id' | 'title' | 'summary' | 'description' | 'thumbnail_url' | 'exam_year' | 'exam_month' |
    'grade_level' | 'source_type' | 'source_1' | 'source_2' | 'source_3' | 'source_4' |
    'pdf_price' | 'hwp_price' | 'sort_order' | 'status' | 'is_active' | 'published_at' | 'created_by' | 'updated_by'>
) {
  const supabase = getAdminSupabase()
  const normalized = validateMarketItemInput(input)

  const payload: TablesInsert<'market_items'> = {
    menu_entry_id: input.menu_entry_id,
    title: normalized.title,
    summary: normalizeNullableText(input.summary),
    description: normalizeNullableText(input.description),
    thumbnail_url: normalizeNullableText(input.thumbnail_url),
    exam_year: input.exam_year ?? null,
    exam_month: input.exam_month ?? null,
    grade_level: normalizeNullableText(input.grade_level),
    source_type: normalizeNullableText(input.source_type),
    source_1: normalizeNullableText(input.source_1),
    source_2: normalizeNullableText(input.source_2),
    source_3: normalizeNullableText(input.source_3),
    source_4: normalizeNullableText(input.source_4),
    pdf_price: normalized.pdfPrice,
    hwp_price: normalized.hwpPrice,
    sort_order: input.sort_order ?? 0,
    status: input.status ?? 'draft',
    is_active: input.is_active ?? true,
    published_at: (input.status ?? 'draft') === 'published' ? (input.published_at ?? new Date().toISOString()) : null,
    created_by: input.created_by ?? null,
    updated_by: input.updated_by ?? null,
  }

  const { data, error } = await supabase
    .from('market_items')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function updateMarketItem(
  id: string,
  input: Pick<TablesUpdate<'market_items'>,
    'title' | 'summary' | 'description' | 'thumbnail_url' | 'exam_year' | 'exam_month' |
    'grade_level' | 'source_type' | 'source_1' | 'source_2' | 'source_3' | 'source_4' |
    'pdf_price' | 'hwp_price' | 'sort_order' | 'status' | 'is_active' | 'published_at' | 'updated_by'>
) {
  const supabase = getAdminSupabase()
  const { data: current, error: currentError } = await supabase
    .from('market_items')
    .select('*')
    .eq('id', id)
    .single()

  if (currentError) {
    throw new Error(currentError.message)
  }

  if (!current) {
    throw new Error('수정할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const normalized = validateMarketItemInput({
    title: input.title ?? current.title,
    pdf_price: input.pdf_price ?? current.pdf_price,
    hwp_price: input.hwp_price ?? current.hwp_price,
  })

  const nextStatus = input.status ?? current.status

  const payload: TablesUpdate<'market_items'> = {
    title: normalized.title,
    summary: normalizeNullableText(input.summary ?? current.summary),
    description: normalizeNullableText(input.description ?? current.description),
    thumbnail_url: normalizeNullableText(input.thumbnail_url ?? current.thumbnail_url),
    exam_year: input.exam_year ?? current.exam_year,
    exam_month: input.exam_month ?? current.exam_month,
    grade_level: normalizeNullableText(input.grade_level ?? current.grade_level),
    source_type: normalizeNullableText(input.source_type ?? current.source_type),
    source_1: normalizeNullableText(input.source_1 ?? current.source_1),
    source_2: normalizeNullableText(input.source_2 ?? current.source_2),
    source_3: normalizeNullableText(input.source_3 ?? current.source_3),
    source_4: normalizeNullableText(input.source_4 ?? current.source_4),
    pdf_price: normalized.pdfPrice,
    hwp_price: normalized.hwpPrice,
    sort_order: input.sort_order ?? current.sort_order,
    status: nextStatus,
    is_active: input.is_active ?? current.is_active,
    published_at: nextStatus === 'published'
      ? (input.published_at ?? current.published_at ?? new Date().toISOString())
      : null,
    updated_by: input.updated_by ?? current.updated_by,
  }

  const { data, error } = await supabase
    .from('market_items')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function archiveMarketItem(id: string, updatedBy?: string | null) {
  const supabase = getAdminSupabase()
  const { error } = await supabase
    .from('market_items')
    .update({
      status: 'archived',
      is_active: false,
      deleted_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    })
    .eq('id', id)

  if (error) {
    throw new Error(error.message)
  }
}

export async function replaceMarketItemFile(
  itemId: string,
  assetKind: 'sample' | 'pdf' | 'hwp',
  input: Pick<TablesInsert<'market_item_files'>,
    'storage_bucket' | 'storage_path' | 'original_file_name' | 'mime_type' | 'file_size_bytes' | 'checksum' | 'created_by'>
) {
  const supabase = getAdminSupabase()
  const currentFiles = await listMarketItemFiles(itemId, true)
  const previousVersion = currentFiles
    .filter((file) => file.asset_kind === assetKind)
    .reduce((maxVersion, file) => Math.max(maxVersion, file.version), 0)

  const { error: deactivateError } = await supabase
    .from('market_item_files')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('item_id', itemId)
    .eq('asset_kind', assetKind)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (deactivateError) {
    throw new Error(deactivateError.message)
  }

  const payload: TablesInsert<'market_item_files'> = {
    item_id: itemId,
    asset_kind: assetKind,
    storage_bucket: input.storage_bucket,
    storage_path: input.storage_path,
    original_file_name: input.original_file_name,
    mime_type: normalizeNullableText(input.mime_type),
    file_size_bytes: input.file_size_bytes ?? null,
    checksum: normalizeNullableText(input.checksum),
    version: previousVersion + 1,
    is_active: true,
    created_by: input.created_by ?? null,
  }

  const { data, error } = await supabase
    .from('market_item_files')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function listUserMarketPurchases(userId: string): Promise<MarketPurchase[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_purchases')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function listCompletedMarketPurchasesForUser(userId: string): Promise<MarketPurchase[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_purchases')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('purchased_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function listCompletedMarketPurchasesForUser(userId: string): Promise<MarketPurchase[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_purchases')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('purchased_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function findCompletedMarketPurchase(userId: string, itemId: string, assetKind: 'pdf' | 'hwp') {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_purchases')
    .select('*')
    .eq('user_id', userId)
    .eq('item_id', itemId)
    .eq('asset_kind', assetKind)
    .eq('status', 'completed')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function listCompletedMarketPurchasesForItem(userId: string, itemId: string): Promise<MarketPurchase[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_purchases')
    .select('*')
    .eq('user_id', userId)
    .eq('item_id', itemId)
    .eq('status', 'completed')
    .order('purchased_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  return data ?? []
}

export async function createMarketPurchase(input: TablesInsert<'market_purchases'>): Promise<MarketPurchase> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_purchases')
    .insert(input)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function recordMarketDownloadEvent(input: TablesInsert<'market_download_events'>): Promise<MarketDownloadEvent> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_download_events')
    .insert(input)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function recordMarketItemView(input: TablesInsert<'market_item_view_events'>): Promise<MarketItemViewEvent> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_item_view_events')
    .insert(input)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

export async function incrementMarketItemViewCount(itemId: string): Promise<void> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId)

  if (!item) {
    throw new Error('조회할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_items')
    .update({ view_count: item.view_count + 1 })
    .eq('id', itemId)

  if (error) {
    throw new Error(error.message)
  }
}

export async function listMarketLibraryRowsForUser(userId: string): Promise<MarketLibraryRow[]> {
  const supabase = getAdminSupabase()
  const purchases = await listCompletedMarketPurchasesForUser(userId)

  if (purchases.length === 0) {
    return []
  }

  const itemIds = Array.from(new Set(purchases.map((purchase) => purchase.item_id)))

  const [{ data: items, error: itemsError }, { data: files, error: filesError }, { data: downloads, error: downloadsError }] = await Promise.all([
    supabase
      .from('market_items')
      .select('*')
      .in('id', itemIds),
    supabase
      .from('market_item_files')
      .select('*')
      .in('item_id', itemIds)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('market_download_events')
      .select('*')
      .eq('user_id', userId)
      .in('item_id', itemIds)
      .order('created_at', { ascending: false }),
  ])

  if (itemsError) {
    throw new Error(itemsError.message)
  }

  if (filesError) {
    throw new Error(filesError.message)
  }

  if (downloadsError) {
    throw new Error(downloadsError.message)
  }

  const menuEntryIds = Array.from(new Set((items ?? []).map((item) => item.menu_entry_id)))
  const { data: menuEntries, error: menuEntriesError } = await supabase
    .from('market_menu_entries')
    .select('*')
    .in('id', menuEntryIds)

  if (menuEntriesError) {
    throw new Error(menuEntriesError.message)
  }

  const itemMap = new Map((items ?? []).map((item) => [item.id, item]))
  const menuMap = new Map((menuEntries ?? []).map((entry) => [entry.id, entry]))

  const fileMap = new Map<string, { pdf: MarketItemFile | null; hwp: MarketItemFile | null }>()
  for (const file of files ?? []) {
    const current = fileMap.get(file.item_id) ?? { pdf: null, hwp: null }
    if (file.asset_kind === 'pdf') current.pdf = file
    if (file.asset_kind === 'hwp') current.hwp = file
    fileMap.set(file.item_id, current)
  }

  const latestDownloadMap = new Map<string, string>()
  for (const event of downloads ?? []) {
    const key = `${event.item_id}:${event.asset_kind}`
    if (!latestDownloadMap.has(key)) {
      latestDownloadMap.set(key, event.created_at)
    }
  }

  const groupedPurchases = new Map<string, MarketPurchase[]>()
  for (const purchase of purchases) {
    const current = groupedPurchases.get(purchase.item_id) ?? []
    current.push(purchase)
    groupedPurchases.set(purchase.item_id, current)
  }

  return Array.from(groupedPurchases.entries())
    .map(([itemId, itemPurchases]) => {
      const item = itemMap.get(itemId)
      const menu = item ? menuMap.get(item.menu_entry_id) : null
      const assetFiles = fileMap.get(itemId) ?? { pdf: null, hwp: null }
      const pdfPurchase = itemPurchases.find((purchase) => purchase.asset_kind === 'pdf') ?? null
      const hwpPurchase = itemPurchases.find((purchase) => purchase.asset_kind === 'hwp') ?? null
      const purchasedAt = itemPurchases
        .map((purchase) => purchase.purchased_at)
        .sort((a, b) => b.localeCompare(a))[0]

      const lastDownloadedAt = [
        latestDownloadMap.get(`${itemId}:pdf`) ?? null,
        latestDownloadMap.get(`${itemId}:hwp`) ?? null,
      ]
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => b.localeCompare(a))[0] ?? null

      return {
        itemId,
        categorySlug: menu?.slug ?? null,
        categoryTitle: menu?.title ?? '알 수 없는 카테고리',
        title: item?.title ?? '삭제되었거나 찾을 수 없는 상품',
        summary: item?.summary ?? null,
        purchasedAt,
        lastDownloadedAt,
        pdfOwned: pdfPurchase !== null,
        hwpOwned: hwpPurchase !== null,
        pdfPurchasedAt: pdfPurchase?.purchased_at ?? null,
        hwpPurchasedAt: hwpPurchase?.purchased_at ?? null,
        pdfDownloadUrl: pdfPurchase ? `/api/market/items/${itemId}/download?assetKind=pdf` : null,
        hwpDownloadUrl: hwpPurchase ? `/api/market/items/${itemId}/download?assetKind=hwp` : null,
        pdfAvailable: pdfPurchase !== null && assetFiles.pdf !== null,
        hwpAvailable: hwpPurchase !== null && assetFiles.hwp !== null,
        pdfFileName: assetFiles.pdf?.original_file_name ?? null,
        hwpFileName: assetFiles.hwp?.original_file_name ?? null,
      }
    })
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
}

export async function listMarketLibraryRowsForUser(userId: string): Promise<MarketLibraryRow[]> {
  const supabase = getAdminSupabase()
  const purchases = await listCompletedMarketPurchasesForUser(userId)

  if (purchases.length === 0) {
    return []
  }

  const itemIds = Array.from(new Set(purchases.map((purchase) => purchase.item_id)))

  const [{ data: items, error: itemsError }, { data: files, error: filesError }, { data: downloads, error: downloadsError }] = await Promise.all([
    supabase
      .from('market_items')
      .select('*')
      .in('id', itemIds),
    supabase
      .from('market_item_files')
      .select('*')
      .in('item_id', itemIds)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('market_download_events')
      .select('*')
      .eq('user_id', userId)
      .in('item_id', itemIds)
      .order('created_at', { ascending: false }),
  ])

  if (itemsError) {
    throw new Error(itemsError.message)
  }

  if (filesError) {
    throw new Error(filesError.message)
  }

  if (downloadsError) {
    throw new Error(downloadsError.message)
  }

  const menuEntryIds = Array.from(new Set((items ?? []).map((item) => item.menu_entry_id)))
  const { data: menuEntries, error: menuEntriesError } = await supabase
    .from('market_menu_entries')
    .select('*')
    .in('id', menuEntryIds)

  if (menuEntriesError) {
    throw new Error(menuEntriesError.message)
  }

  const itemMap = new Map((items ?? []).map((item) => [item.id, item]))
  const menuMap = new Map((menuEntries ?? []).map((entry) => [entry.id, entry]))

  const fileMap = new Map<string, { pdf: MarketItemFile | null; hwp: MarketItemFile | null }>()
  for (const file of files ?? []) {
    const current = fileMap.get(file.item_id) ?? { pdf: null, hwp: null }
    if (file.asset_kind === 'pdf') {
      current.pdf = file
    }
    if (file.asset_kind === 'hwp') {
      current.hwp = file
    }
    fileMap.set(file.item_id, current)
  }

  const latestDownloadMap = new Map<string, string>()
  for (const event of downloads ?? []) {
    const key = `${event.item_id}:${event.asset_kind}`
    if (!latestDownloadMap.has(key)) {
      latestDownloadMap.set(key, event.created_at)
    }
  }

  const groupedPurchases = new Map<string, MarketPurchase[]>()
  for (const purchase of purchases) {
    const current = groupedPurchases.get(purchase.item_id) ?? []
    current.push(purchase)
    groupedPurchases.set(purchase.item_id, current)
  }

  return Array.from(groupedPurchases.entries())
    .map(([itemId, itemPurchases]) => {
      const item = itemMap.get(itemId)
      const menu = item ? menuMap.get(item.menu_entry_id) : null
      const assetFiles = fileMap.get(itemId) ?? { pdf: null, hwp: null }
      const pdfPurchase = itemPurchases.find((purchase) => purchase.asset_kind === 'pdf') ?? null
      const hwpPurchase = itemPurchases.find((purchase) => purchase.asset_kind === 'hwp') ?? null
      const purchasedAt = itemPurchases
        .map((purchase) => purchase.purchased_at)
        .sort((a, b) => b.localeCompare(a))[0]

      const lastDownloadedAt = [
        latestDownloadMap.get(`${itemId}:pdf`) ?? null,
        latestDownloadMap.get(`${itemId}:hwp`) ?? null,
      ]
        .filter((value): value is string => Boolean(value))
        .sort((a, b) => b.localeCompare(a))[0] ?? null

      return {
        itemId,
        categorySlug: menu?.slug ?? null,
        categoryTitle: menu?.title ?? '알 수 없는 카테고리',
        title: item?.title ?? '삭제되었거나 찾을 수 없는 상품',
        summary: item?.summary ?? null,
        purchasedAt,
        lastDownloadedAt,
        pdfOwned: pdfPurchase !== null,
        hwpOwned: hwpPurchase !== null,
        pdfPurchasedAt: pdfPurchase?.purchased_at ?? null,
        hwpPurchasedAt: hwpPurchase?.purchased_at ?? null,
        pdfDownloadUrl: pdfPurchase ? `/api/market/items/${itemId}/download?assetKind=pdf` : null,
        hwpDownloadUrl: hwpPurchase ? `/api/market/items/${itemId}/download?assetKind=hwp` : null,
        pdfAvailable: pdfPurchase !== null && assetFiles.pdf !== null,
        hwpAvailable: hwpPurchase !== null && assetFiles.hwp !== null,
        pdfFileName: assetFiles.pdf?.original_file_name ?? null,
        hwpFileName: assetFiles.hwp?.original_file_name ?? null,
      }
    })
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
}
