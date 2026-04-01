import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { Tables, TablesInsert, TablesUpdate } from '@/types/supabase'

type WithWorkspaceSubject = { workspace_subject: WorkspaceSubject }
type WithOptionalWorkspaceSubject = { workspace_subject?: WorkspaceSubject }

export type MarketMenuEntry = Tables<'market_menu_entries'> & WithWorkspaceSubject
export type MarketItem = Tables<'market_items'> & WithWorkspaceSubject
export type MarketItemFile = Tables<'market_item_files'> & WithWorkspaceSubject
export type MarketPurchase = Tables<'market_purchases'> & WithWorkspaceSubject
export type MarketDownloadEvent = Tables<'market_download_events'> & WithWorkspaceSubject
export type MarketItemViewEvent = Tables<'market_item_view_events'> & WithWorkspaceSubject

type MarketItemInsert = TablesInsert<'market_items'> & WithOptionalWorkspaceSubject
type MarketItemFileInsert = TablesInsert<'market_item_files'> & WithOptionalWorkspaceSubject
type MarketPurchaseInsert = TablesInsert<'market_purchases'> & WithOptionalWorkspaceSubject
type MarketDownloadEventInsert = TablesInsert<'market_download_events'> & WithOptionalWorkspaceSubject
type MarketItemViewEventInsert = TablesInsert<'market_item_view_events'> & WithOptionalWorkspaceSubject

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

export interface MarketListboardAssetRow {
  available: boolean
  owned: boolean
  price: number
  fileName: string | null
}

export interface MarketListboardRow {
  itemId: string
  title: string
  examYear: number | null
  examMonth: number | null
  gradeLevel: string | null
  viewCount: number
  publishedAt: string
  rowNumber: number
  pdf: MarketListboardAssetRow
  hwp: MarketListboardAssetRow
}

export interface MarketItemListFilters {
  search?: string
  assetKind?: 'pdf' | 'hwp' | 'sample' | 'all'
  gradeLevel?: string
  examYear?: number
  examMonth?: number
  sort?: 'latest' | 'views' | 'price_asc'
}

function normalizeWorkspaceSubject(value?: string | null): WorkspaceSubject {
  return value === 'korean' ? 'korean' : DEFAULT_WORKSPACE_SUBJECT
}

function withWorkspaceSubject<T extends object>(row: T | null): (T & WithWorkspaceSubject) | null {
  if (!row) {
    return null
  }

  return {
    ...row,
    workspace_subject: normalizeWorkspaceSubject((row as { workspace_subject?: string | null }).workspace_subject),
  }
}

function withWorkspaceSubjects<T extends object>(rows: T[] | null | undefined): Array<T & WithWorkspaceSubject> {
  return (rows ?? []).map((row) => ({
    ...row,
    workspace_subject: normalizeWorkspaceSubject((row as { workspace_subject?: string | null }).workspace_subject),
  }))
}

function applyWorkspaceSubjectFilter<T>(query: T, workspaceSubject?: WorkspaceSubject): T {
  if (!workspaceSubject) {
    return query
  }

  return (query as { eq: (column: string, value: WorkspaceSubject) => T }).eq('workspace_subject', workspaceSubject)
}

function assertMatchingWorkspaceSubject(
  label: string,
  expectedSubject: WorkspaceSubject,
  actualSubject: WorkspaceSubject
) {
  if (expectedSubject !== actualSubject) {
    throw new Error(`${label}의 작업 공간이 일치하지 않습니다.`)
  }
}

async function getMarketMenuEntryById(menuEntryId: string): Promise<MarketMenuEntry | null> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_menu_entries')
    .select('*')
    .eq('id', menuEntryId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function getVisibleMarketMenuEntryBySlugForWorkspace(
  slug: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
): Promise<MarketMenuEntry | null> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_menu_entries')
      .select('*')
      .eq('slug', slug)
      .is('deleted_at', null)
      .eq('is_visible', true)
      .eq('is_active', true),
    workspaceSubject
  )

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function getMarketItemFilterOptions(menuEntryId: string) {
  const supabase = getAdminSupabase()
  const menuEntry = await getMarketMenuEntryById(menuEntryId)
  if (!menuEntry) {
    return { years: [], months: [], grades: [] }
  }

  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_items')
      .select('exam_year, exam_month, grade_level')
      .eq('menu_entry_id', menuEntryId)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null),
    menuEntry.workspace_subject
  )

  const { data, error } = await query

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

