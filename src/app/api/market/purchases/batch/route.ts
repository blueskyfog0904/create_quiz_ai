import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { CreditService } from '@/lib/credits'
import { DEFAULT_WORKSPACE_SUBJECT } from '@/lib/workspace-subject'
import {
  createMarketPurchases,
  findCompletedMarketPurchase,
} from '@/lib/market-items-server'
import {
  buildMarketPurchaseInsert,
  ensureMarketItemIsPurchasable,
  type MarketPaidAssetKind,
} from '@/lib/market-purchase'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  selections: z.array(z.object({
    itemId: z.uuid(),
    assetKind: z.enum(['pdf', 'hwp']),
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
      return CreditService.getBalance(user.id)
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

    const dedupedSelections = Array.from(
      new Map(parsed.data.selections.map((selection) => [`${selection.itemId}:${selection.assetKind}`, selection])).values()
    )

    const purchaseTargets: Array<{
      itemId: string
      assetKind: MarketPaidAssetKind
      title: string
      price: number
      workspaceSubject: 'english' | 'korean'
    }> = []

    for (const selection of dedupedSelections) {
      const existingPurchase = await findCompletedMarketPurchase(
        user.id,
        selection.itemId,
        selection.assetKind,
        DEFAULT_WORKSPACE_SUBJECT
      )
      if (existingPurchase) {
        return NextResponse.json({
          success: false,
          error: { code: 'ALREADY_PURCHASED', message: '이미 구매한 파일이 포함되어 있습니다.' },
        }, { status: 409 })
      }

      const { item, price } = await ensureMarketItemIsPurchasable(
        selection.itemId,
        selection.assetKind,
        DEFAULT_WORKSPACE_SUBJECT
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
      const currentBalance = await CreditService.getBalance(user.id)
      return NextResponse.json({
        success: false,
        error: {
          code: 'INSUFFICIENT_CREDITS',
          message: error instanceof Error ? error.message : '크레딧이 부족합니다.',
        },
        balance: currentBalance,
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

    return NextResponse.json({
      success: true,
      data: purchases,
      balance: deductionResult.newBalance,
      message: `선택한 파일 ${purchaseTargets.length}건 구매가 완료되었습니다.`,
    })
  } catch (error) {
    const currentBalance = deductionResult ? await rollback() : await CreditService.getBalance(user.id)

    return NextResponse.json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : '문제마켓 일괄 구매 처리에 실패했습니다.',
      },
      balance: currentBalance,
    }, { status: 500 })
  }
}
