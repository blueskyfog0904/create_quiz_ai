import { createAdminClient } from '@/lib/supabase/bypass'
import { MARKET_STORAGE_BUCKET } from '@/lib/market-storage'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { Tables, TablesInsert } from '@/types/supabase'

type WithWorkspaceSubject = { workspace_subject: WorkspaceSubject }
type WithOptionalWorkspaceSubject = { workspace_subject?: WorkspaceSubject }

export type MarketItemSamplePage = Tables<'market_item_sample_pages'> & WithWorkspaceSubject
type MarketItemSamplePageInsert = TablesInsert<'market_item_sample_pages'> & WithOptionalWorkspaceSubject

interface ReplaceMarketItemSamplePageInput {
  sourceFileId: string | null
  workspaceSubject: WorkspaceSubject
  createdBy?: string | null
  pages: Array<{
    pageNumber: number
    storageBucket: string
    storagePath: string
    originalFileName: string
    mimeType: string
    fileSizeBytes: number
    widthPx?: number | null
    heightPx?: number | null
  }>
}

interface DraftMarketItemSamplePageInput {
  sourceFileId?: string | null
  sourceBatchId: string
  draftToken: string
  workspaceSubject: WorkspaceSubject
  createdBy?: string | null
  pages: Array<{
    pageNumber: number
    storageBucket: string
    storagePath: string
    originalFileName: string
    mimeType: string
    fileSizeBytes: number
    widthPx?: number | null
    heightPx?: number | null
  }>
}

type ManualSampleUploadTargetCleanupInput = DraftMarketItemSamplePageInput

