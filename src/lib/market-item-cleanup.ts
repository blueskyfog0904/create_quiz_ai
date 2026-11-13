import { createAdminClient } from '@/lib/supabase/bypass'
import {
  getMarketItemById,
  listMarketItemFiles,
  listMarketSubproductFilesForAdmin,
  updateMarketItem,
} from '@/lib/market-items-server'
import { listMarketItemSamplePagesForCleanup } from '@/lib/market-sample-pages-server'
import { DEFAULT_WORKSPACE_SUBJECT, type WorkspaceSubject } from '@/lib/workspace-subject'
import type { MarketItem } from '@/lib/market-items-server'

export type MarketStorageTargetMap = Map<string, string[]>

export interface MarketUploadCleanupCandidate {
  itemId: string
  title: string
  updatedAt: string
  storageObjectCount: number
}

export interface MarketUploadCleanupFailure {
  itemId: string
  message: string
}

export interface MarketUploadCleanupResult {
  dryRun: boolean
  cutoff: string
  scanned: number
  candidates: MarketUploadCleanupCandidate[]
  deleted: number
  failed: number
  failures: MarketUploadCleanupFailure[]
  storageObjectCount: number
}

function addStorageTarget(targets: MarketStorageTargetMap, bucket?: string | null, path?: string | null) {
  if (!bucket || !path) {
    return
  }

  const currentPaths = targets.get(bucket) ?? []
  currentPaths.push(path)
  targets.set(bucket, currentPaths)
}

function countStorageTargets(targets: MarketStorageTargetMap) {
  let count = 0
  for (const paths of targets.values()) {
    count += Array.from(new Set(paths.filter(Boolean))).length
  }
  return count
}

export async function collectMarketItemStorageTargets(
  itemId: string,
  workspaceSubject: WorkspaceSubject
): Promise<MarketStorageTargetMap> {
  const targets: MarketStorageTargetMap = new Map()
  const files = await listMarketItemFiles(itemId, true, workspaceSubject)
  const subproductFiles = await listMarketSubproductFilesForAdmin(itemId, undefined, workspaceSubject)
  const samplePages = await listMarketItemSamplePagesForCleanup(itemId, workspaceSubject)

  for (const file of files) {
    addStorageTarget(targets, file.storage_bucket, file.storage_path)
  }

  for (const file of subproductFiles) {
    addStorageTarget(targets, file.storage_bucket, file.storage_path)
  }

  for (const page of samplePages) {
    addStorageTarget(targets, page.storage_bucket, page.storage_path)
  }

  return targets
}

export async function removeStorageTargets(targets: MarketStorageTargetMap) {
  const adminSupabase = createAdminClient()

  for (const [bucket, paths] of targets.entries()) {
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)))
    if (uniquePaths.length === 0) {
      continue
    }

    const { error } = await adminSupabase.storage.from(bucket).remove(uniquePaths)
    if (error) {
      throw new Error(error.message)
    }
  }
}

// 구매·권리·다운로드·환불·후기 기록이 하나라도 있는 상품. 이런 상품을 지우면 그 기록이 함께 사라지므로 지우지 않는다.
const MARKET_ITEM_HISTORY_TABLES = [
  'market_purchases',
  'market_download_events',
  'market_purchase_orders',
  'market_purchase_lines',
  'market_entitlements',
  'market_refund_requests',
  'market_item_reviews',
] as const

export async function getItemsWithHistory(itemIds: string[], workspaceSubject: WorkspaceSubject) {
  if (itemIds.length === 0) {
    return new Set<string>()
  }

  const adminSupabase = createAdminClient()
  const results = await Promise.all(MARKET_ITEM_HISTORY_TABLES.map((table) => (
    adminSupabase
      .from(table)
      .select('item_id')
      .in('item_id', itemIds)
      .eq('workspace_subject', workspaceSubject)
  )))

  const itemsWithHistory = new Set<string>()
  for (const { data, error } of results) {
    // 판정에 실패하면 지우지 않도록 그대로 던진다.
    if (error) {
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      itemsWithHistory.add(row.item_id)
    }
  }

  return itemsWithHistory
}

export const MARKET_ITEM_HAS_HISTORY_ERROR_CODE = 'MARKET_ITEM_HAS_HISTORY'

export class MarketItemDeleteError extends Error {
  code: string | null

  constructor(message: string, code: string | null) {
    super(message)
    this.name = 'MarketItemDeleteError'
    this.code = code
  }
}

