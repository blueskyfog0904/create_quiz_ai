import type { TablesInsert } from '@/types/supabase'
import { CreditService, type DeductResult } from '@/lib/credits'
import {
  findCompletedMarketPurchase,
  getActiveMarketItemFile,
  getMarketItemById,
} from '@/lib/market-items-server'

export type MarketPaidAssetKind = 'pdf' | 'hwp'
export type MarketAssetKind = 'sample' | MarketPaidAssetKind

export function buildMarketPurchaseResourceType(assetKind: MarketPaidAssetKind) {
  return assetKind === 'pdf' ? 'market_purchase_pdf' : 'market_purchase_hwp'
}

export function resolveMarketAssetPrice(
  item: { pdf_price: number; hwp_price: number },
  assetKind: MarketPaidAssetKind
) {
  return assetKind === 'pdf' ? item.pdf_price : item.hwp_price
}

export async function ensureMarketItemIsPurchasable(itemId: string, assetKind: MarketPaidAssetKind) {
  const item = await getMarketItemById(itemId)
  if (!item || item.deleted_at !== null || item.is_active === false || item.status !== 'published') {
    throw new Error('구매 가능한 문제마켓 상품을 찾을 수 없습니다.')
  }

  const file = await getActiveMarketItemFile(itemId, assetKind)
  if (!file) {
    throw new Error('요청한 파일 자산을 찾을 수 없습니다.')
  }

  const price = resolveMarketAssetPrice(item, assetKind)
  if (price <= 0) {
    throw new Error('유효한 가격이 설정되지 않았습니다.')
  }

  return { item, file, price }
}

export async function ensureUserDoesNotOwnMarketAsset(userId: string, itemId: string, assetKind: MarketPaidAssetKind) {
  const purchase = await findCompletedMarketPurchase(userId, itemId, assetKind)
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
    `${itemTitle} ${assetKind.toUpperCase()} 구매`
  )
}

export function buildMarketPurchaseInsert(
  userId: string,
  itemId: string,
  assetKind: MarketPaidAssetKind,
  price: number
): TablesInsert<'market_purchases'> {
  return {
    user_id: userId,
    item_id: itemId,
    asset_kind: assetKind,
    price_credits: price,
    status: 'completed',
    credit_resource_type: buildMarketPurchaseResourceType(assetKind),
    credit_resource_id: null,
  }
}
