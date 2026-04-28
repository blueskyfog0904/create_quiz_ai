import type { TablesInsert } from '@/types/supabase'
import { CreditService, type DeductResult } from '@/lib/credits'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  findCompletedMarketPurchase,
  getActiveMarketItemFile,
  getMarketItemById,
} from '@/lib/market-items-server'

export type MarketPaidAssetKind = 'pdf' | 'hwp'
export type MarketAssetKind = 'sample' | MarketPaidAssetKind

export function getMarketPaidAssetLabel(assetKind: MarketPaidAssetKind) {
  return assetKind === 'pdf' ? 'PDF' : 'PDF & HWP'
}

export function isMarketAssetCoveredByPurchaseKind(
  downloadAssetKind: MarketPaidAssetKind,
  purchasedAssetKind: MarketPaidAssetKind
) {
  return downloadAssetKind === purchasedAssetKind || (downloadAssetKind === 'pdf' && purchasedAssetKind === 'hwp')
}

export function normalizeMarketBundleSelections<T extends { itemId: string; assetKind: MarketPaidAssetKind }>(
  selections: T[]
) {
  const hwpItemIds = new Set(selections.filter((selection) => selection.assetKind === 'hwp').map((selection) => selection.itemId))
  const deduped = new Map<string, T>()

  for (const selection of selections) {
    if (selection.assetKind === 'pdf' && hwpItemIds.has(selection.itemId)) {
      continue
    }

    deduped.set(`${selection.itemId}:${selection.assetKind}`, selection)
  }

  return Array.from(deduped.values())
}

export function buildMarketPurchaseResourceType(assetKind: MarketPaidAssetKind) {
  return assetKind === 'pdf' ? 'market_purchase_pdf' : 'market_purchase_hwp'
}

export function resolveMarketAssetPrice(
  item: { pdf_price: number; hwp_price: number },
  assetKind: MarketPaidAssetKind
) {
  return assetKind === 'pdf' ? item.pdf_price : item.hwp_price
}

export async function ensureMarketItemIsPurchasable(
  itemId: string,
  assetKind: MarketPaidAssetKind,
  workspaceSubject?: WorkspaceSubject
) {
  const item = await getMarketItemById(itemId, workspaceSubject)
  if (!item || item.deleted_at !== null || item.is_active === false || item.status !== 'published') {
    throw new Error('구매 가능한 문제마켓 상품을 찾을 수 없습니다.')
  }

  const file = await getActiveMarketItemFile(itemId, assetKind, item.workspace_subject)
  if (!file) {
    throw new Error('요청한 파일 자산을 찾을 수 없습니다.')
  }

  const price = resolveMarketAssetPrice(item, assetKind)
  if (price <= 0) {
    throw new Error('유효한 가격이 설정되지 않았습니다.')
  }

  return { item, file, price }
}

export async function ensureUserDoesNotOwnMarketAsset(
  userId: string,
  itemId: string,
  assetKind: MarketPaidAssetKind,
  workspaceSubject?: WorkspaceSubject
) {
  const purchaseKindsToCheck: MarketPaidAssetKind[] = assetKind === 'pdf' ? ['pdf', 'hwp'] : ['hwp']
  const purchases = await Promise.all(
    purchaseKindsToCheck.map((purchaseKind) => findCompletedMarketPurchase(userId, itemId, purchaseKind, workspaceSubject))
  )
  const purchase = purchases.find((candidate) => (
    candidate && isMarketAssetCoveredByPurchaseKind(assetKind, candidate.asset_kind as MarketPaidAssetKind)
  ))
  if (purchase) {
    throw new Error('이미 구매한 파일입니다.')
  }
}

export async function deductCreditsForMarketPurchase(
  userId: string,
  itemId: string,
  itemTitle: string,
  assetKind: MarketPaidAssetKind,
  price: number
): Promise<DeductResult> {
  return CreditService.deductCredits(
    userId,
    price,
    buildMarketPurchaseResourceType(assetKind),
    itemId,
    `${itemTitle} ${getMarketPaidAssetLabel(assetKind)} 구매`
  )
}

export function buildMarketPurchaseInsert(
  userId: string,
  itemId: string,
  assetKind: MarketPaidAssetKind,
  price: number,
  workspaceSubject: WorkspaceSubject
): TablesInsert<'market_purchases'> & { workspace_subject: WorkspaceSubject } {
  return {
    user_id: userId,
    item_id: itemId,
    asset_kind: assetKind,
    workspace_subject: workspaceSubject,
    price_credits: price,
    status: 'completed',
    credit_resource_type: buildMarketPurchaseResourceType(assetKind),
    credit_resource_id: null,
  }
}
