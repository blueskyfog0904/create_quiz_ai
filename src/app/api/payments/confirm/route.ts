import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  createPaymentAdminClient,
  type FinalizeTossPaymentResult,
  type PaymentOrderRow,
} from '@/lib/payment-orders-server'
import {
  assertTossPaymentsReady,
  cancelTossPayment,
  confirmTossPayment,
  isAllowedPointChargeMethod,
  TossPaymentsError,
  validateConfirmedPayment,
} from '@/lib/toss-payments-server'

export const dynamic = 'force-dynamic'

const confirmPaymentSchema = z.object({
  paymentKey: z.string().trim().min(1).max(200),
  orderId: z.string().trim().min(1).max(64),
  amount: z.number().int().min(1).max(100_000),
}).strict()

function completedResponse(
  order: PaymentOrderRow,
  result: FinalizeTossPaymentResult
) {
  return NextResponse.json({
    success: true,
    message: '결제가 완료되었습니다.',
    credits: result.credits,
    newBalance: result.new_balance,
    payment: {
      orderId: order.order_id,
      orderName: order.plan_name_snapshot,
      method: order.provider_method,
      totalAmount: order.expected_amount,
      approvedAt: order.approved_at,
    },
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

  const parsed = confirmPaymentSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: '결제 승인 정보가 올바르지 않습니다.' },
      { status: 400 }
    )
  }
  const input = parsed.data

  try {
    const runtimeConfig = assertTossPaymentsReady()
    const admin = createPaymentAdminClient()
    const { data: orderData, error: orderError } = await admin
      .from('payment_orders')
      .select('*')
      .eq('order_id', input.orderId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (orderError || !orderData) {
      return NextResponse.json(
        { error: '본인 소유의 결제 주문을 찾을 수 없습니다.' },
        { status: 404 }
      )
    }

    let order = orderData as PaymentOrderRow
    if (order.expected_amount !== input.amount) {
      return NextResponse.json(
        { error: '결제 금액이 주문 금액과 일치하지 않습니다.' },
        { status: 409 }
      )
    }

    if (
      order.environment !== runtimeConfig.environment ||
      order.mid !== runtimeConfig.mid
    ) {
      return NextResponse.json(
        { error: '주문과 결제 환경이 일치하지 않습니다.' },
        { status: 503 }
      )
    }

    if (order.status === 'completed') {
      if (order.payment_key !== input.paymentKey) {
        return NextResponse.json(
          { error: '이미 완료된 주문 정보와 일치하지 않습니다.' },
          { status: 409 }
        )
      }

      const { data: profile } = await admin
        .from('profiles')
        .select('credits')
        .eq('id', user.id)
        .single()

      return completedResponse(order, {
        source_id: order.source_id ?? '',
        payment_history_id: order.payment_history_id ?? '',
        new_balance: profile?.credits ?? 0,
        credits: order.expected_credits,
        already_completed: true,
      })
    }

    if (new Date(order.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: '결제 주문의 유효시간이 만료되었습니다.' },
        { status: 410 }
      )
    }

    if (
      order.payment_key !== null &&
      order.payment_key !== input.paymentKey
    ) {
      return NextResponse.json(
        { error: '주문에 등록된 승인 정보와 일치하지 않습니다.' },
        { status: 409 }
      )
    }

    if (order.status === 'ready') {
      const { data: claimedOrder, error: claimError } = await admin
        .from('payment_orders')
        .update({
          status: 'confirming',
          payment_key: input.paymentKey,
          failure_code: null,
          failure_message: null,
        })
        .eq('id', order.id)
        .eq('status', 'ready')
        .is('payment_key', null)
        .select('*')
        .maybeSingle()

      if (claimError || !claimedOrder) {
        return NextResponse.json(
          { error: '다른 결제 승인 요청을 처리 중입니다.' },
          { status: 409 }
        )
      }
      order = claimedOrder as PaymentOrderRow
    } else if (order.status !== 'fulfillment_pending') {
      return NextResponse.json(
        { error: '현재 처리할 수 없는 결제 주문 상태입니다.' },
        { status: 409 }
      )
    }

    const payment = await confirmTossPayment({
      paymentKey: input.paymentKey,
      orderId: order.order_id,
      amount: order.expected_amount,
      idempotencyKey: order.confirm_idempotency_key,
    })

    try {
      validateConfirmedPayment(payment, {
        paymentKey: input.paymentKey,
        orderId: order.order_id,
        amount: order.expected_amount,
        mid: order.mid,
      })

      if (!isAllowedPointChargeMethod(payment)) {
        throw new TossPaymentsError(
          'PAYMENT_METHOD_NOT_ALLOWED',
          '포인트 충전에 사용할 수 없는 결제수단입니다.',
          400
        )
      }
    } catch (validationError) {
      try {
        await cancelTossPayment({
          paymentKey: input.paymentKey,
          cancelReason: '포인트 충전 결제수단 또는 승인정보 불일치',
          idempotencyKey: order.cancel_idempotency_key,
        })
        await admin
          .from('payment_orders')
          .update({
            status: 'failed',
            provider_status: payment.status,
            failure_code:
              validationError instanceof TossPaymentsError
                ? validationError.code
                : 'PAYMENT_VALIDATION_FAILED',
            failure_message: '승인정보 검증 후 결제를 자동 취소했습니다.',
            canceled_at: new Date().toISOString(),
          })
          .eq('id', order.id)
      } catch {
        await admin
          .from('payment_orders')
          .update({
            status: 'manual_review',
            failure_code: 'PAYMENT_AUTO_CANCEL_FAILED',
            failure_message: '승인정보 검증 실패 후 자동 취소 결과를 확인해야 합니다.',
          })
          .eq('id', order.id)
      }

      return NextResponse.json(
        { error: '승인된 결제를 사용할 수 없어 취소 처리했습니다.' },
        { status: 400 }
      )
    }

    const { error: pendingError } = await admin
      .from('payment_orders')
      .update({
        status: 'fulfillment_pending',
        provider_method: payment.method,
        provider_status: payment.status,
        approved_at: payment.approvedAt,
      })
      .eq('id', order.id)
      .in('status', ['confirming', 'fulfillment_pending'])

    if (pendingError) {
      console.error('[PaymentConfirm] Failed to persist provider approval', {
        orderId: order.order_id,
        errorCode: pendingError.code,
      })
      return NextResponse.json(
        {
          error: '결제 승인 결과를 확인 중입니다. 잠시 후 다시 확인해 주세요.',
          code: 'PAYMENT_RECONCILIATION_REQUIRED',
        },
        { status: 202 }
      )
    }

    const { data: fulfillmentData, error: fulfillmentError } = await admin.rpc(
      'finalize_toss_payment',
      {
        p_payment_order_id: order.id,
        p_payment_key: input.paymentKey,
        p_provider_method: payment.method,
        p_provider_status: payment.status,
        p_mid: order.mid,
        p_approved_at: payment.approvedAt,
      }
    )

    if (fulfillmentError || !fulfillmentData) {
      console.error('[PaymentConfirm] Credit fulfillment is pending', {
        orderId: order.order_id,
        errorCode: fulfillmentError?.code,
      })
      return NextResponse.json(
        {
          error: '결제는 승인되었으며 크레딧 지급을 확인 중입니다.',
          code: 'PAYMENT_FULFILLMENT_PENDING',
        },
        { status: 202 }
      )
    }

    return completedResponse(
      {
        ...order,
        status: 'completed',
        provider_method: payment.method,
        provider_status: payment.status,
        approved_at: payment.approvedAt,
      },
      fulfillmentData as FinalizeTossPaymentResult
    )
  } catch (error) {
    if (error instanceof TossPaymentsError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status >= 500 ? 503 : error.status }
      )
    }

    console.error('[PaymentConfirm] Unexpected approval failure')
    return NextResponse.json(
      { error: '결제 승인 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    )
  }
}
