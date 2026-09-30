import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { buildCreditBalanceResponseFields, getCreditBalanceSnapshot } from '@/lib/credit-balance'
import { isMarketV2PurchaseEnabled } from '@/lib/market-purchase'
import { runMarketCheckout } from '@/lib/market-checkout-server'

export const dynamic = 'force-dynamic'

const DirectTargetSchema = z.discriminatedUnion('targetKind', [
  z.object({ targetKind: z.literal('subproduct'), subproductId: z.string().uuid() }).strict(),
  z.object({ targetKind: z.literal('bundle'), bundleOptionId: z.string().uuid() }).strict(),
])

const DirectBodySchema = z.object({
  lines: z.array(z.object({
    target: DirectTargetSchema,
    expectedCredits: z.number().int().positive().max(2147483647),
    acknowledgeNoDiscount: z.boolean().optional(),
  }).strict()).min(1).max(50),
  idempotencyKey: z.string().uuid(),
}).strict()

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

  if (body && typeof body === 'object' && 'assetKind' in body) {
    return NextResponse.json({
      success: false,
      error: { code: 'LEGACY_PURCHASE_CLOSED', message: '이 구매 방식은 더 이상 지원하지 않습니다. 화면을 새로고침한 뒤 다시 구매해주세요.' },
    }, { status: 410 })
  }

  const parsed = DirectBodySchema.safeParse(body)

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

  if (!z.string().uuid().safeParse(itemId).success) {
    return NextResponse.json({
      success: false,
      error: { code: 'NOT_FOUND', message: '구매 가능한 문제마켓 상품을 찾을 수 없습니다.' },
    }, { status: 404 })
  }

  const outcome = await runMarketCheckout({
    userId: user.id,
    mode: 'direct',
    itemId,
    lines: parsed.data.lines.map(({ target, expectedCredits, acknowledgeNoDiscount }) => ({
      targetKind: target.targetKind,
      targetId: target.targetKind === 'bundle' ? target.bundleOptionId : target.subproductId,
      expectedCredits,
      acknowledgeNoDiscount: acknowledgeNoDiscount ?? false,
    })),
    idempotencyKey: parsed.data.idempotencyKey,
  })

  if (!outcome.ok) {
    return NextResponse.json({
      success: false,
      error: { code: outcome.code, message: outcome.message },
      details: outcome.details,
    }, { status: outcome.status })
  }

  const snapshot = await getCreditBalanceSnapshot(user.id, supabase)
  const order = outcome.receipt.orders[0]

  return NextResponse.json({
    success: true,
    data: outcome.receipt,
    alreadyCompleted: outcome.receipt.alreadyCompleted,
    ...buildCreditBalanceResponseFields(snapshot),
    message: `${order?.itemTitle ?? '문제마켓 상품'} 자료 ${outcome.receipt.orders.length}건 구매가 완료되었습니다.`,
  })
}
