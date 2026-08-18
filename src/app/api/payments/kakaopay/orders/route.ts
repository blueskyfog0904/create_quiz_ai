import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createKakaoPartnerUserId,
  createOpaqueToken,
  hashOpaqueToken,
  KAKAOPAY_READY_TTL_MINUTES,
} from '@/lib/kakaopay-checkout-server'
import {
  assertKakaoPayReady,
  KakaoPayError,
  readyKakaoPayPayment,
} from '@/lib/kakaopay-server'
import { MAX_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import {
  createPaymentAdminClient,
  type PaymentOrderRow,
} from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const KAKAOPAY_PAYMENT_METHOD = 'MONEY'

const prepareKakaoPayOrderSchema = z.object({
  planId: z.string().uuid(),
  checkoutAttemptId: z.string().uuid(),
}).strict()

function createPublicOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase()
  const entropy = crypto.randomUUID().replaceAll('-', '').toUpperCase()
  return `KAKAO_${timestamp}_${entropy}`
}

function pendingResponse(order: PaymentOrderRow) {
  return NextResponse.json(
    {
      status: 'preparing',
      orderId: order.order_id,
      amount: order.expected_amount,
      credits: order.expected_credits,
      expiresAt: order.ready_expires_at,
    },
    { status: 202 }
  )
}

