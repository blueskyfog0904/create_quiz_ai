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
  checkoutAttemptId: z.string().uuid(),
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

    const admin = createPaymentAdminClient()
    const { data: runtimeRows, error: runtimeError } = await admin
      .from('payment_runtime_config')
      .select(`
        accepted_provider_environment,
        master_accepts_new_orders,
        toss_accepts_new_orders,
        toss_merchant_id
      `)
      .eq('id', true)
      .limit(2)

    const runtimeConfig = runtimeRows?.[0]
    if (
      runtimeError ||
      runtimeRows?.length !== 1 ||
      !runtimeConfig?.master_accepts_new_orders ||
      !runtimeConfig.toss_accepts_new_orders ||
      runtimeConfig.accepted_provider_environment !== tossConfig.environment ||
      runtimeConfig.toss_merchant_id !== tossConfig.mid
    ) {
      return NextResponse.json(
        {
          error: '현재 포인트 충전 기능을 준비 중입니다.',
          code: 'PAYMENT_RUNTIME_GATE_CLOSED',
        },
        { status: 503 }
      )
    }

    const taxFreeAmount = 0
    const vatAmount = Math.round(plan.price / 11)
    const requestFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        userId: user.id,
        planId: plan.id,
        provider: 'toss',
        amount: plan.price,
        credits: plan.credits,
        taxFreeAmount,
        vatAmount,
        environment: tossConfig.environment,
        merchantId: tossConfig.mid,
      }))
      .digest('hex')
    const orderId = createPublicOrderId()
    const expiresAt = new Date(
      Date.now() + PAYMENT_ORDER_TTL_MINUTES * 60_000
    ).toISOString()
    const { data: preparedData, error: prepareError } = await admin.rpc(
      'prepare_payment_order',
      {
        p_user_id: user.id,
        p_checkout_attempt_id: parsed.data.checkoutAttemptId,
        p_provider: 'toss',
        p_plan_id: plan.id,
        p_order_id: orderId,
        p_plan_name_snapshot: plan.name,
        p_expected_amount: plan.price,
        p_expected_credits: plan.credits,
        p_provider_environment: tossConfig.environment,
        p_provider_merchant_id: tossConfig.mid,
        p_request_fingerprint: requestFingerprint,
        p_confirm_idempotency_key: crypto.randomUUID(),
        p_cancel_idempotency_key: crypto.randomUUID(),
        p_expires_at: expiresAt,
        p_tax_free_amount: taxFreeAmount,
        p_vat_amount: vatAmount,
        p_partner_user_id: '',
      }
    )

    if (prepareError) {
      if (prepareError.message.includes('PAYMENT_ATTEMPT_PAYLOAD_CONFLICT')) {
        return NextResponse.json(
          {
            error: '동일한 결제 시도에 다른 상품 또는 결제수단을 사용할 수 없습니다.',
            code: 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT',
          },
          { status: 409 }
        )
      }

      console.error('[PaymentOrder] Failed to prepare order', {
        userId: user.id,
        errorCode: prepareError.code,
      })
      return NextResponse.json(
        { error: '결제 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }

    const preparedOrder = Array.isArray(preparedData)
      ? preparedData[0]
      : preparedData

    if (!preparedOrder) {
      return NextResponse.json(
        { error: '결제 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      orderId: preparedOrder.order_id,
      orderName: `${plan.name} (${plan.credits.toLocaleString()} 크레딧)`,
      amount: preparedOrder.expected_amount,
      credits: preparedOrder.expected_credits,
      expiresAt: preparedOrder.expires_at,
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
