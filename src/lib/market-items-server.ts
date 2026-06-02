import { createAdminClient } from '@/lib/supabase/bypass'
import { listActiveMarketItemSamplePagesForItems } from '@/lib/market-sample-pages-server'
import { getMarketRefundEligibility } from '@/lib/market-refunds'
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
export type MarketSubproductCategory = Tables<'market_subproduct_categories'> & WithWorkspaceSubject
export type MarketFileType = Tables<'market_file_types'> & WithWorkspaceSubject
export type MarketItemSubproduct = Tables<'market_item_subproducts'> & WithWorkspaceSubject
export type MarketSubproductFile = Tables<'market_subproduct_files'> & WithWorkspaceSubject
export type MarketItemBundleOption = Tables<'market_item_bundle_options'> & WithWorkspaceSubject
export type MarketPurchaseOrder = Tables<'market_purchase_orders'> & WithWorkspaceSubject
export type MarketPurchaseLine = Tables<'market_purchase_lines'> & WithWorkspaceSubject
export type MarketEntitlement = Tables<'market_entitlements'> & WithWorkspaceSubject
export type MarketRefundRequest = Tables<'market_refund_requests'> & WithWorkspaceSubject

type MarketItemInsert = TablesInsert<'market_items'> & WithOptionalWorkspaceSubject
type MarketItemFileInsert = TablesInsert<'market_item_files'> & WithOptionalWorkspaceSubject
type MarketPurchaseInsert = TablesInsert<'market_purchases'> & WithOptionalWorkspaceSubject
type MarketDownloadEventInsert = TablesInsert<'market_download_events'> & WithOptionalWorkspaceSubject
type MarketItemViewEventInsert = TablesInsert<'market_item_view_events'> & WithOptionalWorkspaceSubject
type MarketSubproductCategoryInsert = TablesInsert<'market_subproduct_categories'> & WithOptionalWorkspaceSubject
type MarketSubproductCategoryUpdate = TablesUpdate<'market_subproduct_categories'> & WithOptionalWorkspaceSubject
type MarketFileTypeInsert = TablesInsert<'market_file_types'> & WithOptionalWorkspaceSubject
type MarketFileTypeUpdate = TablesUpdate<'market_file_types'> & WithOptionalWorkspaceSubject
type MarketItemSubproductInsert = TablesInsert<'market_item_subproducts'> & WithOptionalWorkspaceSubject
type MarketItemSubproductUpdate = TablesUpdate<'market_item_subproducts'> & WithOptionalWorkspaceSubject
type MarketSubproductFileInsert = TablesInsert<'market_subproduct_files'> & WithOptionalWorkspaceSubject
type MarketItemBundleOptionInsert = TablesInsert<'market_item_bundle_options'> & WithOptionalWorkspaceSubject
type MarketItemBundleOptionUpdate = TablesUpdate<'market_item_bundle_options'> & WithOptionalWorkspaceSubject
type MarketPurchaseOrderInsert = TablesInsert<'market_purchase_orders'> & WithOptionalWorkspaceSubject
type MarketPurchaseLineInsert = TablesInsert<'market_purchase_lines'> & WithOptionalWorkspaceSubject
type MarketEntitlementInsert = TablesInsert<'market_entitlements'> & WithOptionalWorkspaceSubject

export interface MarketLibraryRefundTarget {
  targetKind: 'legacy_purchase' | 'v2_order'
  targetId: string
  label: string
  requestedRefundCredits: number
  purchasedAt: string
  refundableUntil: string
  downloadCount: number
  status: 'available' | 'blocked' | 'pending' | 'approved' | 'rejected' | 'canceled' | 'failed'
  reason: string | null
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
  zipOwned: boolean
  pdfPurchasedAt: string | null
  hwpPurchasedAt: string | null
  zipPurchasedAt: string | null
  pdfDownloadUrl: string | null
  hwpDownloadUrl: string | null
  zipDownloadUrl: string | null
  pdfAvailable: boolean
  hwpAvailable: boolean
  zipAvailable: boolean
  pdfFileName: string | null
  hwpFileName: string | null
  zipFileName: string | null
  v2BundleOwned: boolean
  v2OwnedLabels: string[]
  v2DownloadFiles: MarketSubproductDownloadFile[]
  refundTargets: MarketLibraryRefundTarget[]
}

export interface MarketListboardAssetRow {
  available: boolean
  owned: boolean
  price: number
  fileName: string | null
}

export interface MarketListboardSampleRow {
  available: boolean
  fileName: string | null
  pageCount: number
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
  zip: MarketListboardAssetRow
  sample: MarketListboardSampleRow
}

export interface MarketSubproductPublicFileType {
  id: string
  code: string
  label: string
  extension: string
}

export interface MarketSubproductPublicSummary {
  id: string
  itemId: string
  categoryId: string
  categoryName: string
  categorySlug: string
  title: string
  description: string | null
  priceCredits: number
  sortOrder: number
  fileCount: number
  fileTypes: MarketSubproductPublicFileType[]
  owned: boolean
  purchasedAt: string | null
}

export interface MarketBundlePublicSummary {
  id: string
  itemId: string
  label: string
  description: string | null
  priceCredits: number
  owned: boolean
  purchasedAt: string | null
}

export interface MarketSubproductDownloadFile {
  id: string
  itemId: string
  subproductId: string
  subproductTitle: string
  fileTypeCode: string
  fileTypeLabel: string
  originalFileName: string
  downloadUrl: string
}

export interface MarketItemListFilters {
  search?: string
  assetKind?: 'pdf' | 'hwp' | 'zip' | 'sample' | 'all'
  gradeLevel?: string
  examYear?: number
  examMonth?: number
  sort?: 'latest' | 'views' | 'price_asc'
}

function normalizeWorkspaceSubject(value?: string | null): WorkspaceSubject {
  return value === 'korean' ? 'korean' : DEFAULT_WORKSPACE_SUBJECT
}

