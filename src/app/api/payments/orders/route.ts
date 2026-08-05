import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { MAX_POINT_CHARGE_AMOUNT, PAYMENT_ORDER_TTL_MINUTES } from '@/lib/payment-constants'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import {
  assertTossPaymentsReady,
  TossPaymentsError,
} from '@/lib/toss-payments-server'

export const dynamic = 'force-dynamic'

const preparePaymentOrderSchema = z.object({
  planId: z.string().uuid(),
}).strict()

function createPublicOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase()
  const entropy = crypto.randomUUID().replaceAll('-', '').toUpperCase()
  return `POINT_${timestamp}_${entropy}`
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const parsed = preparePaymentOrderSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: '유효한 충전 상품을 선택해 주세요.' },
      { status: 400 }
    )
  }

  try {
    const tossConfig = assertTossPaymentsReady()
    const { data: plan, error: planError } = await supabase
      .from('pricing_plans')
      .select('id, name, price, credits')
      .eq('id', parsed.data.planId)
      .eq('is_active', true)
      .single()

    if (planError || !plan) {
      return NextResponse.json(
        { error: '판매 중인 충전 상품을 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    if (
      !Number.isInteger(plan.price) ||
      plan.price < 1 ||
      plan.price > MAX_POINT_CHARGE_AMOUNT ||
      !Number.isInteger(plan.credits) ||
      plan.credits < 1
    ) {
      return NextResponse.json(
        { error: '충전 상품 금액 또는 크레딧 설정을 확인해 주세요.' },
        { status: 400 }
      )
    }

    const orderId = createPublicOrderId()
    const expiresAt = new Date(
      Date.now() + PAYMENT_ORDER_TTL_MINUTES * 60_000
    ).toISOString()
    const admin = createPaymentAdminClient()
    const { error: insertError } = await admin
      .from('payment_orders')
      .insert({
        user_id: user.id,
        order_id: orderId,
        plan_id: plan.id,
        plan_name_snapshot: plan.name,
        expected_amount: plan.price,
        expected_credits: plan.credits,
        provider: 'toss',
        environment: tossConfig.environment,
        mid: tossConfig.mid,
        status: 'ready',
        confirm_idempotency_key: crypto.randomUUID(),
        cancel_idempotency_key: crypto.randomUUID(),
        expires_at: expiresAt,
      })

    if (insertError) {
      console.error('[PaymentOrder] Failed to prepare order', {
        userId: user.id,
        errorCode: insertError.code,
      })
      return NextResponse.json(
        { error: '결제 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      orderId,
      orderName: `${plan.name} (${plan.credits.toLocaleString()} 크레딧)`,
      amount: plan.price,
      credits: plan.credits,
      expiresAt,
    })
  } catch (error) {
    if (error instanceof TossPaymentsError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    console.error('[PaymentOrder] Unexpected preparation failure')
    return NextResponse.json(
      { error: '결제 주문을 준비하지 못했습니다.' },
      { status: 500 }
    )
  }
}