async function storedReadyResponse(
  admin: ReturnType<typeof createPaymentAdminClient>,
  order: PaymentOrderRow
) {
  const { data, error } = await admin
    .from('payment_provider_transactions')
    .select(`
      next_redirect_pc_url,
      next_redirect_mobile_url,
      next_redirect_app_url
    `)
    .eq('payment_order_id', order.id)
    .maybeSingle()

  if (
    error ||
    !data?.next_redirect_pc_url ||
    !data.next_redirect_mobile_url ||
    !data.next_redirect_app_url
  ) {
    return pendingResponse(order)
  }

  return NextResponse.json({
    status: 'ready',
    orderId: order.order_id,
    orderName: `${order.plan_name_snapshot} (${order.expected_credits.toLocaleString()} 크레딧)`,
    amount: order.expected_amount,
    credits: order.expected_credits,
    expiresAt: order.ready_expires_at,
    nextRedirectPcUrl: data.next_redirect_pc_url,
    nextRedirectMobileUrl: data.next_redirect_mobile_url,
    nextRedirectAppUrl: data.next_redirect_app_url,
  })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const parsed = prepareKakaoPayOrderSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: '유효한 충전 상품을 선택해 주세요.' },
      { status: 400 }
    )
  }

  let preparedOrder: PaymentOrderRow | null = null
  let readyClaimed = false

  try {
    const kakaoConfig = assertKakaoPayReady()
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
        kakaopay_accepts_new_orders,
        kakaopay_merchant_id
      `)
      .eq('id', true)
      .limit(2)
    const runtimeConfig = runtimeRows?.[0]

    if (
      runtimeError ||
      runtimeRows?.length !== 1 ||
      !runtimeConfig?.master_accepts_new_orders ||
      !runtimeConfig.kakaopay_accepts_new_orders ||
      runtimeConfig.accepted_provider_environment !== kakaoConfig.environment ||
      runtimeConfig.kakaopay_merchant_id !== kakaoConfig.cid
    ) {
      return NextResponse.json(
        {
          error: '현재 카카오페이 충전 기능을 준비 중입니다.',
          code: 'PAYMENT_RUNTIME_GATE_CLOSED',
        },
        { status: 503 }
      )
    }

    const partnerUserId = createKakaoPartnerUserId(user.id)
    const taxFreeAmount = 0
    const vatAmount = Math.round(plan.price / 11)
    const requestFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        userId: user.id,
        planId: plan.id,
        provider: 'kakaopay',
        paymentMethod: KAKAOPAY_PAYMENT_METHOD,
        amount: plan.price,
        credits: plan.credits,
        taxFreeAmount,
        vatAmount,
        environment: kakaoConfig.environment,
        merchantId: kakaoConfig.cid,
        partnerUserId,
      }))
      .digest('hex')
    const orderId = createPublicOrderId()
    const expiresAt = new Date(
      Date.now() + KAKAOPAY_READY_TTL_MINUTES * 60_000
    ).toISOString()
    const { data: preparedData, error: prepareError } = await admin.rpc(
      'prepare_payment_order',
      {
        p_user_id: user.id,
        p_checkout_attempt_id: parsed.data.checkoutAttemptId,
        p_provider: 'kakaopay',
        p_plan_id: plan.id,
        p_order_id: orderId,
        p_plan_name_snapshot: plan.name,
        p_expected_amount: plan.price,
        p_expected_credits: plan.credits,
        p_provider_environment: kakaoConfig.environment,
        p_provider_merchant_id: kakaoConfig.cid,
        p_request_fingerprint: requestFingerprint,
        p_confirm_idempotency_key: crypto.randomUUID(),
        p_cancel_idempotency_key: crypto.randomUUID(),
        p_expires_at: expiresAt,
        p_tax_free_amount: taxFreeAmount,
        p_vat_amount: vatAmount,
        p_partner_user_id: partnerUserId,
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

      console.error('[KakaoPayOrder] Failed to prepare order', {
        userId: user.id,
        errorCode: prepareError.code,
      })
      return NextResponse.json(
        { error: '카카오페이 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }

    const prepared = Array.isArray(preparedData)
      ? preparedData[0]
      : preparedData
    if (!prepared) {
      return NextResponse.json(
        { error: '카카오페이 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }
    preparedOrder = prepared as PaymentOrderRow

    if (preparedOrder.status === 'ready') {
      return storedReadyResponse(admin, preparedOrder)
    }
    if (preparedOrder.status === 'ready_unknown') {
      return pendingResponse(preparedOrder)
    }
    if (preparedOrder.status !== 'preparing' || !preparedOrder.ready_expires_at) {
      return NextResponse.json(
        { error: '현재 다시 사용할 수 없는 결제 시도입니다.' },
        { status: 409 }
      )
    }

    const callbackState = createOpaqueToken()
    const { data: claimData, error: claimError } = await admin.rpc(
      'begin_kakaopay_ready',
      {
        p_payment_order_id: preparedOrder.id,
        p_callback_state_hash: hashOpaqueToken(callbackState),
        p_callback_state_expires_at: preparedOrder.ready_expires_at,
      }
    )

    if (claimError) {
      console.error('[KakaoPayOrder] Failed to claim ready request', {
        orderId: preparedOrder.order_id,
        errorCode: claimError.code,
      })
      return NextResponse.json(
        { error: '카카오페이 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }

    const claim = claimData as { claimed?: boolean; status?: string } | null
    if (!claim?.claimed) {
      if (claim?.status === 'ready') {
        return storedReadyResponse(admin, preparedOrder)
      }
      return pendingResponse(preparedOrder)
    }
    readyClaimed = true

    const callbackBase = kakaoConfig.callbackOrigin
    const callbackQuery = `state=${encodeURIComponent(callbackState)}`
    const ready = await readyKakaoPayPayment({
      partnerOrderId: preparedOrder.partner_order_id ?? preparedOrder.order_id,
      partnerUserId,
      itemName: `${plan.name} (${plan.credits.toLocaleString()} 크레딧)`,
      itemCode: plan.id,
      totalAmount: preparedOrder.expected_amount,
      taxFreeAmount: preparedOrder.tax_free_amount,
      vatAmount: preparedOrder.vat_amount ?? vatAmount,
      approvalUrl: `${callbackBase}/api/payments/kakaopay/callback/approve?${callbackQuery}`,
      cancelUrl: `${callbackBase}/api/payments/kakaopay/callback/cancel?${callbackQuery}`,
      failUrl: `${callbackBase}/api/payments/kakaopay/callback/fail?${callbackQuery}`,
    })

    const { error: storeError } = await admin.rpc('store_kakaopay_ready', {
      p_payment_order_id: preparedOrder.id,
      p_provider_transaction_id: ready.tid,
      p_next_redirect_pc_url: ready.next_redirect_pc_url,
      p_next_redirect_mobile_url: ready.next_redirect_mobile_url,
      p_next_redirect_app_url: ready.next_redirect_app_url,
      p_ready_stored_at: ready.created_at,
    })

    if (storeError) {
      console.error('[KakaoPayOrder] Ready result requires reconciliation', {
        orderId: preparedOrder.order_id,
        errorCode: storeError.code,
      })
      return pendingResponse(preparedOrder)
    }

    return NextResponse.json({
      status: 'ready',
      orderId: preparedOrder.order_id,
      orderName: `${plan.name} (${plan.credits.toLocaleString()} 크레딧)`,
      amount: preparedOrder.expected_amount,
      credits: preparedOrder.expected_credits,
      expiresAt: preparedOrder.ready_expires_at,
      nextRedirectPcUrl: ready.next_redirect_pc_url,
      nextRedirectMobileUrl: ready.next_redirect_mobile_url,
      nextRedirectAppUrl: ready.next_redirect_app_url,
    })
  } catch (error) {
    if (
      readyClaimed &&
      preparedOrder &&
      error instanceof KakaoPayError &&
      error.outcome === 'definite_failure'
    ) {
      const admin = createPaymentAdminClient()
      await admin.rpc('mark_kakaopay_callback_failure', {
        p_payment_order_id: preparedOrder.id,
        p_failure_code: error.code,
        p_failure_message: '카카오페이 주문을 준비하지 못했습니다.',
        p_manual_review: false,
      })
    }

    if (error instanceof KakaoPayError) {
      if (error.outcome === 'outcome_unknown' && preparedOrder) {
        return pendingResponse(preparedOrder)
      }
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    console.error('[KakaoPayOrder] Unexpected preparation failure')
    return NextResponse.json(
      { error: '카카오페이 주문을 준비하지 못했습니다.' },
      { status: 500 }
    )
  }
}