function getMarketAssetKindLabel(assetKind: string) {
  if (assetKind === 'pdf') return '문제(PDF)'
  if (assetKind === 'hwp') return '문제(HWP)'
  if (assetKind === 'zip') return 'ZIP'
  return assetKind
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

function resolveMarketSubproductDisplayTitle(categoryName?: string | null, fallbackTitle?: string | null) {
  return normalizeText(categoryName) || normalizeText(fallbackTitle) || '서브상품'
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
  zip_price?: number | null
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
  ensureNonNegativeInteger(input.zip_price ?? 0, 'ZIP 가격')

  return {
    title,
    pdfPrice: input.pdf_price ?? 0,
    hwpPrice: input.hwp_price ?? 0,
    zipPrice: input.zip_price ?? 0,
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

export async function listMarketSubproductCategoriesForAdmin(
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
): Promise<MarketSubproductCategory[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_subproduct_categories')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function createMarketSubproductCategory(input: {
  workspaceSubject: WorkspaceSubject
  name: string
  slug: string
  description?: string | null
  sortOrder?: number
  isActive?: boolean
}): Promise<MarketSubproductCategory> {
  const supabase = getAdminSupabase()
  const name = normalizeText(input.name)
  const slug = normalizeText(input.slug)

  if (!name || !slug) {
    throw new Error('서브상품 카테고리 이름과 슬러그를 입력해주세요.')
  }

  const payload: MarketSubproductCategoryInsert = {
    workspace_subject: input.workspaceSubject,
    name,
    slug,
    description: normalizeNullableText(input.description),
    sort_order: input.sortOrder ?? 0,
    is_active: input.isActive ?? true,
  }

  const { data, error } = await supabase
    .from('market_subproduct_categories')
    .insert(payload as TablesInsert<'market_subproduct_categories'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

async function getMarketSubproductCategoryById(
  id: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketSubproductCategory | null> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_subproduct_categories')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null),
    workspaceSubject
  )

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function updateMarketSubproductCategory(
  id: string,
  input: {
    workspaceSubject?: WorkspaceSubject
    name?: string | null
    slug?: string | null
    description?: string | null
    sortOrder?: number
    isActive?: boolean
  }
): Promise<MarketSubproductCategory> {
  const supabase = getAdminSupabase()
  const existing = await getMarketSubproductCategoryById(id, input.workspaceSubject)
  if (!existing) {
    throw new Error('수정할 서브상품 카테고리를 찾을 수 없습니다.')
  }

  const payload: MarketSubproductCategoryUpdate = {}
  if (input.name !== undefined) payload.name = normalizeText(input.name)
  if (input.slug !== undefined) payload.slug = normalizeText(input.slug)
  if (input.description !== undefined) payload.description = normalizeNullableText(input.description)
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder
  if (input.isActive !== undefined) payload.is_active = input.isActive

  const { data, error } = await supabase
    .from('market_subproduct_categories')
    .update(payload as TablesUpdate<'market_subproduct_categories'>)
    .eq('id', id)
    .eq('workspace_subject', existing.workspace_subject)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function deleteMarketSubproductCategory(
  id: string,
  workspaceSubject?: WorkspaceSubject
): Promise<void> {
  const supabase = getAdminSupabase()
  const existing = await getMarketSubproductCategoryById(id, workspaceSubject)
  if (!existing) {
    throw new Error('삭제할 서브상품 카테고리를 찾을 수 없습니다.')
  }

  const { data: referencedRows, error: referencedError } = await supabase
    .from('market_item_subproducts')
    .select('id')
    .eq('category_id', id)
    .eq('workspace_subject', existing.workspace_subject)
    .is('deleted_at', null)
    .limit(1)

  if (referencedError) {
    throw new Error(referencedError.message)
  }

  if ((referencedRows ?? []).length > 0) {
    throw new Error('사용 중인 서브상품 카테고리는 삭제할 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_subproduct_categories')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_subject', existing.workspace_subject)

  if (error) {
    throw new Error(error.message)
  }
}

export async function listMarketFileTypesForAdmin(
  workspaceSubject: WorkspaceSubject = DEFAULT_WORKSPACE_SUBJECT
): Promise<MarketFileType[]> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_file_types')
    .select('*')
    .eq('workspace_subject', workspaceSubject)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function createMarketFileType(input: {
  workspaceSubject: WorkspaceSubject
  code: string
  label: string
  extension: string
  mimeAllowlist?: string[]
  sortOrder?: number
  isActive?: boolean
}): Promise<MarketFileType> {
  const supabase = getAdminSupabase()
  const code = normalizeText(input.code).toLowerCase()
  const label = normalizeText(input.label)
  const extension = normalizeText(input.extension).toLowerCase()

  if (!code || !label || !extension) {
    throw new Error('파일 유형 코드, 라벨, 확장자를 입력해주세요.')
  }

  const payload: MarketFileTypeInsert = {
    workspace_subject: input.workspaceSubject,
    code,
    label,
    extension,
    mime_allowlist: input.mimeAllowlist ?? [],
    sort_order: input.sortOrder ?? 0,
    is_active: input.isActive ?? true,
  }

  const { data, error } = await supabase
    .from('market_file_types')
    .insert(payload as TablesInsert<'market_file_types'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function getMarketFileTypeById(id: string, workspaceSubject?: WorkspaceSubject): Promise<MarketFileType | null> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_file_types')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null),
    workspaceSubject
  )

  const { data, error } = await query.maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function updateMarketFileType(
  id: string,
  input: {
    workspaceSubject?: WorkspaceSubject
    code?: string | null
    label?: string | null
    extension?: string | null
    mimeAllowlist?: string[]
    sortOrder?: number
    isActive?: boolean
  }
): Promise<MarketFileType> {
  const supabase = getAdminSupabase()
  const existing = await getMarketFileTypeById(id, input.workspaceSubject)
  if (!existing) {
    throw new Error('수정할 파일 유형을 찾을 수 없습니다.')
  }

  const nextCode = input.code === undefined ? existing.code : normalizeText(input.code).toLowerCase()
  const nextExtension = input.extension === undefined ? existing.extension : normalizeText(input.extension).toLowerCase()
  const nextMimeAllowlist = input.mimeAllowlist === undefined ? existing.mime_allowlist : input.mimeAllowlist
  const identityChanged = nextCode !== existing.code ||
    nextExtension !== existing.extension ||
    JSON.stringify(nextMimeAllowlist) !== JSON.stringify(existing.mime_allowlist)

  if (identityChanged) {
    const { data: referencedRows, error: referencedError } = await supabase
      .from('market_subproduct_files')
      .select('id')
      .eq('file_type_id', id)
      .eq('workspace_subject', existing.workspace_subject)
      .is('deleted_at', null)
      .limit(1)

    if (referencedError) {
      throw new Error(referencedError.message)
    }

    if ((referencedRows ?? []).length > 0) {
      throw new Error('사용 중인 파일 유형의 code, extension, mime_allowlist는 변경할 수 없습니다.')
    }
  }

  const payload: MarketFileTypeUpdate = {}
  if (input.code !== undefined) payload.code = nextCode
  if (input.label !== undefined) payload.label = normalizeText(input.label)
  if (input.extension !== undefined) payload.extension = nextExtension
  if (input.mimeAllowlist !== undefined) payload.mime_allowlist = nextMimeAllowlist
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder
  if (input.isActive !== undefined) payload.is_active = input.isActive

  const { data, error } = await supabase
    .from('market_file_types')
    .update(payload as TablesUpdate<'market_file_types'>)
    .eq('id', id)
    .eq('workspace_subject', existing.workspace_subject)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function deleteMarketFileType(id: string, workspaceSubject?: WorkspaceSubject): Promise<void> {
  const supabase = getAdminSupabase()
  const existing = await getMarketFileTypeById(id, workspaceSubject)
  if (!existing) {
    throw new Error('삭제할 파일 유형을 찾을 수 없습니다.')
  }

  const { data: referencedRows, error: referencedError } = await supabase
    .from('market_subproduct_files')
    .select('id')
    .eq('file_type_id', id)
    .eq('workspace_subject', existing.workspace_subject)
    .is('deleted_at', null)
    .limit(1)

  if (referencedError) {
    throw new Error(referencedError.message)
  }

  if ((referencedRows ?? []).length > 0) {
    throw new Error('사용 중인 파일 유형은 삭제할 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_file_types')
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_subject', existing.workspace_subject)

  if (error) {
    throw new Error(error.message)
  }
}

export async function listMarketItemSubproductsForAdmin(
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemSubproduct[]> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  const { data, error } = await supabase
    .from('market_item_subproducts')
    .select('*')
    .eq('item_id', itemId)
    .eq('workspace_subject', item.workspace_subject)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function getMarketItemSubproductById(
  itemId: string,
  subproductId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemSubproduct | null> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  const { data, error } = await supabase
    .from('market_item_subproducts')
    .select('*')
    .eq('id', subproductId)
    .eq('item_id', itemId)
    .eq('workspace_subject', item.workspace_subject)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function createMarketItemSubproduct(input: {
  itemId: string
  workspaceSubject?: WorkspaceSubject
  categoryId: string
  description?: string | null
  priceCredits?: number
  sortOrder?: number
  isActive?: boolean
}): Promise<MarketItemSubproduct> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(input.itemId, input.workspaceSubject)
  if (!item) {
    throw new Error('서브상품을 연결할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const category = await getMarketSubproductCategoryById(input.categoryId, item.workspace_subject)
  if (!category) {
    throw new Error('서브상품 카테고리를 찾을 수 없습니다.')
  }
  assertMatchingWorkspaceSubject('서브상품 카테고리', item.workspace_subject, category.workspace_subject)

  ensureNonNegativeInteger(input.priceCredits ?? 0, '서브상품 가격')

  const payload: MarketItemSubproductInsert = {
    item_id: item.id,
    workspace_subject: item.workspace_subject,
    category_id: category.id,
    title: category.name,
    description: normalizeNullableText(input.description),
    price_credits: input.priceCredits ?? 0,
    sort_order: input.sortOrder ?? 0,
    is_active: input.isActive ?? true,
  }

  const { data, error } = await supabase
    .from('market_item_subproducts')
    .insert(payload as TablesInsert<'market_item_subproducts'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function updateMarketItemSubproduct(
  itemId: string,
  subproductId: string,
  input: {
    workspaceSubject?: WorkspaceSubject
    categoryId?: string
    description?: string | null
    priceCredits?: number
    sortOrder?: number
    isActive?: boolean
  }
): Promise<MarketItemSubproduct> {
  const supabase = getAdminSupabase()
  const existing = await getMarketItemSubproductById(itemId, subproductId, input.workspaceSubject)
  if (!existing) {
    throw new Error('수정할 서브상품을 찾을 수 없습니다.')
  }

  const payload: MarketItemSubproductUpdate = {}
  if (input.categoryId !== undefined) {
    const category = await getMarketSubproductCategoryById(input.categoryId, existing.workspace_subject)
    if (!category) {
      throw new Error('서브상품 카테고리를 찾을 수 없습니다.')
    }
    assertMatchingWorkspaceSubject('서브상품 카테고리', existing.workspace_subject, category.workspace_subject)
    payload.category_id = category.id
    payload.title = category.name
  }
  if (input.description !== undefined) payload.description = normalizeNullableText(input.description)
  if (input.priceCredits !== undefined) {
    ensureNonNegativeInteger(input.priceCredits, '서브상품 가격')
    payload.price_credits = input.priceCredits
  }
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder
  if (input.isActive !== undefined) payload.is_active = input.isActive

  const { data, error } = await supabase
    .from('market_item_subproducts')
    .update(payload as TablesUpdate<'market_item_subproducts'>)
    .eq('id', subproductId)
    .eq('item_id', itemId)
    .eq('workspace_subject', existing.workspace_subject)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function deleteMarketItemSubproduct(
  itemId: string,
  subproductId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<void> {
  const supabase = getAdminSupabase()
  const existing = await getMarketItemSubproductById(itemId, subproductId, workspaceSubject)
  if (!existing) {
    throw new Error('삭제할 서브상품을 찾을 수 없습니다.')
  }

  const now = new Date().toISOString()
  const { error: fileError } = await supabase
    .from('market_subproduct_files')
    .update({ is_active: false, deleted_at: now } as TablesUpdate<'market_subproduct_files'>)
    .eq('item_id', itemId)
    .eq('subproduct_id', subproductId)
    .eq('workspace_subject', existing.workspace_subject)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (fileError) {
    throw new Error(fileError.message)
  }

  const { error } = await supabase
    .from('market_item_subproducts')
    .update({ is_active: false, deleted_at: now } as TablesUpdate<'market_item_subproducts'>)
    .eq('id', subproductId)
    .eq('item_id', itemId)
    .eq('workspace_subject', existing.workspace_subject)

  if (error) {
    throw new Error(error.message)
  }
}

export async function listMarketSubproductFilesForAdmin(
  itemId: string,
  subproductId?: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketSubproductFile[]> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  let query = supabase
    .from('market_subproduct_files')
    .select('*')
    .eq('item_id', itemId)
    .eq('workspace_subject', item.workspace_subject)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (subproductId) {
    query = query.eq('subproduct_id', subproductId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function replaceMarketSubproductFile(
  itemId: string,
  subproductId: string,
  fileTypeId: string,
  input: Pick<TablesInsert<'market_subproduct_files'>,
    'storage_bucket' | 'storage_path' | 'original_file_name' | 'content_type' | 'file_size_bytes' | 'checksum' | 'sort_order' | 'created_by'>
): Promise<MarketSubproductFile> {
  const supabase = getAdminSupabase()
  const subproduct = await getMarketItemSubproductById(itemId, subproductId)
  if (!subproduct) {
    throw new Error('파일을 연결할 서브상품을 찾을 수 없습니다.')
  }

  const fileType = await getMarketFileTypeById(fileTypeId, subproduct.workspace_subject)
  if (!fileType) {
    throw new Error('파일 유형을 찾을 수 없습니다.')
  }
  assertMatchingWorkspaceSubject('파일 유형', subproduct.workspace_subject, fileType.workspace_subject)

  const currentFiles = await listMarketSubproductFilesForAdmin(itemId, subproductId, subproduct.workspace_subject)
  const previousVersion = currentFiles
    .filter((file) => file.file_type_id === fileTypeId)
    .reduce((maxVersion, file) => Math.max(maxVersion, file.version), 0)

  const { error: deactivateError } = await supabase
    .from('market_subproduct_files')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
    } as TablesUpdate<'market_subproduct_files'>)
    .eq('item_id', itemId)
    .eq('subproduct_id', subproductId)
    .eq('file_type_id', fileTypeId)
    .eq('workspace_subject', subproduct.workspace_subject)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (deactivateError) {
    throw new Error(deactivateError.message)
  }

  const payload: MarketSubproductFileInsert = {
    item_id: itemId,
    subproduct_id: subproductId,
    workspace_subject: subproduct.workspace_subject,
    file_type_id: fileTypeId,
    storage_bucket: input.storage_bucket,
    storage_path: input.storage_path,
    original_file_name: input.original_file_name,
    content_type: normalizeNullableText(input.content_type),
    file_size_bytes: input.file_size_bytes ?? null,
    checksum: normalizeNullableText(input.checksum),
    version: previousVersion + 1,
    sort_order: input.sort_order ?? 0,
    is_active: true,
    created_by: input.created_by ?? null,
  }

  const { data, error } = await supabase
    .from('market_subproduct_files')
    .insert(payload as TablesInsert<'market_subproduct_files'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function deleteMarketSubproductFile(
  itemId: string,
  subproductId: string,
  fileId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<void> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  const { data: file, error: fileError } = await supabase
    .from('market_subproduct_files')
    .select('*')
    .eq('id', fileId)
    .eq('item_id', itemId)
    .eq('subproduct_id', subproductId)
    .eq('workspace_subject', item.workspace_subject)
    .is('deleted_at', null)
    .maybeSingle()

  if (fileError) {
    throw new Error(fileError.message)
  }

  if (!file) {
    throw new Error('삭제할 서브상품 파일을 찾을 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_subproduct_files')
    .update({ is_active: false, deleted_at: new Date().toISOString() } as TablesUpdate<'market_subproduct_files'>)
    .eq('id', fileId)
    .eq('workspace_subject', item.workspace_subject)

  if (error) {
    throw new Error(error.message)
  }
}

export async function getMarketItemBundleOptionForAdmin(
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemBundleOption | null> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  const { data, error } = await supabase
    .from('market_item_bundle_options')
    .select('*')
    .eq('item_id', itemId)
    .eq('workspace_subject', item.workspace_subject)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function upsertMarketItemBundleOption(
  itemId: string,
  input: {
    workspaceSubject?: WorkspaceSubject
    label?: string | null
    description?: string | null
    priceCredits?: number
    isActive?: boolean
  }
): Promise<MarketItemBundleOption> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, input.workspaceSubject)
  if (!item) {
    throw new Error('전체구매 옵션을 연결할 문제마켓 상품을 찾을 수 없습니다.')
  }

  ensureNonNegativeInteger(input.priceCredits ?? 0, '전체구매 가격')
  const existing = await getMarketItemBundleOptionForAdmin(itemId, item.workspace_subject)
  const payload: MarketItemBundleOptionInsert | MarketItemBundleOptionUpdate = {
    item_id: item.id,
    workspace_subject: item.workspace_subject,
    label: normalizeText(input.label) || '전체 한번에 구매하기',
    description: normalizeNullableText(input.description),
    price_credits: input.priceCredits ?? 0,
    is_active: input.isActive ?? true,
  }

  if (existing) {
    const { data, error } = await supabase
      .from('market_item_bundle_options')
      .update(payload as TablesUpdate<'market_item_bundle_options'>)
      .eq('id', existing.id)
      .eq('workspace_subject', item.workspace_subject)
      .select('*')
      .single()

    if (error) {
      throw new Error(error.message)
    }

    return withWorkspaceSubject(data)!
  }

  const { data, error } = await supabase
    .from('market_item_bundle_options')
    .insert(payload as TablesInsert<'market_item_bundle_options'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function disableMarketItemBundleOption(
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<void> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  const { error } = await supabase
    .from('market_item_bundle_options')
    .update({ is_active: false } as TablesUpdate<'market_item_bundle_options'>)
    .eq('item_id', itemId)
    .eq('workspace_subject', item.workspace_subject)
    .eq('is_active', true)

  if (error) {
    throw new Error(error.message)
  }
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

  if (filters.assetKind === 'zip') {
    query = query.gt('zip_price', 0)
  }

  if (filters.sort === 'views') {
    query = query.order('view_count', { ascending: false }).order('published_at', { ascending: false })
  } else if (filters.sort === 'price_asc') {
    query = query.order('pdf_price', { ascending: true }).order('hwp_price', { ascending: true }).order('zip_price', { ascending: true })
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
  userId: string | null | undefined,
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
  const [{ data: files, error: filesError }, { data: purchases, error: purchasesError }, samplePageMap] = await Promise.all([
    supabase
      .from('market_item_files')
      .select('item_id, asset_kind, original_file_name')
      .in('item_id', itemIds)
      .in('asset_kind', ['pdf', 'hwp', 'zip'])
      .eq('is_active', true)
      .is('deleted_at', null)
      .eq('workspace_subject', menuEntry.workspace_subject),
    userId
      ? supabase
        .from('market_purchases')
        .select('item_id, asset_kind')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .in('item_id', itemIds)
        .in('asset_kind', ['pdf', 'hwp', 'zip'])
        .eq('workspace_subject', menuEntry.workspace_subject)
      : Promise.resolve({ data: [], error: null }),
    listActiveMarketItemSamplePagesForItems(itemIds, menuEntry.workspace_subject),
  ])

  if (filesError) {
    throw new Error(filesError.message)
  }

  if (purchasesError) {
    throw new Error(purchasesError.message)
  }

  const fileMap = new Map<string, { pdf: string | null; hwp: string | null; zip: string | null }>()
  for (const file of files ?? []) {
    const current = fileMap.get(file.item_id) ?? { pdf: null, hwp: null, zip: null }
    if (file.asset_kind === 'pdf') current.pdf = file.original_file_name
    if (file.asset_kind === 'hwp') current.hwp = file.original_file_name
    if (file.asset_kind === 'zip') current.zip = file.original_file_name
    fileMap.set(file.item_id, current)
  }

  const ownership = new Set((purchases ?? []).map((purchase) => `${purchase.item_id}:${purchase.asset_kind}`))

  return items.map((item, index) => {
    const filesForItem = fileMap.get(item.id) ?? { pdf: null, hwp: null, zip: null }
    const samplePages = samplePageMap.get(item.id) ?? []
    const pdfOwned = ownership.has(`${item.id}:pdf`)
    const zipOwned = ownership.has(`${item.id}:zip`)

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
        owned: pdfOwned,
        price: item.pdf_price,
        fileName: filesForItem.pdf,
      },
      hwp: {
        available: filesForItem.hwp !== null && item.hwp_price > 0,
        owned: ownership.has(`${item.id}:hwp`),
        price: item.hwp_price,
        fileName: filesForItem.hwp,
      },
      zip: {
        available: filesForItem.zip !== null && item.zip_price > 0,
        owned: zipOwned,
        price: item.zip_price,
        fileName: filesForItem.zip,
      },
      sample: {
        available: samplePages.length > 0,
        fileName: samplePages[0]?.original_file_name ?? null,
        pageCount: samplePages.length,
      },
    }
  }).filter((row) => filters.assetKind === 'sample' ? row.sample.available : true)
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
  assetKind: 'sample' | 'pdf' | 'hwp' | 'zip',
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

export async function listMarketSubproductPublicSummaries(
  itemId: string,
  userId?: string | null,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketSubproductPublicSummary[]> {
  const supabase = getAdminSupabase()
  const subproductQuery = applyWorkspaceSubjectFilter(
    supabase
      .from('market_item_subproducts')
      .select('id, item_id, category_id, title, description, price_credits, sort_order')
      .eq('item_id', itemId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    workspaceSubject
  )

  const { data: subproducts, error: subproductError } = await subproductQuery
  if (subproductError) {
    throw new Error(subproductError.message)
  }

  if (!subproducts || subproducts.length === 0) {
    return []
  }

  const subproductIds = subproducts.map((subproduct) => subproduct.id)
  const categoryIds = Array.from(new Set(subproducts.map((subproduct) => subproduct.category_id)))
  const [
    { data: categories, error: categoryError },
    { data: files, error: fileError },
    { data: entitlements, error: entitlementError },
  ] = await Promise.all([
    supabase
      .from('market_subproduct_categories')
      .select('id, name, slug')
      .in('id', categoryIds),
    applyWorkspaceSubjectFilter(
      supabase
        .from('market_subproduct_files')
        .select('id, subproduct_id, file_type_id')
        .in('subproduct_id', subproductIds)
        .eq('is_active', true)
        .is('deleted_at', null),
      workspaceSubject
    ),
    userId
      ? applyWorkspaceSubjectFilter(
        supabase
          .from('market_entitlements')
          .select('scope, subproduct_id, created_at')
          .eq('item_id', itemId)
          .eq('user_id', userId)
          .eq('status', 'active')
          .in('scope', ['item', 'subproduct']),
        workspaceSubject
      )
      : Promise.resolve({ data: [], error: null }),
  ])

  if (categoryError) {
    throw new Error(categoryError.message)
  }

  if (fileError) {
    throw new Error(fileError.message)
  }

  if (entitlementError) {
    throw new Error(entitlementError.message)
  }

  const fileTypeIds = Array.from(new Set((files ?? []).map((file) => file.file_type_id)))
  const { data: fileTypes, error: fileTypeError } = fileTypeIds.length > 0
    ? await supabase
      .from('market_file_types')
      .select('id, code, label, extension')
      .in('id', fileTypeIds)
    : { data: [], error: null }

  if (fileTypeError) {
    throw new Error(fileTypeError.message)
  }

  const categoryMap = new Map((categories ?? []).map((category) => [category.id, category]))
  const fileTypeMap = new Map((fileTypes ?? []).map((fileType) => [fileType.id, fileType]))
  const entitlementRows = entitlements ?? []
  const itemEntitlement = entitlementRows.find((entitlement) => entitlement.scope === 'item') ?? null
  const subproductEntitlementMap = new Map(
    entitlementRows
      .filter((entitlement) => entitlement.scope === 'subproduct' && entitlement.subproduct_id)
      .map((entitlement) => [entitlement.subproduct_id!, entitlement.created_at])
  )

  const filesBySubproduct = new Map<string, Array<{ id: string; subproduct_id: string; file_type_id: string }>>()
  for (const file of files ?? []) {
    const current = filesBySubproduct.get(file.subproduct_id) ?? []
    current.push(file)
    filesBySubproduct.set(file.subproduct_id, current)
  }

  return subproducts.map((subproduct) => {
    const category = categoryMap.get(subproduct.category_id)
    const fileRows = filesBySubproduct.get(subproduct.id) ?? []
    const fileTypesForSubproduct = fileRows
      .map((file) => fileTypeMap.get(file.file_type_id))
      .filter((fileType): fileType is NonNullable<typeof fileType> => Boolean(fileType))
      .sort((a, b) => a.code.localeCompare(b.code))
    const purchasedAt = itemEntitlement?.created_at ?? subproductEntitlementMap.get(subproduct.id) ?? null

    return {
      id: subproduct.id,
      itemId: subproduct.item_id,
      categoryId: subproduct.category_id,
      categoryName: category?.name ?? '분류 없음',
      categorySlug: category?.slug ?? 'uncategorized',
      title: resolveMarketSubproductDisplayTitle(category?.name, subproduct.title),
      description: subproduct.description,
      priceCredits: subproduct.price_credits,
      sortOrder: subproduct.sort_order,
      fileCount: fileRows.length,
      fileTypes: fileTypesForSubproduct.map((fileType) => ({
        id: fileType.id,
        code: fileType.code,
        label: fileType.label,
        extension: fileType.extension,
      })),
      owned: purchasedAt !== null,
      purchasedAt,
    }
  })
}

export async function getMarketBundlePublicSummary(
  itemId: string,
  userId?: string | null,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketBundlePublicSummary | null> {
  const supabase = getAdminSupabase()
  const bundleQuery = applyWorkspaceSubjectFilter(
    supabase
      .from('market_item_bundle_options')
      .select('id, item_id, label, description, price_credits')
      .eq('item_id', itemId)
      .eq('is_active', true)
      .maybeSingle(),
    workspaceSubject
  )

  const { data: bundle, error: bundleError } = await bundleQuery
  if (bundleError) {
    throw new Error(bundleError.message)
  }

  if (!bundle) {
    return null
  }

  const { data: entitlements, error: entitlementError } = userId
    ? await applyWorkspaceSubjectFilter(
      supabase
        .from('market_entitlements')
        .select('created_at')
        .eq('item_id', itemId)
        .eq('user_id', userId)
        .eq('scope', 'item')
        .eq('status', 'active'),
      workspaceSubject
    )
    : { data: [], error: null }

  if (entitlementError) {
    throw new Error(entitlementError.message)
  }

  const purchasedAt = entitlements?.[0]?.created_at ?? null

  return {
    id: bundle.id,
    itemId: bundle.item_id,
    label: bundle.label,
    description: bundle.description,
    priceCredits: bundle.price_credits,
    owned: purchasedAt !== null,
    purchasedAt,
  }
}

export async function getMarketSubproductPurchaseContext(
  itemId: string,
  subproductId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<{ item: MarketItem; subproduct: MarketItemSubproduct; files: MarketSubproductFile[] }> {
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item || item.deleted_at !== null || item.is_active === false || item.status !== 'published') {
    throw new Error('구매 가능한 문제마켓 상품을 찾을 수 없습니다.')
  }

  const subproduct = await getMarketItemSubproductById(itemId, subproductId, item.workspace_subject)
  if (!subproduct || subproduct.is_active === false || subproduct.deleted_at !== null) {
    throw new Error('구매 가능한 서브상품을 찾을 수 없습니다.')
  }

  const files = (await listMarketSubproductFilesForAdmin(itemId, subproductId, item.workspace_subject))
    .filter((file) => file.is_active && file.deleted_at === null)

  if (files.length === 0) {
    throw new Error('서브상품에 다운로드 가능한 파일이 없습니다.')
  }

  if (subproduct.price_credits <= 0) {
    throw new Error('유효한 서브상품 가격이 설정되지 않았습니다.')
  }

  return { item, subproduct, files }
}

export async function getMarketBundlePurchaseContext(
  itemId: string,
  bundleOptionId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<{ item: MarketItem; bundleOption: MarketItemBundleOption; files: MarketSubproductFile[] }> {
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item || item.deleted_at !== null || item.is_active === false || item.status !== 'published') {
    throw new Error('구매 가능한 문제마켓 상품을 찾을 수 없습니다.')
  }

  const supabase = getAdminSupabase()
  const { data: bundleOption, error: bundleError } = await supabase
    .from('market_item_bundle_options')
    .select('*')
    .eq('id', bundleOptionId)
    .eq('item_id', itemId)
    .eq('workspace_subject', item.workspace_subject)
    .eq('is_active', true)
    .maybeSingle()

  if (bundleError) {
    throw new Error(bundleError.message)
  }

  if (!bundleOption) {
    throw new Error('구매 가능한 전체구매 옵션을 찾을 수 없습니다.')
  }

  const files = (await listMarketSubproductFilesForAdmin(itemId, undefined, item.workspace_subject))
    .filter((file) => file.is_active && file.deleted_at === null)

  if (files.length === 0) {
    throw new Error('전체구매에 포함할 다운로드 파일이 없습니다.')
  }

  if (bundleOption.price_credits <= 0) {
    throw new Error('유효한 전체구매 가격이 설정되지 않았습니다.')
  }

  return { item, bundleOption: withWorkspaceSubject(bundleOption)!, files }
}

export async function findCompletedMarketV2OrderByIdempotencyKey(
  userId: string,
  idempotencyKey: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketPurchaseOrder | null> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_purchase_orders')
      .select('*')
      .eq('user_id', userId)
      .eq('idempotency_key', idempotencyKey)
      .eq('status', 'completed')
      .maybeSingle(),
    workspaceSubject
  )

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function listMarketV2EntitlementsForItem(
  userId: string,
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketEntitlement[]> {
  const supabase = getAdminSupabase()
  const query = applyWorkspaceSubjectFilter(
    supabase
      .from('market_entitlements')
      .select('id, workspace_subject, user_id, item_id, scope, subproduct_id, file_id, legacy_asset_kind, source_order_id, source_purchase_id, status, created_at, updated_at')
      .eq('user_id', userId)
      .eq('item_id', itemId)
      .eq('status', 'active'),
    workspaceSubject
  )

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function createMarketPurchaseOrder(input: MarketPurchaseOrderInsert): Promise<MarketPurchaseOrder> {
  const supabase = getAdminSupabase()
  const payload: MarketPurchaseOrderInsert = {
    ...input,
    credit_consumptions: input.credit_consumptions ?? null,
  }
  const { data, error } = await supabase
    .from('market_purchase_orders')
    .insert(payload as TablesInsert<'market_purchase_orders'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function createMarketPurchaseLine(input: MarketPurchaseLineInsert): Promise<MarketPurchaseLine> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_purchase_lines')
    .insert(input as TablesInsert<'market_purchase_lines'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function createMarketEntitlement(input: MarketEntitlementInsert): Promise<MarketEntitlement> {
  const supabase = getAdminSupabase()
  const { data, error } = await supabase
    .from('market_entitlements')
    .insert(input as TablesInsert<'market_entitlements'>)
    .select('*')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)!
}

export async function rollbackMarketV2PurchaseArtifacts(orderId: string, workspaceSubject: WorkspaceSubject): Promise<void> {
  const supabase = getAdminSupabase()
  await supabase.from('market_entitlements').delete().eq('source_order_id', orderId).eq('workspace_subject', workspaceSubject)
  await supabase.from('market_purchase_lines').delete().eq('order_id', orderId).eq('workspace_subject', workspaceSubject)
  await supabase.from('market_purchase_orders').delete().eq('id', orderId).eq('workspace_subject', workspaceSubject)
}

export async function getActiveMarketSubproductFileForDownload(
  itemId: string,
  fileId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<(MarketSubproductFile & { subproduct_title: string; file_type_code: string; file_type_label: string }) | null> {
  const supabase = getAdminSupabase()
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item || item.deleted_at !== null || item.is_active === false || item.status !== 'published') {
    return null
  }

  const { data: file, error: fileError } = await supabase
    .from('market_subproduct_files')
    .select('*')
    .eq('id', fileId)
    .eq('item_id', itemId)
    .eq('workspace_subject', item.workspace_subject)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle()

  if (fileError) {
    throw new Error(fileError.message)
  }

  if (!file) {
    return null
  }

  const [{ data: subproduct, error: subproductError }, { data: fileType, error: fileTypeError }] = await Promise.all([
    supabase
      .from('market_item_subproducts')
      .select('id, title, is_active, deleted_at')
      .eq('id', file.subproduct_id)
      .eq('item_id', itemId)
      .eq('workspace_subject', item.workspace_subject)
      .maybeSingle(),
    supabase
      .from('market_file_types')
      .select('id, code, label')
      .eq('id', file.file_type_id)
      .eq('workspace_subject', item.workspace_subject)
      .maybeSingle(),
  ])

  if (subproductError) {
    throw new Error(subproductError.message)
  }

  if (fileTypeError) {
    throw new Error(fileTypeError.message)
  }

  if (!subproduct || subproduct.is_active === false || subproduct.deleted_at !== null || !fileType) {
    return null
  }

  return {
    ...withWorkspaceSubject(file)!,
    subproduct_title: subproduct.title,
    file_type_code: fileType.code,
    file_type_label: fileType.label,
  }
}

export async function listMarketSubproductDownloadFilesForUser(
  userId: string,
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketSubproductDownloadFile[]> {
  const supabase = getAdminSupabase()
  const entitlements = await listMarketV2EntitlementsForItem(userId, itemId, workspaceSubject)
  if (entitlements.length === 0) {
    return []
  }

  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item) {
    return []
  }

  const files = (await listMarketSubproductFilesForAdmin(itemId, undefined, item.workspace_subject))
    .filter((file) => file.is_active && file.deleted_at === null)

  if (files.length === 0) {
    return []
  }

  const [subproductResult, fileTypeResult] = await Promise.all([
    supabase
      .from('market_item_subproducts')
      .select('id, title, category_id')
      .in('id', Array.from(new Set(files.map((file) => file.subproduct_id))))
      .eq('workspace_subject', item.workspace_subject),
    supabase
      .from('market_file_types')
      .select('id, code, label')
      .in('id', Array.from(new Set(files.map((file) => file.file_type_id))))
      .eq('workspace_subject', item.workspace_subject),
  ])

  if (subproductResult.error) {
    throw new Error(subproductResult.error.message)
  }

  if (fileTypeResult.error) {
    throw new Error(fileTypeResult.error.message)
  }

  const categoryIds = Array.from(new Set((subproductResult.data ?? []).map((subproduct) => subproduct.category_id)))
  const categoryResult = categoryIds.length > 0
    ? await supabase
      .from('market_subproduct_categories')
      .select('id, name')
      .in('id', categoryIds)
      .eq('workspace_subject', item.workspace_subject)
    : { data: [], error: null }

  if (categoryResult.error) {
    throw new Error(categoryResult.error.message)
  }

  const categoryMap = new Map((categoryResult.data ?? []).map((category) => [category.id, category.name]))
  const subproductMap = new Map((subproductResult.data ?? []).map((subproduct) => [
    subproduct.id,
    resolveMarketSubproductDisplayTitle(categoryMap.get(subproduct.category_id), subproduct.title),
  ]))
  const fileTypeMap = new Map((fileTypeResult.data ?? []).map((fileType) => [fileType.id, fileType]))

  return files
    .filter((file) => entitlements.some((entitlement) => (
      entitlement.scope === 'item' ||
      (entitlement.scope === 'subproduct' && entitlement.subproduct_id === file.subproduct_id) ||
      (entitlement.scope === 'file' && entitlement.file_id === file.id)
    )))
    .map((file) => {
      const fileType = fileTypeMap.get(file.file_type_id)
      return {
        id: file.id,
        itemId: file.item_id,
        subproductId: file.subproduct_id,
        subproductTitle: subproductMap.get(file.subproduct_id) ?? '서브상품',
        fileTypeCode: fileType?.code ?? 'file',
        fileTypeLabel: fileType?.label ?? '파일',
        originalFileName: file.original_file_name,
        downloadUrl: `/api/market/items/${file.item_id}/download?fileId=${file.id}`,
      }
    })
}

export async function createMarketItem(
  input: Pick<TablesInsert<'market_items'>,
    'menu_entry_id' | 'title' | 'summary' | 'description' | 'thumbnail_url' | 'exam_year' | 'exam_month' |
    'grade_level' | 'source_type' | 'source_1' | 'source_2' | 'source_3' | 'source_4' | 'question_count' |
    'pdf_price' | 'hwp_price' | 'zip_price' | 'sort_order' | 'status' | 'is_active' | 'published_at' | 'draft_source' | 'created_by' | 'updated_by'>
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
    question_count: input.question_count ?? null,
    pdf_price: normalized.pdfPrice,
    hwp_price: normalized.hwpPrice,
    zip_price: normalized.zipPrice,
    sort_order: input.sort_order ?? 0,
    status: input.status ?? 'draft',
    draft_source: input.draft_source ?? 'manual',
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
    'grade_level' | 'source_type' | 'source_1' | 'source_2' | 'source_3' | 'source_4' | 'question_count' | 'menu_entry_id' |
    'pdf_price' | 'hwp_price' | 'zip_price' | 'sort_order' | 'status' | 'is_active' | 'published_at' | 'draft_source' | 'updated_by'>
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
    zip_price: input.zip_price ?? current.zip_price,
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
    question_count: input.question_count === undefined ? current.question_count : input.question_count,
    pdf_price: normalized.pdfPrice,
    hwp_price: normalized.hwpPrice,
    zip_price: normalized.zipPrice,
    sort_order: input.sort_order ?? current.sort_order,
    status: nextStatus,
    draft_source: input.draft_source ?? current.draft_source,
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
  assetKind: 'sample' | 'pdf' | 'hwp' | 'zip',
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
  assetKind: 'pdf' | 'hwp' | 'zip',
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
    credit_consumptions: input.credit_consumptions ?? null,
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


export async function rollbackMarketPurchases(purchaseIds: string[], userId: string): Promise<void> {
  const ids = Array.from(new Set(purchaseIds.filter(Boolean)))
  if (ids.length === 0) {
    return
  }

  const supabase = getAdminSupabase()
  const { data: downloadEvents, error: eventsError } = await supabase
    .from('market_download_events')
    .select('purchase_id')
    .in('purchase_id', ids)

  if (eventsError) {
    throw new Error(eventsError.message)
  }

  const lockedPurchaseIds = new Set((downloadEvents ?? [])
    .map((event) => event.purchase_id)
    .filter((value): value is string => Boolean(value)))
  const rollbackIds = ids.filter((id) => !lockedPurchaseIds.has(id))
  if (rollbackIds.length === 0) {
    return
  }

  const { error } = await supabase
    .from('market_purchases')
    .delete()
    .eq('user_id', userId)
    .in('id', rollbackIds)

  if (error) {
    throw new Error(error.message)
  }
}


export async function recordMarketDownloadEvent(input: MarketDownloadEventInsert): Promise<MarketDownloadEvent> {
  const supabase = getAdminSupabase()
  const [item, file, purchase] = await Promise.all([
    getMarketItemById(input.item_id),
    getActiveMarketItemFile(input.item_id, input.asset_kind as 'sample' | 'pdf' | 'hwp' | 'zip'),
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

export async function recordMarketV2DownloadEvent(input: MarketDownloadEventInsert): Promise<MarketDownloadEvent> {
  const supabase = getAdminSupabase()
  const payload: MarketDownloadEventInsert = {
    ...input,
    event_target_type: 'subproduct_file',
    subproduct_file_id: input.subproduct_file_id,
    file_id: null,
    purchase_id: null,
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
  const entitlements = await supabase
    .from('market_entitlements')
    .select('*')
    .eq('user_id', userId)
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'active')

  if (entitlements.error) {
    throw new Error(entitlements.error.message)
  }

  const entitlementRows = withWorkspaceSubjects(entitlements.data)

  if (purchases.length === 0 && entitlementRows.length === 0) {
    return []
  }

  const itemIds = Array.from(new Set([
    ...purchases.map((purchase) => purchase.item_id),
    ...entitlementRows.map((entitlement) => entitlement.item_id),
  ]))

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

  const fileMap = new Map<string, { pdf: MarketItemFile | null; hwp: MarketItemFile | null; zip: MarketItemFile | null }>()
  for (const file of withWorkspaceSubjects(files)) {
    const current = fileMap.get(file.item_id) ?? { pdf: null, hwp: null, zip: null }
    if (file.asset_kind === 'pdf') current.pdf = file
    if (file.asset_kind === 'hwp') current.hwp = file
    if (file.asset_kind === 'zip') current.zip = file
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

  const groupedEntitlements = new Map<string, MarketEntitlement[]>()
  for (const entitlement of entitlementRows) {
    const current = groupedEntitlements.get(entitlement.item_id) ?? []
    current.push(entitlement)
    groupedEntitlements.set(entitlement.item_id, current)
  }

  const v2DownloadFileEntries = await Promise.all(itemIds.map(async (itemId) => [
    itemId,
    await listMarketSubproductDownloadFilesForUser(userId, itemId, workspaceSubject),
  ] as const))
  const v2DownloadFileMap = new Map(v2DownloadFileEntries)
  const v2OrderIds = Array.from(new Set(entitlementRows
    .map((entitlement) => entitlement.source_order_id)
    .filter((value): value is string => Boolean(value))))

  let v2OrderRows: MarketPurchaseOrder[] = []
  if (v2OrderIds.length > 0) {
    const { data: v2Orders, error: v2OrdersError } = await supabase
      .from('market_purchase_orders')
      .select('*')
      .in('id', v2OrderIds)
      .eq('user_id', userId)
      .eq('workspace_subject', workspaceSubject)

    if (v2OrdersError) {
      throw new Error(v2OrdersError.message)
    }

    v2OrderRows = withWorkspaceSubjects(v2Orders)
  }

  const groupedOrders = new Map<string, MarketPurchaseOrder[]>()
  for (const order of v2OrderRows) {
    const current = groupedOrders.get(order.item_id) ?? []
    current.push(order)
    groupedOrders.set(order.item_id, current)
  }

  const refundTargetEntries = await Promise.all(itemIds.map(async (itemId) => {
    const itemPurchases = groupedPurchases.get(itemId) ?? []
    const itemOrders = groupedOrders.get(itemId) ?? []
    const targets = await Promise.all([
      ...itemPurchases.map(async (purchase) => {
        const eligibility = await getMarketRefundEligibility({
          userId,
          targetKind: 'legacy_purchase',
          targetId: purchase.id,
        })

        return {
          targetKind: 'legacy_purchase' as const,
          targetId: purchase.id,
          label: getMarketAssetKindLabel(purchase.asset_kind),
          requestedRefundCredits: eligibility.requestedRefundCredits,
          purchasedAt: eligibility.purchasedAt,
          refundableUntil: eligibility.refundDeadline,
          downloadCount: eligibility.downloadCount,
          status: eligibility.status,
          reason: eligibility.reason,
        }
      }),
      ...itemOrders.map(async (order) => {
        const eligibility = await getMarketRefundEligibility({
          userId,
          targetKind: 'v2_order',
          targetId: order.id,
        })

        return {
          targetKind: 'v2_order' as const,
          targetId: order.id,
          label: order.purchase_type === 'bundle' ? '전체구매' : '서브상품',
          requestedRefundCredits: eligibility.requestedRefundCredits,
          purchasedAt: eligibility.purchasedAt,
          refundableUntil: eligibility.refundDeadline,
          downloadCount: eligibility.downloadCount,
          status: eligibility.status,
          reason: eligibility.reason,
        }
      }),
    ])

    return [itemId, targets] as const
  }))
  const refundTargets = new Map(refundTargetEntries)

  return itemIds
    .map((itemId) => {
      const itemPurchases = groupedPurchases.get(itemId) ?? []
      const itemEntitlements = groupedEntitlements.get(itemId) ?? []
      const item = itemMap.get(itemId)
      const menu = item ? menuMap.get(item.menu_entry_id) : null
      const assetFiles = fileMap.get(itemId) ?? { pdf: null, hwp: null, zip: null }
      const pdfPurchase = itemPurchases.find((purchase) => purchase.asset_kind === 'pdf') ?? null
      const hwpPurchase = itemPurchases.find((purchase) => purchase.asset_kind === 'hwp') ?? null
      const zipPurchase = itemPurchases.find((purchase) => purchase.asset_kind === 'zip') ?? null
      const v2DownloadFiles = v2DownloadFileMap.get(itemId) ?? []
      const v2BundleOwned = itemEntitlements.some((entitlement) => entitlement.scope === 'item')
      const v2OwnedLabels = Array.from(new Set([
        ...v2DownloadFiles.map((file) => file.subproductTitle),
        ...(v2BundleOwned ? ['전체구매'] : []),
      ]))
      const purchasedAt = [
        ...itemPurchases.map((purchase) => purchase.purchased_at),
        ...itemEntitlements.map((entitlement) => entitlement.created_at),
      ]
        .sort((a, b) => b.localeCompare(a))[0]

      const lastDownloadedAt = [
        latestDownloadMap.get(`${itemId}:pdf`) ?? null,
        latestDownloadMap.get(`${itemId}:hwp`) ?? null,
        latestDownloadMap.get(`${itemId}:zip`) ?? null,
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
        zipOwned: zipPurchase !== null,
        pdfPurchasedAt: pdfPurchase?.purchased_at ?? null,
        hwpPurchasedAt: hwpPurchase?.purchased_at ?? null,
        zipPurchasedAt: zipPurchase?.purchased_at ?? null,
        pdfDownloadUrl: pdfPurchase ? `/api/market/items/${itemId}/download?assetKind=pdf` : null,
        hwpDownloadUrl: hwpPurchase ? `/api/market/items/${itemId}/download?assetKind=hwp` : null,
        zipDownloadUrl: zipPurchase ? `/api/market/items/${itemId}/download?assetKind=zip` : null,
        pdfAvailable: pdfPurchase !== null && assetFiles.pdf !== null,
        hwpAvailable: hwpPurchase !== null && assetFiles.hwp !== null,
        zipAvailable: zipPurchase !== null && assetFiles.zip !== null,
        pdfFileName: assetFiles.pdf?.original_file_name ?? null,
        hwpFileName: assetFiles.hwp?.original_file_name ?? null,
        zipFileName: assetFiles.zip?.original_file_name ?? null,
        v2BundleOwned,
        v2OwnedLabels,
        v2DownloadFiles,
        refundTargets: refundTargets.get(itemId) ?? [],
      }
    })
    .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
}
