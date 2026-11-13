import { createAdminClient } from '@/lib/supabase/bypass'
import type { Tables } from '@/types/supabase'

// 상품을 지운 뒤 Storage 파일을 지우는 일을 대기 표(market_storage_cleanup_queue)에 적어 두고 처리한다.
// 파일 삭제가 실패해도 행이 남아 있어 나중에 다시 정리할 수 있다. 정리된 행은 지운다.

export type MarketStorageCleanupRow = Tables<'market_storage_cleanup_queue'>

export interface MarketStorageCleanupResult {
  cleaned: number
  failed: number
}

// 파일 경로를 가리키는 표. 여기에 살아 있는 행이 있으면 아직 쓰는 파일이므로 지우지 않는다.
const STORAGE_PATH_REFERENCE_TABLES = [
  'market_item_files',
  'market_subproduct_files',
  'market_item_sample_pages',
] as const

export const MARKET_STORAGE_STILL_REFERENCED_ERROR = 'STILL_REFERENCED'

// 한 번에 다루는 경로 수. 경로가 길어(약 160자) 조회 조건에 한꺼번에 넣으면 요청 주소가 한계를 넘는다.
const CLEANUP_CHUNK_SIZE = 25

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

export async function enqueueMarketStorageCleanup(input: {
  targets: Map<string, string[]>
  source: string
  sourceItemId?: string | null
  sourceItemTitle?: string | null
}): Promise<MarketStorageCleanupRow[]> {
  const rows = Array.from(input.targets.entries()).flatMap(([bucket, paths]) => (
    Array.from(new Set(paths.filter(Boolean))).map((path) => ({
      storage_bucket: bucket,
      storage_path: path,
      source: input.source,
      source_item_id: input.sourceItemId ?? null,
      source_item_title: input.sourceItemTitle ?? null,
    }))
  ))

  if (rows.length === 0) {
    return []
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('market_storage_cleanup_queue')
    .upsert(rows, { onConflict: 'storage_bucket,storage_path', ignoreDuplicates: true })

  if (error) {
    throw new Error(error.message)
  }

  // 이미 대기 중이던 경로(중복)도 함께 처리하도록 경로로 다시 읽는다.
  const queued: MarketStorageCleanupRow[] = []
  for (const [bucket, paths] of input.targets.entries()) {
    for (const pathChunk of chunk(Array.from(new Set(paths.filter(Boolean))), CLEANUP_CHUNK_SIZE)) {
      const { data, error: readError } = await supabase
        .from('market_storage_cleanup_queue')
        .select('*')
        .eq('storage_bucket', bucket)
        .in('storage_path', pathChunk)

      if (readError) {
        throw new Error(readError.message)
      }
      queued.push(...(data ?? []))
    }
  }

  return queued
}

async function listReferencedStoragePaths(bucket: string, paths: string[]) {
  const supabase = createAdminClient()
  const results = await Promise.all(STORAGE_PATH_REFERENCE_TABLES.map((table) => (
    supabase
      .from(table)
      .select('storage_path')
      .eq('storage_bucket', bucket)
      .in('storage_path', paths)
      .is('deleted_at', null)
  )))

  const referenced = new Set<string>()
  for (const { data, error } of results) {
    // 확인에 실패하면 지우지 않도록 그대로 던진다.
    if (error) {
      throw new Error(error.message)
    }
    for (const row of data ?? []) {
      if (row.storage_path) {
        referenced.add(row.storage_path)
      }
    }
  }

  return referenced
}

async function markCleanupFailed(rows: MarketStorageCleanupRow[], message: string) {
  const supabase = createAdminClient()
  const attemptedAt = new Date().toISOString()
  const idsByAttemptCount = new Map<number, string[]>()
  for (const row of rows) {
    idsByAttemptCount.set(row.attempt_count, [...(idsByAttemptCount.get(row.attempt_count) ?? []), row.id])
  }

  for (const [attemptCount, ids] of idsByAttemptCount.entries()) {
    const { error } = await supabase
      .from('market_storage_cleanup_queue')
      .update({ attempt_count: attemptCount + 1, last_error: message.slice(0, 500), last_attempt_at: attemptedAt })
      .in('id', ids)

    if (error) {
      console.error('[market-storage-cleanup] 실패 기록을 남기지 못했습니다.', { message: error.message })
    }
  }
}

// 대기 행의 파일을 지운다. 지운 행은 표에서 빼고, 실패한 행은 시도 횟수와 사유를 남긴다. 던지지 않는다.
export async function processMarketStorageCleanupRows(rows: MarketStorageCleanupRow[]): Promise<MarketStorageCleanupResult> {
  const supabase = createAdminClient()
  const result: MarketStorageCleanupResult = { cleaned: 0, failed: 0 }
  const rowsByBucket = new Map<string, MarketStorageCleanupRow[]>()
  for (const row of rows) {
    rowsByBucket.set(row.storage_bucket, [...(rowsByBucket.get(row.storage_bucket) ?? []), row])
  }

  const batches = Array.from(rowsByBucket.entries()).flatMap(([bucket, bucketRows]) => (
    chunk(bucketRows, CLEANUP_CHUNK_SIZE).map((batchRows) => [bucket, batchRows] as const)
  ))

  for (const [bucket, bucketRows] of batches) {
    // 이 묶음에서 이미 결과가 정해진 행(오류가 났을 때 다시 실패로 세지 않게)
    const settledIds = new Set<string>()
    try {
      const referenced = await listReferencedStoragePaths(bucket, bucketRows.map((row) => row.storage_path))
      const referencedRows = bucketRows.filter((row) => referenced.has(row.storage_path))
      const removableRows = bucketRows.filter((row) => !referenced.has(row.storage_path))

      if (referencedRows.length > 0) {
        await markCleanupFailed(referencedRows, MARKET_STORAGE_STILL_REFERENCED_ERROR)
        result.failed += referencedRows.length
        referencedRows.forEach((row) => settledIds.add(row.id))
      }

      if (removableRows.length === 0) {
        continue
      }

      const { error: removeError } = await supabase.storage.from(bucket).remove(removableRows.map((row) => row.storage_path))
      if (removeError) {
        throw new Error(removeError.message)
      }

      const { error: deleteError } = await supabase
        .from('market_storage_cleanup_queue')
        .delete()
        .in('id', removableRows.map((row) => row.id))

      if (deleteError) {
        // 파일은 지워졌다. 행이 남으면 다음 정리 때 다시 시도되고(없는 파일 삭제는 오류가 아니다) 그때 지워진다.
        console.error('[market-storage-cleanup] 정리한 행을 지우지 못했습니다.', { message: deleteError.message })
      }
      result.cleaned += removableRows.length
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[market-storage-cleanup] 파일 정리에 실패했습니다.', { bucket, message })
      const pendingRows = bucketRows.filter((row) => !settledIds.has(row.id))
      await markCleanupFailed(pendingRows, message)
      result.failed += pendingRows.length
    }
  }

  return result
}

export async function countPendingMarketStorageCleanup() {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from('market_storage_cleanup_queue')
    .select('id', { count: 'exact', head: true })

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

// 남아 있는 대기 행을 오래된 것부터 다시 정리한다.
export async function retryMarketStorageCleanup(input: { limit?: number; dryRun?: boolean } = {}) {
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000)
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('market_storage_cleanup_queue')
    .select('*')
    // 아직 시도하지 않은 것, 그다음 시도한 지 오래된 것부터(계속 실패하는 행이 새 행을 가로막지 않게)
    .order('last_attempt_at', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(error.message)
  }

  const rows = data ?? []
  if (input.dryRun) {
    return { dryRun: true, scanned: rows.length, cleaned: 0, failed: 0, remaining: await countPendingMarketStorageCleanup() }
  }

  const { cleaned, failed } = await processMarketStorageCleanupRows(rows)
  return { dryRun: false, scanned: rows.length, cleaned, failed, remaining: await countPendingMarketStorageCleanup() }
}