export async function listMarketItemsForAdmin(menuEntryId?: string, workspaceSubject?: WorkspaceSubject): Promise<MarketItem[]> {
  const supabase = getAdminSupabase()
  const menuEntry = menuEntryId ? await getMarketMenuEntryById(menuEntryId) : null
  if (menuEntry && workspaceSubject) {
    assertMatchingWorkspaceSubject('문제마켓 카테고리', workspaceSubject, menuEntry.workspace_subject)
  }
  const activeWorkspaceSubject = menuEntry?.workspace_subject ?? workspaceSubject

  let query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_items')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    activeWorkspaceSubject
  )

  if (menuEntryId) {
    query = query.eq('menu_entry_id', menuEntryId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function listPublishedMarketItems(menuEntryId: string, filters: MarketItemListFilters = {}): Promise<MarketItem[]> {
  const supabase = getAdminSupabase()
  const menuEntry = await getMarketMenuEntryById(menuEntryId)

  if (!menuEntry) {
    return []
  }

  let query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_items')
      .select('*')
      .eq('menu_entry_id', menuEntryId)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null),
    menuEntry.workspace_subject
  )

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

  return withWorkspaceSubjects(data)
}

export async function listPublishedMarketListboardRows(
  menuEntryId: string,
  userId: string,
  filters: MarketItemListFilters = {}
): Promise<MarketListboardRow[]> {
  const supabase = getAdminSupabase()
  const menuEntry = await getMarketMenuEntryById(menuEntryId)
  if (!menuEntry) {
    return []
  }

  const items = await listPublishedMarketItems(menuEntryId, filters)

  if (items.length === 0) {
    return []
  }

  const itemIds = items.map((item) => item.id)
  const [{ data: files, error: filesError }, { data: purchases, error: purchasesError }] = await Promise.all([
    supabase
      .from('market_item_files')
      .select('item_id, asset_kind, original_file_name')
      .in('item_id', itemIds)
      .in('asset_kind', ['pdf', 'hwp'])
      .eq('is_active', true)
      .is('deleted_at', null)
      .eq('workspace_subject', menuEntry.workspace_subject),
    supabase
      .from('market_purchases')
      .select('item_id, asset_kind')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .in('item_id', itemIds)
      .in('asset_kind', ['pdf', 'hwp'])
      .eq('workspace_subject', menuEntry.workspace_subject),
  ])

  if (filesError) {
    throw new Error(filesError.message)
  }

  if (purchasesError) {
    throw new Error(purchasesError.message)
  }

  const fileMap = new Map<string, { pdf: string | null; hwp: string | null }>()
  for (const file of files ?? []) {
    const current = fileMap.get(file.item_id) ?? { pdf: null, hwp: null }
    if (file.asset_kind === 'pdf') current.pdf = file.original_file_name
    if (file.asset_kind === 'hwp') current.hwp = file.original_file_name
    fileMap.set(file.item_id, current)
  }

  const ownership = new Set((purchases ?? []).map((purchase) => `${purchase.item_id}:${purchase.asset_kind}`))

  return items.map((item, index) => {
    const filesForItem = fileMap.get(item.id) ?? { pdf: null, hwp: null }

    return {
      itemId: item.id,
      title: item.title,
      examYear: item.exam_year,
      examMonth: item.exam_month,
      gradeLevel: item.grade_level,
      viewCount: item.view_count,
      publishedAt: item.published_at ?? item.created_at,
      rowNumber: items.length - index,
      pdf: {
        available: filesForItem.pdf !== null && item.pdf_price > 0,
        owned: ownership.has(`${item.id}:pdf`),
        price: item.pdf_price,
        fileName: filesForItem.pdf,
      },
      hwp: {
        available: filesForItem.hwp !== null && item.hwp_price > 0,
        owned: ownership.has(`${item.id}:hwp`),
        price: item.hwp_price,
        fileName: filesForItem.hwp,
      },
    }
  })
}