export interface RemovedManualSampleUploadCleanupResult {
  dryRun: boolean
  cutoff: string
  scanned: number
  removedStorageObjects: number
  deletedMetadataRows: number
  skippedReferenced: number
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

export async function listActiveMarketItemSamplePages(
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemSamplePage[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('market_item_sample_pages')
    .select('*')
    .eq('item_id', itemId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
    .order('page_number', { ascending: true })

  if (workspaceSubject) {
    query = query.eq('workspace_subject', workspaceSubject)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function listActiveMarketItemSamplePagesForItems(
  itemIds: string[],
  workspaceSubject: WorkspaceSubject
): Promise<Map<string, MarketItemSamplePage[]>> {
  if (itemIds.length === 0) {
    return new Map()
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .select('*')
    .in('item_id', itemIds)
    .eq('workspace_subject', workspaceSubject)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('display_order', { ascending: true })
    .order('page_number', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  const pageMap = new Map<string, MarketItemSamplePage[]>()
  for (const page of withWorkspaceSubjects(data)) {
    const current = pageMap.get(page.item_id) ?? []
    current.push(page)
    pageMap.set(page.item_id, current)
  }

  return pageMap
}

export async function listMarketItemSamplePagesForCleanup(
  itemId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemSamplePage[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from('market_item_sample_pages')
    .select('*')
    .eq('item_id', itemId)
    .order('version', { ascending: false })
    .order('page_number', { ascending: true })

  if (workspaceSubject) {
    query = query.eq('workspace_subject', workspaceSubject)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function replaceMarketItemSamplePages(
  itemId: string,
  input: ReplaceMarketItemSamplePageInput
): Promise<MarketItemSamplePage[]> {
  const supabase = createAdminClient()
  const { data: item, error: itemError } = await supabase
    .from('market_items')
    .select('id, workspace_subject')
    .eq('id', itemId)
    .maybeSingle()

  if (itemError) {
    throw new Error(itemError.message)
  }

  if (!item) {
    throw new Error('샘플 페이지를 연결할 문제마켓 상품을 찾을 수 없습니다.')
  }

  const itemWorkspaceSubject = input.workspaceSubject

  const { data: existingPages, error: existingError } = await supabase
    .from('market_item_sample_pages')
    .select('version')
    .eq('item_id', itemId)
    .eq('workspace_subject', itemWorkspaceSubject)

  if (existingError) {
    throw new Error(existingError.message)
  }

  const previousVersion = (existingPages ?? []).reduce((maxVersion, page) => Math.max(maxVersion, page.version), 0)
  const nextVersion = previousVersion + 1
  const { error: deactivateError } = await supabase
    .from('market_item_sample_pages')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('item_id', itemId)
    .eq('workspace_subject', itemWorkspaceSubject)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (deactivateError) {
    throw new Error(deactivateError.message)
  }

  if (input.pages.length === 0) {
    return []
  }

  const payload: MarketItemSamplePageInsert[] = input.pages.map((page) => ({
    item_id: itemId,
    source_file_id: input.sourceFileId,
    workspace_subject: itemWorkspaceSubject,
    page_number: page.pageNumber,
    storage_bucket: page.storageBucket,
    storage_path: page.storagePath,
    original_file_name: page.originalFileName,
    mime_type: page.mimeType,
    file_size_bytes: page.fileSizeBytes,
    width_px: page.widthPx ?? null,
    height_px: page.heightPx ?? null,
    version: nextVersion,
    is_active: true,
    created_by: input.createdBy ?? null,
  }))

  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .insert(payload as TablesInsert<'market_item_sample_pages'>[])
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function appendDraftMarketItemSamplePages(
  itemId: string,
  input: DraftMarketItemSamplePageInput
): Promise<MarketItemSamplePage[]> {
  const supabase = createAdminClient()
  const { data: item, error: itemError } = await supabase
    .from('market_items')
    .select('id, workspace_subject')
    .eq('id', itemId)
    .maybeSingle()

  if (itemError) {
    throw new Error(itemError.message)
  }

  const itemRow = item as { id: string; workspace_subject?: string | null } | null
  if (!itemRow || normalizeWorkspaceSubject(itemRow.workspace_subject) !== input.workspaceSubject) {
    throw new Error('샘플 페이지를 연결할 문제마켓 상품을 찾을 수 없습니다.')
  }

  if (input.pages.length === 0) {
    return []
  }

  const { data: existingPages, error: existingError } = await supabase
    .from('market_item_sample_pages')
    .select('version, display_order')
    .eq('item_id', itemId)
    .eq('workspace_subject', input.workspaceSubject)

  if (existingError) {
    throw new Error(existingError.message)
  }

  const previousVersion = (existingPages ?? []).reduce((maxVersion, page) => Math.max(maxVersion, page.version), 0)
  const previousDisplayOrder = (existingPages ?? []).reduce((maxOrder, page) => Math.max(maxOrder, page.display_order), 0)
  const nextVersion = previousVersion + 1
  const payload: MarketItemSamplePageInsert[] = input.pages.map((page, index) => ({
    item_id: itemId,
    source_file_id: input.sourceFileId ?? null,
    workspace_subject: input.workspaceSubject,
    page_number: page.pageNumber,
    storage_bucket: page.storageBucket,
    storage_path: page.storagePath,
    original_file_name: page.originalFileName,
    mime_type: page.mimeType,
    file_size_bytes: page.fileSizeBytes,
    width_px: page.widthPx ?? null,
    height_px: page.heightPx ?? null,
    version: nextVersion,
    is_active: false,
    status: 'draft',
    draft_token: input.draftToken,
    source_batch_id: input.sourceBatchId,
    display_order: previousDisplayOrder + index + 1,
    created_by: input.createdBy ?? null,
  }))

  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .insert(payload as TablesInsert<'market_item_sample_pages'>[])
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function recordManualSampleUploadTargetsForCleanup(
  itemId: string,
  input: ManualSampleUploadTargetCleanupInput
): Promise<MarketItemSamplePage[]> {
  if (input.pages.length === 0) {
    return []
  }

  const supabase = createAdminClient()
  const deletedAt = new Date().toISOString()
  const payload: MarketItemSamplePageInsert[] = input.pages.map((page, index) => ({
    item_id: itemId,
    source_file_id: input.sourceFileId ?? null,
    workspace_subject: input.workspaceSubject,
    page_number: page.pageNumber,
    storage_bucket: page.storageBucket,
    storage_path: page.storagePath,
    original_file_name: page.originalFileName,
    mime_type: page.mimeType,
    file_size_bytes: page.fileSizeBytes,
    width_px: page.widthPx ?? null,
    height_px: page.heightPx ?? null,
    version: 1,
    is_active: false,
    status: 'removed',
    draft_token: input.draftToken,
    source_batch_id: input.sourceBatchId,
    display_order: index + 1,
    created_by: input.createdBy ?? null,
    deleted_at: deletedAt,
  }))

  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .insert(payload as TablesInsert<'market_item_sample_pages'>[])
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function deleteRemovedManualSampleUploadTargets(
  itemId: string,
  input: {
    workspaceSubject: WorkspaceSubject
    sourceBatchId: string
    draftToken: string
  }
) {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('market_item_sample_pages')
    .delete()
    .eq('item_id', itemId)
    .eq('workspace_subject', input.workspaceSubject)
    .eq('source_batch_id', input.sourceBatchId)
    .eq('draft_token', input.draftToken)
    .eq('status', 'removed')
    .not('deleted_at', 'is', null)

  if (error) {
    throw new Error(error.message)
  }
}

export async function commitDraftMarketItemSamplePages(
  itemId: string,
  draftToken: string,
  workspaceSubject: WorkspaceSubject
): Promise<MarketItemSamplePage[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .update({
      status: 'active',
      is_active: true,
      committed_at: new Date().toISOString(),
      draft_token: null,
    })
    .eq('item_id', itemId)
    .eq('workspace_subject', workspaceSubject)
    .eq('draft_token', draftToken)
    .eq('status', 'draft')
    .is('deleted_at', null)
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function removeDraftMarketItemSamplePage(
  pageId: string,
  itemId: string,
  draftToken: string,
  workspaceSubject: WorkspaceSubject
): Promise<MarketItemSamplePage | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .update({
      status: 'removed',
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', pageId)
    .eq('item_id', itemId)
    .eq('workspace_subject', workspaceSubject)
    .eq('draft_token', draftToken)
    .eq('status', 'draft')
    .select('*')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function markDraftMarketItemSamplePagesAsRemoved(
  itemId: string,
  input: {
    workspaceSubject: WorkspaceSubject
    draftToken: string
    sourceBatchId: string
    createdBy: string
  }
): Promise<MarketItemSamplePage[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .update({
      status: 'removed',
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('item_id', itemId)
    .eq('workspace_subject', input.workspaceSubject)
    .eq('draft_token', input.draftToken)
    .eq('source_batch_id', input.sourceBatchId)
    .eq('created_by', input.createdBy)
    .eq('status', 'draft')
    .select('*')

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubjects(data)
}

export async function hasActiveOrDraftMarketItemSamplePageStoragePath(
  itemId: string,
  workspaceSubject: WorkspaceSubject,
  storagePath: string
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .select('id, status, is_active')
    .eq('item_id', itemId)
    .eq('workspace_subject', workspaceSubject)
    .eq('storage_path', storagePath)
    .is('deleted_at', null)

  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []).some((page) => page.is_active || page.status === 'draft')
}

async function listReferencedActiveOrDraftStoragePaths(
  workspaceSubject: WorkspaceSubject,
  storagePaths: string[]
) {
  const uniqueStoragePaths = Array.from(new Set(storagePaths))
  if (uniqueStoragePaths.length === 0) {
    return new Set<string>()
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .select('storage_path, status, is_active')
    .eq('workspace_subject', workspaceSubject)
    .in('storage_path', uniqueStoragePaths)
    .is('deleted_at', null)

  if (error) {
    throw new Error(error.message)
  }

  return new Set((data ?? [])
    .filter((page) => page.is_active || page.status === 'draft')
    .map((page) => page.storage_path)
    .filter(Boolean))
}

export async function cleanupRemovedManualSampleUploadTargets(input: {
  workspaceSubject?: WorkspaceSubject
  olderThanHours?: number
  limit?: number
  dryRun?: boolean
}): Promise<RemovedManualSampleUploadCleanupResult> {
  const workspaceSubject = input.workspaceSubject ?? DEFAULT_WORKSPACE_SUBJECT
  const olderThanHours = Math.max(input.olderThanHours ?? 24, 1)
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000)
  const dryRun = input.dryRun ?? true
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .select('id, storage_bucket, storage_path')
    .eq('workspace_subject', workspaceSubject)
    .eq('status', 'removed')
    .eq('storage_bucket', MARKET_STORAGE_BUCKET)
    .like('storage_path', `market/${workspaceSubject}/%/sample-pages/manual/%`)
    .not('source_batch_id', 'is', null)
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoff)
    .order('deleted_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  const rows = data ?? []
  const storagePaths = rows.map((row) => row.storage_path).filter(Boolean)
  const referencedStoragePaths = await listReferencedActiveOrDraftStoragePaths(workspaceSubject, storagePaths)
  const removableStoragePaths = Array.from(new Set(storagePaths.filter((storagePath) => !referencedStoragePaths.has(storagePath))))
  const metadataRowIds = rows.map((row) => row.id).filter(Boolean)

  if (!dryRun) {
    if (removableStoragePaths.length > 0) {
      const { error: removeError } = await supabase
        .storage
        .from(MARKET_STORAGE_BUCKET)
        .remove(removableStoragePaths)

      if (removeError) {
        throw new Error(removeError.message)
      }
    }

    if (metadataRowIds.length > 0) {
      const { error: deleteError } = await supabase
        .from('market_item_sample_pages')
        .delete()
        .in('id', metadataRowIds)

      if (deleteError) {
        throw new Error(deleteError.message)
      }
    }
  }

  return {
    dryRun,
    cutoff,
    scanned: rows.length,
    removedStorageObjects: dryRun ? 0 : removableStoragePaths.length,
    deletedMetadataRows: dryRun ? 0 : metadataRowIds.length,
    skippedReferenced: storagePaths.length - removableStoragePaths.length,
  }
}


export async function getActiveMarketItemSamplePageById(
  pageId: string,
  workspaceSubject?: WorkspaceSubject
): Promise<MarketItemSamplePage | null> {
  const supabase = createAdminClient()
  let query = supabase
    .from('market_item_sample_pages')
    .select('*')
    .eq('id', pageId)
    .eq('is_active', true)
    .is('deleted_at', null)

  if (workspaceSubject) {
    query = query.eq('workspace_subject', workspaceSubject)
  }

  const { data, error } = await query.maybeSingle()
  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function deactivateMarketItemSamplePage(
  pageId: string,
  itemId: string,
  workspaceSubject: WorkspaceSubject
): Promise<MarketItemSamplePage | null> {
  const supabase = createAdminClient()
  const page = await getActiveMarketItemSamplePageById(pageId, workspaceSubject)
  if (!page || page.item_id !== itemId) {
    return null
  }

  const { data, error } = await supabase
    .from('market_item_sample_pages')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', pageId)
    .eq('item_id', itemId)
    .eq('workspace_subject', workspaceSubject)
    .select('*')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return withWorkspaceSubject(data)
}

export async function updateMarketItemSamplePageDisplayOrder(
  itemId: string,
  pageIds: string[],
  workspaceSubject: WorkspaceSubject
): Promise<void> {
  if (pageIds.length === 0) {
    return
  }

  const supabase = createAdminClient()
  for (const [index, pageId] of pageIds.entries()) {
    const { error } = await supabase
      .from('market_item_sample_pages')
      .update({ display_order: index + 1 })
      .eq('id', pageId)
      .eq('item_id', itemId)
      .eq('workspace_subject', workspaceSubject)
      .is('deleted_at', null)

    if (error) {
      throw new Error(error.message)
    }
  }
}
