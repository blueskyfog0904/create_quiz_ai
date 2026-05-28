import type { TablesInsert } from '@/types/supabase'
import { CreditService, type DeductResult } from '@/lib/credits'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  createMarketEntitlement,
  createMarketPurchaseLine,
  createMarketPurchaseOrder,
  findCompletedMarketPurchase,
  findCompletedMarketV2OrderByIdempotencyKey,
  getActiveMarketItemFile,
  getMarketBundlePurchaseContext,
  getMarketItemById,
  getMarketSubproductPurchaseContext,
  listMarketV2EntitlementsForItem,
  rollbackMarketV2PurchaseArtifacts,
  type MarketPurchaseOrder,
} from '@/lib/market-items-server'

export type MarketPaidAssetKind = 'pdf' | 'hwp' | 'zip'
export type MarketAssetKind = 'sample' | MarketPaidAssetKind
export type MarketV2PurchaseType = 'subproduct' | 'bundle'

export interface MarketV2SubproductFileTarget {
  itemId: string
  subproductId: string
  fileId: string
}

export interface MarketV2EntitlementLike {
  item_id: string
  scope: string
  subproduct_id: string | null
  file_id: string | null
  status?: string | null
}

export function getMarketPaidAssetLabel(assetKind: MarketPaidAssetKind) {
  if (assetKind === 'pdf') return 'PDF'
  if (assetKind === 'hwp') return 'HWP & PDF'
  return 'ZIP'
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

export function buildMarketPurchaseResourceType(assetKind: MarketPaidAssetKind) {
  if (assetKind === 'pdf') return 'market_purchase_pdf'
  if (assetKind === 'hwp') return 'market_purchase_hwp'
  return 'market_purchase_zip'
}

export function isMarketV2PurchaseEnabled() {
  return process.env.MARKET_V2_PURCHASE_ENABLED !== 'false'
}

export function buildMarketV2PurchaseResourceType(purchaseType: MarketV2PurchaseType) {
  return purchaseType === 'bundle' ? 'market_purchase_bundle_v2' : 'market_purchase_subproduct_v2'
}

export function resolveMarketAssetPrice(
  item: { pdf_price: number; hwp_price: number; zip_price: number },
  assetKind: MarketPaidAssetKind
) {
  if (assetKind === 'pdf') return item.pdf_price
  if (assetKind === 'hwp') return item.hwp_price
  return item.zip_price
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

export async function deductCreditsForMarketV2Purchase(
  userId: string,
  itemId: string,
  title: string,
  purchaseType: MarketV2PurchaseType,
  price: number
): Promise<DeductResult> {
  return CreditService.deductCredits(
    userId,
    price,
    buildMarketV2PurchaseResourceType(purchaseType),
    itemId,
    `${title} ${purchaseType === 'bundle' ? '전체구매' : '서브상품'} 구매`
  )
}

export async function ensureUserCanPurchaseMarketV2Target(
  userId: string,
  itemId: string,
  purchaseType: MarketV2PurchaseType,
  targetId: string,
  workspaceSubject?: WorkspaceSubject
) {
  const entitlements = await listMarketV2EntitlementsForItem(userId, itemId, workspaceSubject)

  if (purchaseType === 'bundle') {
    const existingBundle = entitlements.find((entitlement) => entitlement.scope === 'item')
    if (existingBundle) {
      throw new Error('이미 전체구매한 상품입니다.')
    }
    return
  }

  const existingBundle = entitlements.find((entitlement) => entitlement.scope === 'item')
  if (existingBundle) {
    throw new Error('이미 전체구매한 상품입니다.')
  }

  const existingSubproduct = entitlements.find((entitlement) => (
    entitlement.scope === 'subproduct' && entitlement.subproduct_id === targetId
  ))
  if (existingSubproduct) {
    throw new Error('이미 구매한 서브상품입니다.')
  }
}

export async function createMarketV2PurchaseWithCompensation(input: {
  userId: string
  itemId: string
  purchaseType: MarketV2PurchaseType
  subproductId?: string
  bundleOptionId?: string
  idempotencyKey?: string | null
  workspaceSubject?: WorkspaceSubject
  balanceBefore: number
}): Promise<{
  order: MarketPurchaseOrder
  priceCredits: number
  itemTitle: string
  alreadyCompleted: boolean
  deductionResult: DeductResult | null
}> {
  if (input.idempotencyKey) {
    const existingOrder = await findCompletedMarketV2OrderByIdempotencyKey(
      input.userId,
      input.idempotencyKey,
      input.workspaceSubject
    )
    if (existingOrder) {
      return {
        order: existingOrder,
        priceCredits: existingOrder.charged_credits,
        itemTitle: '문제마켓 상품',
        alreadyCompleted: true,
        deductionResult: null,
      }
    }
  }

  let item: Awaited<ReturnType<typeof getMarketSubproductPurchaseContext>>['item']
  let priceCredits: number
  let targetId: string
  if (input.purchaseType === 'bundle') {
    const context = await getMarketBundlePurchaseContext(input.itemId, input.bundleOptionId ?? '', input.workspaceSubject)
    item = context.item
    priceCredits = context.bundleOption.price_credits
    targetId = context.bundleOption.id
  } else {
    const context = await getMarketSubproductPurchaseContext(input.itemId, input.subproductId ?? '', input.workspaceSubject)
    item = context.item
    priceCredits = context.subproduct.price_credits
    targetId = context.subproduct.id
  }

  await ensureUserCanPurchaseMarketV2Target(
    input.userId,
    item.id,
    input.purchaseType,
    targetId,
    item.workspace_subject
  )

  const deductionResult = await deductCreditsForMarketV2Purchase(
    input.userId,
    item.id,
    item.title,
    input.purchaseType,
    priceCredits
  )

  let order: MarketPurchaseOrder | null = null
  try {
    order = await createMarketPurchaseOrder({
      workspace_subject: item.workspace_subject,
      user_id: input.userId,
      item_id: item.id,
      purchase_type: input.purchaseType,
      idempotency_key: input.idempotencyKey ?? null,
      original_price_credits: priceCredits,
      charged_credits: priceCredits,
      status: 'completed',
    })

    await createMarketPurchaseLine({
      order_id: order.id,
      workspace_subject: item.workspace_subject,
      item_id: item.id,
      line_type: input.purchaseType,
      subproduct_id: input.purchaseType === 'subproduct' ? targetId : null,
      bundle_option_id: input.purchaseType === 'bundle' ? targetId : null,
      price_credits: priceCredits,
      status: 'completed',
    })

    await createMarketEntitlement({
      workspace_subject: item.workspace_subject,
      user_id: input.userId,
      item_id: item.id,
      scope: input.purchaseType === 'bundle' ? 'item' : 'subproduct',
      subproduct_id: input.purchaseType === 'subproduct' ? targetId : null,
      file_id: null,
      source_order_id: order.id,
      status: 'active',
    })
  } catch (error) {
    if (order) {
      await rollbackMarketV2PurchaseArtifacts(order.id, item.workspace_subject)
    }
    await CreditService.refundCredits(
      input.userId,
      priceCredits,
      buildMarketV2PurchaseResourceType(input.purchaseType),
      item.id,
      `${item.title} ${input.purchaseType === 'bundle' ? '전체구매' : '서브상품'} 구매 실패 환불`,
      deductionResult.consumptions,
      input.balanceBefore
    )
    throw error
  }

  return {
    order,
    priceCredits,
    itemTitle: item.title,
    alreadyCompleted: false,
    deductionResult,
  }
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
