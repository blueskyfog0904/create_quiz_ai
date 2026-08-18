import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  hashOpaqueToken,
  KAKAOPAY_RESULT_COOKIE,
} from '@/lib/kakaopay-checkout-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'

export const dynamic = 'force-dynamic'

const responseHeaders = {
  'Cache-Control': 'no-store',
}

export async function GET() {
  const cookieStore = await cookies()
  const resultToken = cookieStore.get(KAKAOPAY_RESULT_COOKIE)?.value ?? ''

  if (resultToken.length < 32 || resultToken.length > 200) {
    return NextResponse.json(
      { status: 'invalid', message: '결제 결과 조회 시간이 만료되었습니다.' },
      { status: 401, headers: responseHeaders }
    )
  }

  const admin = createPaymentAdminClient()
  const { data: providerTransaction, error: providerError } = await admin
    .from('payment_provider_transactions')
    .select('payment_order_id, result_token_expires_at')
    .eq('result_token_hash', hashOpaqueToken(resultToken))
    .maybeSingle()

  if (
    providerError ||
    !providerTransaction?.payment_order_id ||
    !providerTransaction.result_token_expires_at ||
    new Date(providerTransaction.result_token_expires_at).getTime() <= Date.now()
  ) {
    return NextResponse.json(
      { status: 'invalid', message: '결제 결과 조회 시간이 만료되었습니다.' },
      { status: 401, headers: responseHeaders }
    )
  }

  const { data: order, error: orderError } = await admin
    .from('payment_orders')
    .select(`
      order_id,
      plan_name_snapshot,
      expected_amount,
      expected_credits,
      status,
      failure_message,
      fulfilled_at
    `)
    .eq('id', providerTransaction.payment_order_id)
    .eq('provider', 'kakaopay')
    .maybeSingle()

  if (orderError || !order) {
    return NextResponse.json(
      { status: 'invalid', message: '결제 결과를 찾을 수 없습니다.' },
      { status: 404, headers: responseHeaders }
    )
  }

  const publicStatus = order.status === 'completed'
    ? 'completed'
    : ['failed', 'expired'].includes(order.status)
      ? 'failed'
      : 'pending'

  return NextResponse.json(
    {
      status: publicStatus,
      orderId: order.order_id,
      planName: order.plan_name_snapshot,
      amount: order.expected_amount,
      credits: order.expected_credits,
      message: publicStatus === 'completed'
        ? '카카오페이 결제와 크레딧 충전이 완료되었습니다.'
        : publicStatus === 'failed'
          ? order.failure_message ?? '카카오페이 결제를 완료하지 못했습니다.'
          : '카카오페이 결제 결과를 확인하고 있습니다.',
      completedAt: publicStatus === 'completed' ? order.fulfilled_at : null,
    },
    { headers: responseHeaders }
  )
}
