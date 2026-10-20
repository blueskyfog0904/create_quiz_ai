import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  MAX_POINT_CHARGE_AMOUNT,
  PAYMENT_ORDER_TTL_MINUTES,
} from '@/lib/payment-constants'
import {
  classifyExistingPayAppOrder,
  formatProfilePhone,
} from '@/lib/payapp-order-status'
import {
  assertPayAppReady,
  PayAppError,
  requestPayAppPayment,
} from '@/lib/payapp-server'
import {
  createPaymentAdminClient,
  type PaymentOrderRow,
} from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/types/supabase'

export const dynamic = 'force-dynamic'

type PaymentAdminClient = ReturnType<typeof createPaymentAdminClient>
type PrepareOrderArgs = Database['public']['Functions']['prepare_payment_order']['Args']

const PHONE_PATTERN = /^01[016789][0-9]{7,8}$/

const preparePayAppOrderSchema = z.object({
  planId: z.string().uuid(),
  checkoutAttemptId: z.string().uuid(),
  paymentMethodCode: z.string().regex(/^[a-z_]{1,40}$/),
  phone: z.string().trim().max(20),
  savePhone: z.boolean().optional(),
}).strict()

function createPublicOrderId() {
  const timestamp = Date.now().toString(36).toUpperCase()
  const entropy = crypto.randomUUID().replaceAll('-', '').toUpperCase()
  return `PAYAPP_${timestamp}_${entropy}`
}

function resultPath(order: PaymentOrderRow) {
  return `/checkout/payapp/result?orderId=${encodeURIComponent(order.order_id)}`
}

function attemptUnknownResponse() {
  return NextResponse.json(
    {
      error: '결제 요청을 확인하지 못했습니다. 다시 시도해 주세요.',
      code: 'PAYMENT_ATTEMPT_UNKNOWN',
    },
    { status: 409 }
  )
}

function attemptExpiredResponse() {
  return NextResponse.json(
    {
      error: '만료된 결제 시도입니다. 다시 시도해 주세요.',
      code: 'PAYMENT_ATTEMPT_EXPIRED',
    },
    { status: 409 }
  )
}

function readyResponse(order: PaymentOrderRow, payUrl: string) {
  return NextResponse.json({
    status: 'ready',
    orderId: order.order_id,
    amount: order.expected_amount,
    credits: order.expected_credits,
    expiresAt: order.ready_expires_at,
    payUrl,
  })
}

// 같은 결제 시도로 다시 요청하면 저장된 결제창을 다시 쓴다. 곧 만료되면 쓰지 않는다.
async function storedReadyResponse(admin: PaymentAdminClient, order: PaymentOrderRow) {
  if (classifyExistingPayAppOrder(order.status, order.ready_expires_at, Date.now()) !== 'reuse_payurl') {
    return attemptExpiredResponse()
  }

  const { data, error } = await admin
    .from('payment_provider_transactions')
    .select('next_redirect_pc_url')
    .eq('payment_order_id', order.id)
    .maybeSingle()

  if (error || !data?.next_redirect_pc_url) {
    return attemptUnknownResponse()
  }

  return readyResponse(order, data.next_redirect_pc_url)
}

