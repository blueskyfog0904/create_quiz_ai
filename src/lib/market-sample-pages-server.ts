import { createAdminClient } from '@/lib/supabase/bypass'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { Tables, TablesInsert } from '@/types/supabase'

type WithWorkspaceSubject = { workspace_subject: WorkspaceSubject }
type WithOptionalWorkspaceSubject = { workspace_subject?: WorkspaceSubject }

export type MarketItemSamplePage = Tables<'market_item_sample_pages'> & WithWorkspaceSubject
type MarketItemSamplePageInsert = TablesInsert<'market_item_sample_pages'> & WithOptionalWorkspaceSubject

interface ReplaceMarketItemSamplePageInput {
  sourceFileId: string
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

function normalizeWorkspaceSubject(value?: string | null): WorkspaceSubject {
  return value === 'korean' ? 'korean' : DEFAULT_WORKSPACE_SUBJECT
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

export async function replaceMarketItemSamplePages(
  itemId: string,
  input: ReplaceMarketItemSamplePageInput
): Promise<MarketItemSamplePage[]> {
  const supabase = createAdminClient()
  const { data: item, error: itemError } = await supabase
    .from('market_items')
    .select('id')
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
