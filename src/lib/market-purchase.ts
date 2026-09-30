import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { findCompletedMarketPurchase } from '@/lib/market-items-server'

export type MarketPaidAssetKind = 'pdf' | 'hwp' | 'zip'
export type MarketAssetKind = 'sample' | MarketPaidAssetKind

export interface MarketV2SubproductFileTarget {
  itemId: string
  subproductId: string
  fileId: string
}

export interface MarketV2EntitlementLike {
  id?: string
  item_id: string
  scope: string
  subproduct_id: string | null
  file_id: string | null
  source_order_id?: string | null
  status?: string | null
}

export function getMarketPurchaseKindsToCheck(assetKind: MarketPaidAssetKind): MarketPaidAssetKind[] {
  if (assetKind === 'zip') return ['zip']
  return [assetKind]
}

export function isMarketAssetCoveredByPurchaseKind(
  downloadAssetKind: MarketPaidAssetKind,
  purchasedAssetKind: MarketPaidAssetKind
) {
  return downloadAssetKind === purchasedAssetKind
}

export function isMarketSubproductFileCoveredByV2Entitlement(
  target: MarketV2SubproductFileTarget,
  entitlement: MarketV2EntitlementLike
) {
  if (entitlement.status && entitlement.status !== 'active') {
    return false
  }

  if (entitlement.item_id !== target.itemId) {
    return false
  }

  if (entitlement.scope === 'item') {
    return true
  }

  if (entitlement.scope === 'subproduct') {
    return entitlement.subproduct_id === target.subproductId
  }

  if (entitlement.scope === 'file') {
    return entitlement.file_id === target.fileId
  }

  return false
}

export function findMarketSubproductFileV2Entitlement(
  target: MarketV2SubproductFileTarget,
  entitlements: MarketV2EntitlementLike[]
) {
  return entitlements.find((entitlement) => isMarketSubproductFileCoveredByV2Entitlement(target, entitlement)) ?? null
}

export function normalizeMarketBundleSelections<T extends { itemId: string; assetKind: MarketPaidAssetKind }>(
  selections: T[]
) {
  const deduped = new Map<string, T>()

  for (const selection of selections) {
    deduped.set(`${selection.itemId}:${selection.assetKind}`, selection)
  }

  return Array.from(deduped.values())
}

export function isMarketV2PurchaseEnabled() {
  return process.env.MARKET_V2_PURCHASE_ENABLED !== 'false'
}

export async function ensureUserDoesNotOwnMarketAsset(
  userId: string,
  itemId: string,
  assetKind: MarketPaidAssetKind,
  workspaceSubject?: WorkspaceSubject
) {
  const purchaseKindsToCheck = getMarketPurchaseKindsToCheck(assetKind)
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