export async function hardDeleteMarketItemWithAssets(input: {
  itemId: string
  workspaceSubject: WorkspaceSubject
  requireAutoUploadDraft?: boolean
  requireNoHistory?: boolean
}): Promise<{ storageCleanupFailed: boolean }> {
  const adminSupabase = createAdminClient()
  const item = await getMarketItemById(input.itemId, input.workspaceSubject)

  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  if (input.requireAutoUploadDraft && (item.status !== 'draft' || item.draft_source !== 'auto_upload')) {
    throw new Error('자동 업로드 임시 상품만 정리할 수 있습니다.')
  }

  // 파일 경로는 DB 행이 사라지기 전에 모아 두고, 파일은 DB 삭제가 끝난 뒤에 지운다.
  // (파일을 먼저 지우면 DB 삭제가 실패했을 때 파일 없는 상품이 남는다.)
  const storageTargets = await collectMarketItemStorageTargets(input.itemId, input.workspaceSubject)

  if (input.requireNoHistory) {
    const itemsWithHistory = await getItemsWithHistory([input.itemId], input.workspaceSubject)
    if (itemsWithHistory.has(input.itemId)) {
      throw new MarketItemDeleteError(
        '구매·다운로드·환불·후기 이력이 있는 상품은 삭제할 수 없습니다.',
        MARKET_ITEM_HAS_HISTORY_ERROR_CODE
      )
    }
  }

  const { error } = await adminSupabase
    .from('market_items')
    .delete()
    .eq('id', input.itemId)
    .eq('workspace_subject', item.workspace_subject)

  if (error) {
    throw new MarketItemDeleteError(error.message, error.code ?? null)
  }

  try {
    await removeStorageTargets(storageTargets)
  } catch (storageError) {
    // 상품은 이미 지워졌다. 남은 파일은 기록만 하고 삭제 자체는 성공으로 돌려준다.
    console.error('[market-item-cleanup] 상품 삭제 뒤 파일 정리에 실패했습니다.', {
      itemId: input.itemId,
      message: storageError instanceof Error ? storageError.message : String(storageError),
    })
    return { storageCleanupFailed: true }
  }

  return { storageCleanupFailed: false }
}

// Postgres FK 위반. 판정과 삭제 사이에 구매가 끼어들면(구매 기록 FK가 RESTRICT인 경우) 이 코드가 온다.
const FOREIGN_KEY_VIOLATION_CODE = '23503'

// 관리자 화면의 '완전 삭제': 이력이 있으면 지우지 않고 숨김으로 바꾼다(구매자의 다운로드는 유지된다).
export async function deleteOrHideMarketItem(input: {
  itemId: string
  workspaceSubject: WorkspaceSubject
  updatedBy: string
}): Promise<{ result: 'deleted' | 'hidden'; storageCleanupFailed: boolean }> {
  const hide = async () => {
    const item = await getMarketItemById(input.itemId, input.workspaceSubject)
    if (!item) {
      throw new Error('문제마켓 상품을 찾을 수 없습니다.')
    }
    if (item.status !== 'hidden') {
      await updateMarketItem(input.itemId, { status: 'hidden', updated_by: input.updatedBy })
    }
    return { result: 'hidden' as const, storageCleanupFailed: false }
  }

  const itemsWithHistory = await getItemsWithHistory([input.itemId], input.workspaceSubject)
  if (itemsWithHistory.has(input.itemId)) {
    return hide()
  }

  try {
    const { storageCleanupFailed } = await hardDeleteMarketItemWithAssets({
      itemId: input.itemId,
      workspaceSubject: input.workspaceSubject,
      requireNoHistory: true,
    })
    return { result: 'deleted', storageCleanupFailed }
  } catch (error) {
    if (
      error instanceof MarketItemDeleteError
      && (error.code === FOREIGN_KEY_VIOLATION_CODE || error.code === MARKET_ITEM_HAS_HISTORY_ERROR_CODE)
    ) {
      return hide()
    }
    throw error
  }
}

async function listAutoUploadDraftCleanupCandidates(input: {
  workspaceSubject: WorkspaceSubject
  cutoff: string
  limit: number
}): Promise<MarketItem[]> {
  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase
    .from('market_items')
    .select('*')
    .eq('workspace_subject', input.workspaceSubject)
    .eq('status', 'draft')
    .eq('draft_source', 'auto_upload')
    .is('deleted_at', null)
    .lt('updated_at', input.cutoff)
    .order('updated_at', { ascending: true })
    .limit(input.limit)

  if (error) {
    throw new Error(error.message)
  }

  const rows = (data ?? []) as MarketItem[]
  const blockedItemIds = await getItemsWithHistory(rows.map((item) => item.id), input.workspaceSubject)
  return rows.filter((item) => !blockedItemIds.has(item.id))
}

export async function cleanupAutoUploadDraftMarketItems(input: {
  workspaceSubject?: WorkspaceSubject
  olderThanHours?: number
  limit?: number
  dryRun?: boolean
}): Promise<MarketUploadCleanupResult> {
  const workspaceSubject = input.workspaceSubject ?? DEFAULT_WORKSPACE_SUBJECT
  const olderThanHours = Math.max(input.olderThanHours ?? 24, 1)
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)
  const dryRun = input.dryRun ?? true
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000).toISOString()
  const items = await listAutoUploadDraftCleanupCandidates({ workspaceSubject, cutoff, limit })
  const candidates: MarketUploadCleanupCandidate[] = []
  const failures: MarketUploadCleanupFailure[] = []
  let storageObjectCount = 0
  let deleted = 0

  for (const item of items) {
    const targets = await collectMarketItemStorageTargets(item.id, workspaceSubject)
    const itemStorageObjectCount = countStorageTargets(targets)
    storageObjectCount += itemStorageObjectCount
    candidates.push({
      itemId: item.id,
      title: item.title,
      updatedAt: item.updated_at,
      storageObjectCount: itemStorageObjectCount,
    })

    if (dryRun) {
      continue
    }

    try {
      await hardDeleteMarketItemWithAssets({
        itemId: item.id,
        workspaceSubject,
        requireAutoUploadDraft: true,
        requireNoHistory: true,
      })
      deleted += 1
    } catch (error) {
      failures.push({
        itemId: item.id,
        message: error instanceof Error ? error.message : '자동 업로드 임시 상품 정리에 실패했습니다.',
      })
    }
  }

  return {
    dryRun,
    cutoff,
    scanned: items.length,
    candidates,
    deleted,
    failed: failures.length,
    failures,
    storageObjectCount,
  }
}
