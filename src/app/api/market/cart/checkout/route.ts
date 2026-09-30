import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot, selectDisplayBalance } from '@/lib/credit-balance'
import { guardMarketCartRequest, marketCartErrorResponse } from '@/lib/market-cart-server'
import { runMarketCheckout } from '@/lib/market-checkout-server'
import { isMarketV2PurchaseEnabled } from '@/lib/market-purchase'

export const dynamic = 'force-dynamic'

const CheckoutBodySchema = z.object({
  items: z.array(z.object({
    cartItemId: z.string().uuid(),
    expectedCredits: z.number().int().positive().max(2147483647),
    acknowledgeNoDiscount: z.boolean().optional(),
  }).strict()).min(1).max(50),
  idempotencyKey: z.string().uuid(),
}).strict()

export async function POST(request: NextRequest) {
  const guard = await guardMarketCartRequest()
  if ('response' in guard) {
    return guard.response
  }

  const parsed = CheckoutBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return marketCartErrorResponse({
      status: 400,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message || '구매 요청이 올바르지 않습니다.',
    })
  }

  // 2.1: 기존 V2 kill switch는 RPC 호출 전에 cart 모드도 검사한다.
  if (!isMarketV2PurchaseEnabled()) {
    return marketCartErrorResponse({ status: 503, code: 'V2_PURCHASE_DISABLED', message: '현재 새 구매 기능이 일시 중지되어 있습니다.' })
  }

  // cart 행 해석·가격 계산은 RPC가 잠금 하에 한다. 입력을 그대로 넘긴다(3.2).
  const outcome = await runMarketCheckout({
    userId: guard.userId,
    mode: 'cart',
    itemId: null,
    lines: parsed.data.items.map((line) => ({
      cartItemId: line.cartItemId,
      expectedCredits: line.expectedCredits,
      acknowledgeNoDiscount: line.acknowledgeNoDiscount ?? false,
    })),
    idempotencyKey: parsed.data.idempotencyKey,
  })

  if (!outcome.ok) {
    // 402는 사전 확인(details 있음)과 consume 단계 P0402(details 없음) 모두 code로만 판단해 최신 잔액·필요액을 넣는다.
    if (outcome.code === 'INSUFFICIENT_CREDITS') {
      const availableCredits = selectDisplayBalance(guard.userId, await getCreditBalanceSnapshot(guard.userId))
      const requiredCredits = parsed.data.items.reduce((total, line) => total + line.expectedCredits, 0)
      return marketCartErrorResponse({
        ...outcome,
        details: {
          ...outcome.details,
          availableCredits,
          requiredCredits,
          shortfall: Math.max(requiredCredits - availableCredits, 0),
        },
      })
    }
    return marketCartErrorResponse(outcome)
  }

  const snapshot = await getCreditBalanceSnapshot(guard.userId)

  return NextResponse.json({
    success: true,
    data: outcome.receipt,
    alreadyCompleted: outcome.receipt.alreadyCompleted,
    ...buildCreditBalanceResponseFields(snapshot),
    message: `선택한 자료 ${outcome.receipt.orders.length}건 구매가 완료되었습니다.`,
  })
}
