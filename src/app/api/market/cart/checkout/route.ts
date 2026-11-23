import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot, selectDisplayBalance } from '@/lib/credit-balance'
import { guardMarketCartRequest, marketCartErrorResponse } from '@/lib/market-cart-server'
import { runMarketCheckout } from '@/lib/market-checkout-server'
import { isMarketV2PurchaseEnabled } from '@/lib/market-purchase'
import { checkMemberConsentForApi, consentBlockResponse } from '@/lib/consent-guard-server'
import { checkPurchaseNoticeAcknowledged, enforcePurchaseNoticeAck } from '@/lib/market-purchase-policy-server'

export const dynamic = 'force-dynamic'

const CheckoutBodySchema = z.object({
  items: z.array(z.object({
    cartItemId: z.string().uuid(),
    expectedCredits: z.number().int().positive().max(2147483647),
    acknowledgeNoDiscount: z.boolean().optional(),
  }).strict()).min(1).max(50),
  idempotencyKey: z.string().uuid(),
  acknowledgePurchaseNotice: z.boolean({ error: '구매 화면이 바뀌었습니다. 화면을 새로고침한 뒤 다시 구매해 주세요.' }),
  noticeSha256: z.string({ error: '구매 화면이 바뀌었습니다. 화면을 새로고침한 뒤 다시 구매해 주세요.' }).regex(/^[0-9a-f]{64}$/, '구매 안내 확인 값이 올바르지 않습니다. 화면을 새로고침한 뒤 다시 구매해 주세요.'),
}).strict()

export async function POST(request: NextRequest) {
  const guard = await guardMarketCartRequest()
  if ('response' in guard) {
    return guard.response
  }

  // 필수 약관 동의 확인(돈 API 의 실제 강제 — 인증 직후, 첫 쓰기·외부 호출 전)
  const consentBlock = await checkMemberConsentForApi()
  if (consentBlock) {
    return consentBlockResponse(consentBlock, 'structured')
  }

  const parsed = CheckoutBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return marketCartErrorResponse({
      status: 400,
      code: 'INVALID_INPUT',
      message: parsed.error.issues[0]?.message || '구매 요청이 올바르지 않습니다.',
    })
  }

  const noticeAckMissing = checkPurchaseNoticeAcknowledged(parsed.data.acknowledgePurchaseNotice)
  if (noticeAckMissing) {
    return marketCartErrorResponse(noticeAckMissing)
  }

  // 2.1: 기존 V2 kill switch는 RPC 호출 전에 cart 모드도 검사한다.
  if (!isMarketV2PurchaseEnabled()) {
    return marketCartErrorResponse({ status: 503, code: 'V2_PURCHASE_DISABLED', message: '현재 새 구매 기능이 일시 중지되어 있습니다.' })
  }

  // 구매 고지 동의 기록(판매 중지 검사 뒤, 결제 바로 앞). 기록하지 못하면 결제하지 않는다.
  const noticeFailure = await enforcePurchaseNoticeAck({
    userId: guard.userId,
    idempotencyKey: parsed.data.idempotencyKey,
    noticeSha256: parsed.data.noticeSha256,
  })
  if (noticeFailure) {
    return marketCartErrorResponse(noticeFailure)
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