export async function getMarketItemById(id: string, workspaceSubject?: WorkspaceSubject): Promise<MarketItem | null> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_items')
      .select('*')
      .eq('id', id),
    workspaceSubject
  )

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function getPublishedMarketItemById(id: string, workspaceSubject?: WorkspaceSubject): Promise<MarketItem | null> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_items')
      .select('*')
      .eq('id', id)
      .eq('status', 'published')
      .eq('is_active', true)
      .is('deleted_at', null),
    workspaceSubject
  )

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function listMarketItemFiles(
  itemId: string,
  includeInactive = false,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemFile[]> {
  const supabase = getAdminSupabase()

  let query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_item_files')
      .select('*')
      .eq('item_id', itemId)
      .order('asset_kind')
      .order('version', { ascending: false })
      .order('created_at', { ascending: false }),
    workspaceSubject
  )

  if (!includeInactive) {
    query = query.eq('is_active', true).is('deleted_at', null)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function getActiveMarketItemFile(
  itemId: string,
  assetKind: 'sample' | 'pdf' | 'hwp',
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemFile | null> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_item_files')
      .select('*')
      .eq('item_id', itemId)
      .eq('asset_kind', assetKind)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('version', { ascending: false }),
    workspaceSubject
  )

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function createMarketItem(
  input: Pick<TablesInsert<'market_items'>,
    'menu_entry_id' | 'title' | 'summary' | 'description' | 'thumbnail_url' | 'exam_year' | 'exam_month' |
    'grade_level' | 'source_type' | 'source_1' | 'source_2' | 'source_3' | 'source_4' |
    'pdf_price' | 'hwp_price' | 'sort_order' | 'status' | 'is_active' | 'published_at' | 'created_by' | 'updated_by'>
) {
  const supabase = getAdminSupabase()
  const normalized = validateMarketItemInput(input)
  const menuEntry = await getMarketMenuEntryById(input.menu_entry_id)

  if (!menuEntry) {
    throw new Error('연결할 문제마켓 카테고리를 찾을 수 없습니다.')
  }

  const payload: MarketItemInsert = {
    menu_entry_id: input.menu_entry_id,
    workspace_subject: menuEntry.workspace_subject,
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
    .insert(payload as TablesInsert<'market_items'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function updateMarketItem(
  id: string,
  input: Pick<TablesUpdate<'market_items'>,
    'title' | 'summary' | 'description' | 'thumbnail_url' | 'exam_year' | 'exam_month' |
    'grade_level' | 'source_type' | 'source_1' | 'source_2' | 'source_3' | 'source_4' | 'menu_entry_id' |
    'pdf_price' | 'hwp_price' | 'sort_order' | 'status' | 'is_active' | 'published_at' | 'updated_by'>
) {
  const supabase = getAdminSupabase()
  const current = await getMarketItemById(id)

  if (!current) {
    throw new Error('수정할 문제마켓 상품을 찾을 수 없습니다.')
  }

  let nextMenuEntryId = input.menu_entry_id ?? current.menu_entry_id
  let nextWorkspaceSubject = current.workspace_subject

  if (nextMenuEntryId !== current.menu_entry_id) {
    const nextMenuEntry = await getMarketMenuEntryById(nextMenuEntryId)
    if (!nextMenuEntry) {
      throw new Error('이동할 문제마켓 카테고리를 찾을 수 없습니다.')
    }

    assertMatchingWorkspaceSubject('문제마켓 카테고리', current.workspace_subject, nextMenuEntry.workspace_subject)
    nextWorkspaceSubject = nextMenuEntry.workspace_subject
    nextMenuEntryId = nextMenuEntry.id
  }

  const normalized = validateMarketItemInput({
    title: input.title ?? current.title,
    pdf_price: input.pdf_price ?? current.pdf_price,
    hwp_price: input.hwp_price ?? current.hwp_price,
  })

  const nextStatus = input.status ?? current.status

  const payload: MarketItemInsert = {
    menu_entry_id: nextMenuEntryId,
    workspace_subject: nextWorkspaceSubject,
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
    .update(payload as TablesUpdate<'market_items'>)
    .eq('id', id)
    .eq('workspace_subject', current.workspace_subject)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function archiveMarketItem(id: string, updatedBy?: string | null) {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(id)

  if (!item) {
    throw new Error('삭제할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_items')
    .update({
      status: 'archived',
      is_active: false,
      deleted_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    })
    .eq('id', id)
    .eq('workspace_subject', item.workspace_subject)

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
  const item = await getMarketItemById(itemId)
  if (!item) {
    throw new Error('파일을 연결할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const currentFiles = await listMarketItemFiles(itemId, true, item.workspace_subject)
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
    .eq('workspace_subject', item.workspace_subject)
    .eq('asset_kind', assetKind)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (deactivateError) {
    throw new Error(deactivateError.message)
  }

  const payload: MarketItemFileInsert = {
    item_id: itemId,
    workspace_subject: item.workspace_subject,
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
    .insert(payload as TablesInsert<'market_item_files'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function listUserMarketPurchases(
  userId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketPurchase[]> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_purchases')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    workspaceSubject
  )

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function listCompletedMarketPurchasesForUser(
  userId: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
): Promise<MarketPurchase[]> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_purchases')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('purchased_at', { ascending: false }),
    workspaceSubject
  )

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function findCompletedMarketPurchase(
  userId: string,
  itemId: string,
  assetKind: 'pdf' | 'hwp',
  workspaceSubject?: WorkspaceSubject
) {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_purchases')
      .select('*')
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .eq('asset_kind', assetKind)
      .eq('status', 'completed'),
    workspaceSubject
  )

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function listCompletedMarketPurchasesForItem(
  userId: string,
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketPurchase[]> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_purchases')
      .select('*')
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .eq('status', 'completed')
      .order('purchased_at', { ascending: false }),
    workspaceSubject
  )

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function createMarketPurchase(input: MarketPurchaseInsert): Promise<MarketPurchase> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(input.item_id)
  if (!item) {
    throw new Error('구매할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const workspaceSubject = input.workspace_subject ?? item.workspace_subject
  assertMatchingWorkspaceSubject('문제마켓 상품', workspaceSubject, item.workspace_subject)

  const payload: MarketPurchaseInsert = {
    ...input,
    workspace_subject: workspaceSubject,
  }

  const { data, error } = await supabase
    .from('market_purchases')
    .insert(payload as TablesInsert<'market_purchases'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function createMarketPurchases(inputs: MarketPurchaseInsert[]): Promise<MarketPurchase[]> {
  if (inputs.length === 0) {
    return []
  }

  const supabase = getAdminSupabase()
  const itemIds = Array.from(new Set(inputs.map((input) => input.item_id)))
  const { data: items, error: itemsError } = await supabase
    .from('market_items')
    .select('*')
    .in('id', itemIds)

  if (itemsError) {
    throw new Error(itemsError.message)
  }

  const itemMap = new Map(withWorkspaceSubjects(items).map((item) => [item.id, item]))
  const payloads = inputs.map((input) => {
    const item = itemMap.get(input.item_id)
    if (!item) {
      throw new Error('구매할 문제마켓 상품을 찾을 수 없습니다.')
    }

    const workspaceSubject = input.workspace_subject ?? item.workspace_subject
    assertMatchingWorkspaceSubject('문제마켓 상품', workspaceSubject, item.workspace_subject)

    return {
      ...input,
      workspace_subject: workspaceSubject,
    } as TablesInsert<'market_purchases'>
  })

  const { data, error } = await supabase
    .from('market_purchases')
    .insert(payloads)
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}


export async function recordMarketDownloadEvent(input: MarketDownloadEventInsert): Promise<MarketDownloadEvent> {
  const supabase = getAdminSupabase()
  const [item, file, purchase] = await Promise.all([
    getMarketItemById(input.item_id),
    getActiveMarketItemFile(input.item_id, input.asset_kind as 'sample' | 'pdf' | 'hwp'),
    input.purchase_id ? (
      supabase
        .from('market_purchases')
        .select('*')
        .eq('id', input.purchase_id)
        .maybeSingle()
    ) : Promise.resolve({ data: null, error: null }),
  ])

  if (!item) {
    throw new Error('다운로드할 문제마켓 상품을 찾을 수 없습니다.')
  }

  if (!file || file.id !== input.file_id) {
    throw new Error('다운로드할 파일 자산을 찾을 수 없습니다.')
  }

  const workspaceSubject = input.workspace_subject ?? item.workspace_subject
  assertMatchingWorkspaceSubject('문제마켓 상품', workspaceSubject, item.workspace_subject)
  assertMatchingWorkspaceSubject('문제마켓 파일', workspaceSubject, file.workspace_subject)

  if (purchase?.error) {
    throw new Error(purchase.error.message)
  }

  const purchaseRow = withWorkspaceSubject(purchase?.data ?? null)
  if (purchaseRow) {
    assertMatchingWorkspaceSubject('문제마켓 구매', workspaceSubject, purchaseRow.workspace_subject)
  }

  const payload: MarketDownloadEventInsert = {
    ...input,
    workspace_subject: workspaceSubject,
  }

  const { data, error } = await supabase
    .from('market_download_events')
    .insert(payload as TablesInsert<'market_download_events'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function recordMarketItemView(input: MarketItemViewEventInsert): Promise<MarketItemViewEvent> {
  const supabase = getAdminSupabase()
  const item = await getPublishedMarketItemById(input.item_id)
  if (!item) {
    throw new Error('조회할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const payload: MarketItemViewEventInsert = {
    ...input,
    workspace_subject: input.workspace_subject ?? item.workspace_subject,
  }

  const { data, error } = await supabase
    .from('market_item_view_events')
    .insert(payload as TablesInsert<'market_item_view_events'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function incrementMarketItemViewCount(itemId: string, workspaceSubject?: WorkspaceSubject): Promise<void> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)

  if (!item) {
    throw new Error('조회할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_items')
    .update({ view_count: item.view_count + 1 })
    .eq('id', itemId)
    .eq('workspace_subject', item.workspace_subject)

  if (error) {
    throw new Error(error.message)
  }
}

export async function listMarketLibraryRowsForUser(
  userId: string,
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
): Promise<MarketLibraryRow[]> {
  const supabase = getAdminSupabase()
  const purchases = await listCompletedMarketPurchasesForUser(userId, workspaceSubject)

  if (purchases.length === 0) {
    return []
  }

  const itemIds = Array.from(new Set(purchases.map((purchase) => purchase.item_id)))

  const [{ data: items, error: itemsError }, { data: files, error: filesError }, { data: downloads, error: downloadsError }] = await Promise.all([
    supabase
      .from('market_items')
      .select('*')
      .in('id', itemIds)
      .eq('workspace_subject', workspaceSubject),
    supabase
      .from('market_item_files')
      .select('*')
      .in('item_id', itemIds)
      .eq('workspace_subject', workspaceSubject)
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('market_download_events')
      .select('*')
      .eq('user_id', userId)
      .in('item_id', itemIds)
      .eq('workspace_subject', workspaceSubject)
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
    .eq('workspace_subject', workspaceSubject)

  if (menuEntriesError) {
    throw new Error(menuEntriesError.message)
  }

  const itemMap = new Map(withWorkspaceSubjects(items).map((item) => [item.id, item]))
  const menuMap = new Map(withWorkspaceSubjects(menuEntries).map((entry) => [entry.id, entry]))

  const fileMap = new Map<string, { pdf: MarketItemFile | null; hwp: MarketItemFile | null }>()
  for (const file of withWorkspaceSubjects(files)) {
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
