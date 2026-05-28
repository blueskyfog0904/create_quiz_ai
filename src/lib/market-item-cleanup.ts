import { createAdminClient } from '@/lib/supabase/bypass'
import {
  getMarketItemById,
  listMarketItemFiles,
  listMarketSubproductFilesForAdmin,
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

async function getItemsWithHistory(itemIds: string[], workspaceSubject: WorkspaceSubject) {
  if (itemIds.length === 0) {
    return new Set<string>()
  }

  const adminSupabase = createAdminClient()
  const [
    { data: purchases, error: purchasesError },
    { data: downloads, error: downloadsError },
    { data: orders, error: ordersError },
    { data: entitlements, error: entitlementsError },
  ] = await Promise.all([
    adminSupabase
      .from('market_purchases')
      .select('item_id')
      .in('item_id', itemIds)
      .eq('workspace_subject', workspaceSubject),
    adminSupabase
      .from('market_download_events')
      .select('item_id')
      .in('item_id', itemIds)
      .eq('workspace_subject', workspaceSubject),
    adminSupabase
      .from('market_purchase_orders')
      .select('item_id')
      .in('item_id', itemIds)
      .eq('workspace_subject', workspaceSubject),
    adminSupabase
      .from('market_entitlements')
      .select('item_id')
      .in('item_id', itemIds)
      .eq('workspace_subject', workspaceSubject),
  ])

  const queryError = purchasesError ?? downloadsError ?? ordersError ?? entitlementsError
  if (queryError) {
    throw new Error(queryError.message)
  }

  const v2HistoryIds = [
    ...(orders ?? []).map((order) => order.item_id),
    ...(entitlements ?? []).map((entitlement) => entitlement.item_id),
  ]

  return new Set([
    ...(purchases ?? []).map((purchase) => purchase.item_id),
    ...(downloads ?? []).map((download) => download.item_id),
    ...v2HistoryIds,
  ])
}

export async function hardDeleteMarketItemWithAssets(input: {
  itemId: string
  workspaceSubject: WorkspaceSubject
  requireAutoUploadDraft?: boolean
  requireNoHistory?: boolean
}) {
  const adminSupabase = createAdminClient()
  const item = await getMarketItemById(input.itemId, input.workspaceSubject)

  if (!item) {
    throw new Error('문제마켓 상품을 찾을 수 없습니다.')
  }

  if (input.requireAutoUploadDraft && (item.status !== 'draft' || item.draft_source !== 'auto_upload')) {
    throw new Error('자동 업로드 임시 상품만 정리할 수 있습니다.')
  }

  if (input.requireNoHistory) {
    const itemsWithHistory = await getItemsWithHistory([input.itemId], input.workspaceSubject)
    if (itemsWithHistory.has(input.itemId)) {
      throw new Error('구매 또는 다운로드 이력이 있는 상품은 자동 정리할 수 없습니다.')
    }
  }

  const storageTargets = await collectMarketItemStorageTargets(input.itemId, input.workspaceSubject)
  await removeStorageTargets(storageTargets)

  const { error } = await adminSupabase
    .from('market_items')
    .delete()
    .eq('id', input.itemId)
    .eq('workspace_subject', item.workspace_subject)

  if (error) {
    throw new Error(error.message)
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
