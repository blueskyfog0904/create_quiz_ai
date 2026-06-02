import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { CreditService } from '@/lib/credits'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot } from '@/lib/credit-balance'
import {
  createMarketPurchase,
  findCompletedMarketPurchase,
} from '@/lib/market-items-server'
import {
  buildMarketPurchaseInsert,
  buildMarketPurchaseResourceType,
  createMarketV2PurchaseWithCompensation,
  deductCreditsForMarketPurchase,
  ensureMarketItemIsPurchasable,
  getMarketPaidAssetLabel,
  getMarketPurchaseKindsToCheck,
  isMarketV2PurchaseEnabled,
  isMarketAssetCoveredByPurchaseKind,
  type MarketPaidAssetKind,
  type MarketV2PurchaseType,
} from '@/lib/market-purchase'

export const dynamic = 'force-dynamic'

const LegacyBodySchema = z.object({
  assetKind: z.enum(['pdf', 'hwp', 'zip']),
})

const V2BodySchema = z.object({
  purchaseType: z.enum(['subproduct', 'bundle']),
  subproductId: z.string().uuid().optional(),
  bundleOptionId: z.string().uuid().optional(),
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
}).superRefine((value, ctx) => {
  if (value.purchaseType === 'subproduct' && !value.subproductId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subproductId'], message: '서브상품을 선택해주세요.' })
  }

  if (value.purchaseType === 'bundle' && !value.bundleOptionId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['bundleOptionId'], message: '전체구매 옵션을 선택해주세요.' })
  }
})

interface RouteContext {
  params: Promise<{ itemId: string }>
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const supabase = await createClient()
  const { itemId } = await params
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const body = await request.json().catch(() => null)

  if (body && typeof body === 'object' && 'purchaseType' in body) {
    return handleMarketV2Purchase(user.id, itemId, body)
  }

  return handleLegacyMarketPurchase(user.id, itemId, body, supabase)
}

async function handleLegacyMarketPurchase(
  userId: string,
  itemId: string,
  body: unknown,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  let deductionResult: Awaited<ReturnType<typeof deductCreditsForMarketPurchase>> | null = null
  let purchaseContext: { assetKind: MarketPaidAssetKind; price: number; title: string } | null = null
  const balanceBefore = await CreditService.getBalance(userId)

  const rollback = async () => {
    if (!deductionResult || !purchaseContext) {
      return CreditService.getBalance(userId)
    }

    try {
      return await CreditService.refundCredits(
        userId,
        purchaseContext.price,
        buildMarketPurchaseResourceType(purchaseContext.assetKind),
        itemId,
        `${purchaseContext.title} ${getMarketPaidAssetLabel(purchaseContext.assetKind)} 구매 실패 환불`,
        deductionResult.consumptions,
        balanceBefore
      )
    } catch {
      const fallbackSnapshot = await getCreditBalanceSnapshot(userId, supabase)
      return fallbackSnapshot.displayBalance
    }
  }

  try {
    const parsed = LegacyBodySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '구매 요청이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const { item, price } = await ensureMarketItemIsPurchasable(itemId, parsed.data.assetKind)
    const purchaseKindsToCheck = getMarketPurchaseKindsToCheck(parsed.data.assetKind)
    const existingPurchases = await Promise.all(
      purchaseKindsToCheck.map((purchaseKind) => findCompletedMarketPurchase(
        userId,
        itemId,
        purchaseKind,
        item.workspace_subject
      ))
    )
    const existingPurchase = existingPurchases.find((purchase) => (
      purchase && isMarketAssetCoveredByPurchaseKind(parsed.data.assetKind, purchase.asset_kind as MarketPaidAssetKind)
    ))
    if (existingPurchase) {
      return NextResponse.json({
        success: false,
        error: { code: 'ALREADY_PURCHASED', message: '이미 구매한 파일입니다.' },
      }, { status: 409 })
    }

    purchaseContext = {
      assetKind: parsed.data.assetKind,
      price,
      title: item.title,
    }

    try {
      deductionResult = await deductCreditsForMarketPurchase(
        userId,
        item.id,
        item.title,
        parsed.data.assetKind,
        price
      )
    } catch (error) {
      const snapshot = await getCreditBalanceSnapshot(userId, supabase)
      return NextResponse.json({
        success: false,
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: error instanceof Error ? error.message : '크레딧이 부족합니다.',
        },
        ...buildCreditBalanceResponseFields(snapshot),
      }, { status: 402 })
    }

    const purchase = await createMarketPurchase({
      ...buildMarketPurchaseInsert(userId, item.id, parsed.data.assetKind, price, item.workspace_subject),
      credit_resource_id: item.id,
      credit_consumptions: deductionResult.consumptions,
    })

    const snapshot = await getCreditBalanceSnapshot(userId, supabase)

    return NextResponse.json({
      success: true,
      data: purchase,
      ...buildCreditBalanceResponseFields(snapshot),
      message: `${item.title} ${getMarketPaidAssetLabel(parsed.data.assetKind)} 구매가 완료되었습니다.`,
    })
  } catch (error) {
    if (deductionResult) {
      await rollback()
    } else {
      await CreditService.getBalance(userId)
    }
    const snapshot = await getCreditBalanceSnapshot(userId, supabase)
    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 구매 처리에 실패했습니다.',
      },
      ...buildCreditBalanceResponseFields(snapshot),
    }, { status: 500 })
  }
}

async function handleMarketV2Purchase(userId: string, itemId: string, body: unknown) {
  const supabase = await createClient()
  const parsed = V2BodySchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '구매 요청이 올바르지 않습니다.' },
    }, { status: 400 })
  }

  if (!isMarketV2PurchaseEnabled()) {
    return NextResponse.json({
      success: false,
      error: { code: 'V2_PURCHASE_DISABLED', message: '현재 새 구매 기능이 일시 중지되어 있습니다.' },
    }, { status: 503 })
  }

  const balanceBefore = await CreditService.getBalance(userId)

  try {
    const result = await createMarketV2PurchaseWithCompensation({
      userId,
      itemId,
      purchaseType: parsed.data.purchaseType as MarketV2PurchaseType,
      subproductId: parsed.data.subproductId,
      bundleOptionId: parsed.data.bundleOptionId,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      balanceBefore,
    })

    const snapshot = await getCreditBalanceSnapshot(userId, supabase)
    const purchaseLabel = parsed.data.purchaseType === 'bundle' ? '전체구매' : '서브상품'

    return NextResponse.json({
      success: true,
      data: result.order,
      alreadyCompleted: result.alreadyCompleted,
      purchaseType: parsed.data.purchaseType,
      priceCredits: result.priceCredits,
      ...buildCreditBalanceResponseFields(snapshot),
      message: `${result.itemTitle} ${purchaseLabel} 구매가 완료되었습니다.`,
    })
  } catch (error) {
    const snapshot = await getCreditBalanceSnapshot(userId, supabase)
    const message = error instanceof Error ? error.message : '문제마켓 구매 처리에 실패했습니다.'
    const status = /크레딧|부족/.test(message) ? 402 : /이미/.test(message) ? 409 : 500

    return NextResponse.json({
      success: false,
      error: {
        code: status === 402 ? 'INSUFFICIENT_CREDITS' : status === 409 ? 'ALREADY_PURCHASED' : 'INTERNAL_SERVER_ERROR',
        message,
      },
      ...buildCreditBalanceResponseFields(snapshot),
    }, { status })
  }
}
