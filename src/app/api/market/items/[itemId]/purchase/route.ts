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
  deductCreditsForMarketPurchase,
  ensureMarketItemIsPurchasable,
  type MarketPaidAssetKind,
} from '@/lib/market-purchase'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  assetKind: z.enum(['pdf', 'hwp']),
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

  let deductionResult: Awaited<ReturnType<typeof deductCreditsForMarketPurchase>> | null = null
  let purchaseContext: { assetKind: MarketPaidAssetKind; price: number; title: string } | null = null
  const balanceBefore = await CreditService.getBalance(user.id)

  const rollback = async () => {
    if (!deductionResult || !purchaseContext) {
      return CreditService.getBalance(user.id)
    }

    try {
      return await CreditService.refundCredits(
        user.id,
        purchaseContext.price,
        purchaseContext.assetKind === 'pdf' ? 'market_purchase_pdf' : 'market_purchase_hwp',
        itemId,
        `${purchaseContext.title} ${purchaseContext.assetKind.toUpperCase()} 구매 실패 환불`,
        deductionResult.consumptions,
        balanceBefore
      )
    } catch {
      const fallbackSnapshot = await getCreditBalanceSnapshot(user.id, supabase)
      return fallbackSnapshot.displayBalance
    }
  }

  try {
    const body = await request.json()
    const parsed = BodySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '구매 요청이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const { item, price } = await ensureMarketItemIsPurchasable(itemId, parsed.data.assetKind)
    const existingPurchase = await findCompletedMarketPurchase(
      user.id,
      itemId,
      parsed.data.assetKind,
      item.workspace_subject
    )
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
        user.id,
        item.id,
        item.title,
        parsed.data.assetKind,
        price
      )
    } catch (error) {
      const snapshot = await getCreditBalanceSnapshot(user.id, supabase)
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
      ...buildMarketPurchaseInsert(user.id, item.id, parsed.data.assetKind, price, item.workspace_subject),
      credit_resource_id: item.id,
    })

    const snapshot = await getCreditBalanceSnapshot(user.id, supabase)

    return NextResponse.json({
      success: true,
      data: purchase,
      ...buildCreditBalanceResponseFields(snapshot),
      message: `${item.title} ${parsed.data.assetKind.toUpperCase()} 구매가 완료되었습니다.`,
    })
  } catch (error) {
    if (deductionResult) {
      await rollback()
    } else {
      await CreditService.getBalance(user.id)
    }
    const snapshot = await getCreditBalanceSnapshot(user.id, supabase)
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
