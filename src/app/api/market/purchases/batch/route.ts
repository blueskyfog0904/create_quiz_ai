import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { CreditService } from '@/lib/credits'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot } from '@/lib/credit-balance'
import {
  createMarketPurchases,
  findCompletedMarketPurchase,
  rollbackMarketPurchases,
} from '@/lib/market-items-server'
import {
  buildMarketPurchaseInsert,
  ensureMarketItemIsPurchasable,
  getMarketPaidAssetLabel,
  getMarketPurchaseKindsToCheck,
  isMarketAssetCoveredByPurchaseKind,
  normalizeMarketBundleSelections,
  type MarketPaidAssetKind,
} from '@/lib/market-purchase'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  selections: z.array(z.object({
    itemId: z.uuid(),
    assetKind: z.enum(['pdf', 'hwp', 'zip']),
  })).min(1, '최소 1개 이상의 파일을 선택해주세요.'),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ success: false, error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' } }, { status: 401 })
  }

  const balanceBefore = await CreditService.getBalance(user.id)
  let deductionResult: Awaited<ReturnType<typeof CreditService.deductCredits>> | null = null
  let totalPrice = 0
  let createdPurchaseIds: string[] = []

  const rollback = async () => {
    if (!deductionResult || totalPrice <= 0) {
      return CreditService.getBalance(user.id)
    }

    try {
      return await CreditService.refundCredits(
        user.id,
        totalPrice,
        'market_purchase_batch',
        null,
        '문제마켓 일괄 구매 실패 환불',
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
        error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '일괄 구매 요청이 올바르지 않습니다.' },
      }, { status: 400 })
    }

    const dedupedSelections = normalizeMarketBundleSelections(parsed.data.selections)

    const purchaseTargets: Array<{
      itemId: string
      assetKind: MarketPaidAssetKind
      title: string
      price: number
      workspaceSubject: 'english' | 'korean'
    }> = []

    for (const selection of dedupedSelections) {
      const purchaseKindsToCheck = getMarketPurchaseKindsToCheck(selection.assetKind)
      const existingPurchases = await Promise.all(
        purchaseKindsToCheck.map((purchaseKind) => findCompletedMarketPurchase(
          user.id,
          selection.itemId,
          purchaseKind
        ))
      )
      const existingPurchase = existingPurchases.find((purchase) => (
        purchase && isMarketAssetCoveredByPurchaseKind(selection.assetKind, purchase.asset_kind as MarketPaidAssetKind)
      ))
      if (existingPurchase) {
        return NextResponse.json({
          success: false,
          error: { code: 'ALREADY_PURCHASED', message: '이미 구매한 파일이 포함되어 있습니다.' },
        }, { status: 409 })
      }

      const { item, price } = await ensureMarketItemIsPurchasable(
        selection.itemId,
        selection.assetKind
      )
      purchaseTargets.push({
        itemId: item.id,
        assetKind: selection.assetKind,
        title: item.title,
        price,
        workspaceSubject: item.workspace_subject,
      })
    }

    totalPrice = purchaseTargets.reduce((sum, target) => sum + target.price, 0)

    try {
      deductionResult = await CreditService.deductCredits(
        user.id,
        totalPrice,
        'market_purchase_batch',
        null,
        `문제마켓 선택 파일 ${purchaseTargets.length}건 구매`
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

    const purchases = await createMarketPurchases(
      purchaseTargets.map((target) => ({
        ...buildMarketPurchaseInsert(
          user.id,
          target.itemId,
          target.assetKind,
          target.price,
          target.workspaceSubject
        ),
        credit_resource_id: target.itemId,
      }))
    )
    createdPurchaseIds = purchases.map((purchase) => purchase.id)

    const snapshot = await getCreditBalanceSnapshot(user.id, supabase)

    return NextResponse.json({
      success: true,
      data: purchases,
      ...buildCreditBalanceResponseFields(snapshot),
      message: `선택한 파일 ${purchaseTargets.map((target) => getMarketPaidAssetLabel(target.assetKind)).join(', ')} 구매가 완료되었습니다.`,
    })
  } catch (error) {
    let purchaseRollbackError: Error | null = null
    if (deductionResult) {
      if (createdPurchaseIds.length > 0) {
        try {
          await rollbackMarketPurchases(createdPurchaseIds, user.id)
        } catch (rollbackError) {
          purchaseRollbackError = rollbackError instanceof Error
            ? rollbackError
            : new Error('구매 내역 롤백에 실패했습니다.')
          console.error('Failed to rollback market purchases after batch purchase failure', purchaseRollbackError)
        }
      }
      await rollback()
    } else {
      await CreditService.getBalance(user.id)
    }
    const snapshot = await getCreditBalanceSnapshot(user.id, supabase)

    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: purchaseRollbackError
          ? `${error instanceof Error ? error.message : '문제마켓 일괄 구매 처리에 실패했습니다.'} 구매 내역 롤백 실패: ${purchaseRollbackError.message}`
          : error instanceof Error ? error.message : '문제마켓 일괄 구매 처리에 실패했습니다.',
      },
      ...buildCreditBalanceResponseFields(snapshot),
    }, { status: 500 })
  }
}
