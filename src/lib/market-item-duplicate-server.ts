import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import type { AdminRequestMeta } from '@/lib/admin-request-meta'
import {
  extractMarketItemDuplicateError,
  type MarketItemDuplicateErrorCode,
  type MarketItemDuplicateMode,
  type MarketItemDuplicateResult,
} from '@/lib/market-item-duplicate'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

// 18번 6-2: 상품·서브상품·전체구매를 DB 함수 한 거래로 복사한다(여러 route 를 차례로 부르지 않음 — 중간 실패 때 반쪽 상품이 남지 않게).
export type MarketItemDuplicateCallResult =
  | { ok: true; data: MarketItemDuplicateResult }
  | { ok: false; error: MarketItemDuplicateErrorCode | null }

export async function callDuplicateMarketItem(actorId: string, subject: WorkspaceSubject, sourceItemId: string, mode: MarketItemDuplicateMode,
  requestMeta: AdminRequestMeta): Promise<MarketItemDuplicateCallResult> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('market item duplicate: service key missing')
  }
  const db = createAdminClient() as unknown as SupabaseClient
  const { data, error } = await db.rpc('duplicate_market_item', {
    p_actor_id: actorId,
    p_subject: subject,
    p_source_item_id: sourceItemId,
    p_mode: mode,
    p_request_meta: requestMeta,
  })
  if (error) {
    const code = extractMarketItemDuplicateError(error.message)
    if (!code) console.error('[market-item-duplicate] duplicate_market_item 실패', error.message)
    return { ok: false, error: code }
  }
  const row = (data ?? {}) as { item_id?: string; subproduct_count?: number; skipped_subproduct_count?: number; bundle_copied?: boolean }
  if (!row.item_id) return { ok: false, error: null }
  return {
    ok: true,
    data: {
      itemId: row.item_id,
      subproductCount: row.subproduct_count ?? 0,
      skippedSubproductCount: row.skipped_subproduct_count ?? 0,
      bundleCopied: Boolean(row.bundle_copied),
    },
  }
}