function existingOrderResponse(admin: PaymentAdminClient, order: PaymentOrderRow) {
  switch (classifyExistingPayAppOrder(order.status, order.ready_expires_at, Date.now())) {
    case 'reuse_payurl':
      return storedReadyResponse(admin, order)
    case 'show_result':
      return NextResponse.json({
        status: 'result',
        orderId: order.order_id,
        resultUrl: resultPath(order),
      })
    case 'unknown':
      return attemptUnknownResponse()
    case 'expired':
      return attemptExpiredResponse()
  }
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const parsed = preparePayAppOrderSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: '유효한 충전 상품과 결제수단을 선택해 주세요.' },
      { status: 400 }
    )
  }

  const phone = parsed.data.phone.replaceAll('-', '')
  if (!PHONE_PATTERN.test(phone)) {
    return NextResponse.json(
      { error: '결제 안내를 받을 휴대폰 번호를 확인해 주세요.', code: 'PAYAPP_PHONE_INVALID' },
      { status: 400 }
    )
  }

  let preparedOrder: PaymentOrderRow | null = null
  let requestClaimed = false

  try {
    const payappConfig = assertPayAppReady()
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
    const { data: method, error: methodError } = await admin
      .from('payment_methods')
      .select('code, provider_open_pay_type, is_enabled')
      .eq('code', parsed.data.paymentMethodCode)
      .eq('provider', 'payapp')
      .maybeSingle()

    if (methodError || !method?.is_enabled || !method.provider_open_pay_type) {
      return NextResponse.json(
        { error: '사용할 수 없는 결제수단입니다.', code: 'PAYMENT_METHOD_UNAVAILABLE' },
        { status: 400 }
      )
    }

    const { data: runtimeRows, error: runtimeError } = await admin
      .from('payment_runtime_config')
      .select('master_accepts_new_orders, payapp_accepts_new_orders, payapp_merchant_id')
      .eq('id', true)
      .limit(2)
    const runtimeConfig = runtimeRows?.[0]

    if (
      runtimeError ||
      runtimeRows?.length !== 1 ||
      !runtimeConfig?.master_accepts_new_orders ||
      !runtimeConfig.payapp_accepts_new_orders ||
      runtimeConfig.payapp_merchant_id !== payappConfig.userId
    ) {
      return NextResponse.json(
        {
          error: '현재 결제 기능을 준비 중입니다.',
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
        provider: 'payapp',
        paymentMethod: method.code,
        phone,
        amount: plan.price,
        credits: plan.credits,
        taxFreeAmount,
        vatAmount,
        environment: 'live',
        merchantId: payappConfig.userId,
      }))
      .digest('hex')
    const expiresAt = new Date(
      Date.now() + PAYMENT_ORDER_TTL_MINUTES * 60_000
    ).toISOString()
    const orderId = createPublicOrderId()
    const { data: preparedData, error: prepareError } = await admin.rpc(
      'prepare_payment_order',
      {
        p_user_id: user.id,
        p_checkout_attempt_id: parsed.data.checkoutAttemptId,
        p_provider: 'payapp',
        p_plan_id: plan.id,
        p_order_id: orderId,
        p_plan_name_snapshot: plan.name,
        p_expected_amount: plan.price,
        p_expected_credits: plan.credits,
        p_provider_environment: 'live',
        p_provider_merchant_id: payappConfig.userId,
        p_request_fingerprint: requestFingerprint,
        p_confirm_idempotency_key: crypto.randomUUID(),
        p_cancel_idempotency_key: crypto.randomUUID(),
        p_expires_at: expiresAt,
        p_tax_free_amount: taxFreeAmount,
        p_vat_amount: vatAmount,
        // 생성 타입은 null 인자를 표현하지 못하지만 RPC는 NULL을 받는다(페이앱은 partner_user_id를 쓰지 않음).
        p_partner_user_id: null as unknown as string,
        p_payment_method_code: method.code,
      } satisfies PrepareOrderArgs
    )

    if (prepareError) {
      if (prepareError.message.includes('PAYMENT_ATTEMPT_PAYLOAD_CONFLICT')) {
        return NextResponse.json(
          {
            error: '동일한 결제 시도에 다른 상품, 결제수단 또는 휴대폰 번호를 사용할 수 없습니다.',
            code: 'PAYMENT_ATTEMPT_PAYLOAD_CONFLICT',
          },
          { status: 409 }
        )
      }
      // 결제수단 확인 뒤 결제수단이 꺼진 경우다.
      if (prepareError.message.includes('PAYMENT_ORDER_INPUT_INVALID')) {
        return NextResponse.json(
          { error: '사용할 수 없는 결제수단입니다.', code: 'PAYMENT_METHOD_UNAVAILABLE' },
          { status: 400 }
        )
      }

      console.error('[PayAppOrder] Failed to prepare order', {
        userId: user.id,
        errorCode: prepareError.code,
      })
      return NextResponse.json(
        { error: '결제 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }

    const prepared = Array.isArray(preparedData) ? preparedData[0] : preparedData
    if (!prepared) {
      return NextResponse.json(
        { error: '결제 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }
    preparedOrder = prepared as PaymentOrderRow

    if (parsed.data.savePhone) {
      // 프로필에 번호가 없을 때만 저장한다. 실패해도 결제는 계속한다.
      const { error: phoneError } = await admin
        .from('profiles')
        .update({ phone: formatProfilePhone(phone) })
        .eq('id', user.id)
        .is('phone', null)
      if (phoneError) {
        console.error('[PayAppOrder] Failed to save phone', { errorCode: phoneError.code })
      }
    }

    // 이번 요청이 만든 주문이 아니면 같은 결제 시도의 기존 주문이다.
    if (preparedOrder.order_id !== orderId || preparedOrder.status !== 'preparing') {
      return existingOrderResponse(admin, preparedOrder)
    }

    const { data: claimData, error: claimError } = await admin.rpc(
      'begin_payapp_request',
      { p_payment_order_id: preparedOrder.id }
    )

    if (claimError) {
      if (claimError.message.includes('PAYMENT_RUNTIME_GATE_CLOSED')) {
        return NextResponse.json(
          { error: '현재 결제 기능을 준비 중입니다.', code: 'PAYMENT_RUNTIME_GATE_CLOSED' },
          { status: 503 }
        )
      }
      if (claimError.message.includes('PAYAPP_REQUEST_NOT_CLAIMABLE')) {
        return attemptExpiredResponse()
      }

      console.error('[PayAppOrder] Failed to claim payment request', {
        orderId: preparedOrder.order_id,
        errorCode: claimError.code,
      })
      return NextResponse.json(
        { error: '결제 주문을 준비하지 못했습니다.' },
        { status: 500 }
      )
    }

    const claim = claimData as { claimed?: boolean; status?: string } | null
    if (!claim?.claimed) {
      // 다른 요청이 이미 payrequest를 보냈다. 이 요청은 보내지 않는다.
      return claim?.status === 'ready'
        ? storedReadyResponse(admin, { ...preparedOrder, status: 'ready' })
        : attemptUnknownResponse()
    }
    requestClaimed = true

    const payment = await requestPayAppPayment({
      orderId: preparedOrder.order_id,
      goodName: `${plan.name} (${plan.credits.toLocaleString()} 크레딧)`,
      price: preparedOrder.expected_amount,
      vatAmount: preparedOrder.vat_amount ?? vatAmount,
      recvPhone: phone,
      openPayType: method.provider_open_pay_type,
    })

    const { data: storeData, error: storeError } = await admin.rpc(
      'store_payapp_request',
      {
        p_payment_order_id: preparedOrder.id,
        p_mul_no: payment.mulNo,
        p_payurl: payment.payUrl,
      }
    )
    const stored = storeData as { stored?: boolean } | null

    // 결제창 주소를 저장하지 못하면 돌려주지 않는다. 주문은 ready_unknown으로 남아 대사가 정리한다.
    if (storeError || !stored?.stored) {
      console.error('[PayAppOrder] Payment request requires reconciliation', {
        orderId: preparedOrder.order_id,
        errorCode: storeError?.code,
      })
      return attemptUnknownResponse()
    }

    return readyResponse(preparedOrder, payment.payUrl)
  } catch (error) {
    // state=0만 요청이 만들어지지 않았다고 확정할 수 있다.
    if (
      requestClaimed &&
      preparedOrder &&
      error instanceof PayAppError &&
      error.code === 'PAYAPP_REQUEST_REJECTED'
    ) {
      const admin = createPaymentAdminClient()
      const { error: failError } = await admin.rpc('fail_payapp_request', {
        p_payment_order_id: preparedOrder.id,
        p_error_code: error.providerErrorCode
          ? `PAYAPP_${error.providerErrorCode}`
          : error.code,
        p_error_message: error.providerMessage ?? error.message,
      })
      if (failError) {
        console.error('[PayAppOrder] Failed to close rejected request', {
          orderId: preparedOrder.order_id,
          errorCode: failError.code,
        })
      }
      return NextResponse.json(
        { error: '결제 요청을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.', code: error.code },
        { status: 502 }
      )
    }

    // 요청을 선점한 뒤의 다른 실패는 페이앱 요청이 생겼는지 알 수 없다. 주문은 대사가 정리한다.
    if (requestClaimed) {
      return attemptUnknownResponse()
    }

    if (error instanceof PayAppError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      )
    }

    console.error('[PayAppOrder] Unexpected preparation failure')
    return NextResponse.json(
      { error: '결제 주문을 준비하지 못했습니다.' },
      { status: 500 }
    )
  }
}
