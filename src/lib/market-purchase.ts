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

const V2_ENTITLEMENT_SCOPE_ORDER = ['file', 'subproduct', 'item']

// 파일을 덮는 사용 가능 권한 전부를 다운로드에 쓸 순서로 돌려준다(DB가 돌려준 순서에 기대지 않는다).
// 그 파일에 더 좁게 걸린 권한(파일 > 구성 > 상품 전체)이 먼저고, 같은 범위면 권한 id 순이다.
export function listMarketSubproductFileV2Entitlements<T extends MarketV2EntitlementLike>(
  target: MarketV2SubproductFileTarget,
  entitlements: T[]
) {
  return entitlements
    .filter((entitlement) => isMarketSubproductFileCoveredByV2Entitlement(target, entitlement))
    .sort((left, right) => (
      V2_ENTITLEMENT_SCOPE_ORDER.indexOf(left.scope) - V2_ENTITLEMENT_SCOPE_ORDER.indexOf(right.scope) ||
      (left.id ?? '').localeCompare(right.id ?? '')
    ))
}

// 다운로드에 쓸 권한: 파일을 덮는 권한 중 주문 정보가 있고 그 주문이 환불 심사 중이 아닌 첫 권한. 없으면 null.
// pendingRefundOrderIds는 환불 요청이 심사 중(pending)인 주문 id다.
export function findMarketSubproductFileV2Entitlement<T extends MarketV2EntitlementLike>(
  target: MarketV2SubproductFileTarget,
  entitlements: T[],
  pendingRefundOrderIds: string[]
) {
  return listMarketSubproductFileV2Entitlements(target, entitlements).find((entitlement) => (
    entitlement.source_order_id && !pendingRefundOrderIds.includes(entitlement.source_order_id)
  )) ?? null
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
