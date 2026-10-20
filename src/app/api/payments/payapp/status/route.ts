import { NextResponse } from 'next/server'
import { publicPayAppStatus } from '@/lib/payapp-order-status'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const responseHeaders = {
  'Cache-Control': 'no-store',
}

const ORDER_ID_PATTERN = /^PAYAPP_[0-9A-Z_]{1,80}$/

// 로그인한 본인의 페이앱 주문만 보여준다.
export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json(
      {
        status: 'invalid',
        code: 'AUTH_REQUIRED',
        message: '로그인 후 결제 결과를 확인해 주세요. 결제하셨다면 확인 후 자동으로 반영됩니다.',
      },
      { status: 401, headers: responseHeaders }
    )
  }

  const orderId = new URL(request.url).searchParams.get('orderId') ?? ''
  if (!ORDER_ID_PATTERN.test(orderId)) {
    return NextResponse.json(
      { status: 'invalid', message: '결제 결과를 찾을 수 없습니다.' },
      { status: 404, headers: responseHeaders }
    )
  }

  const admin = createPaymentAdminClient()
  const { data: order, error } = await admin
    .from('payment_orders')
    .select(`
      order_id,
      plan_name_snapshot,
      expected_amount,
      expected_credits,
      status,
      fulfilled_at
    `)
    .eq('order_id', orderId)
    .eq('user_id', user.id)
    .eq('provider', 'payapp')
    .maybeSingle()

  if (error || !order) {
    return NextResponse.json(
      { status: 'invalid', message: '결제 결과를 찾을 수 없습니다.' },
      { status: 404, headers: responseHeaders }
    )
  }

  // 실패·만료 건은 늦은 결제완료 통보로 지급될 수 있으므로 재결제를 서두르지 않게 안내한다.
  const publicStatus = publicPayAppStatus(order.status)

  return NextResponse.json(
    {
      status: publicStatus,
      orderId: order.order_id,
      planName: order.plan_name_snapshot,
      amount: order.expected_amount,
      credits: order.expected_credits,
      message: publicStatus === 'completed'
        ? '결제와 크레딧 충전이 완료되었습니다.'
        : publicStatus === 'refunded'
          ? '취소된 결제입니다.'
          : publicStatus === 'pending'
            ? '결제 결과를 확인하고 있습니다.'
            : '결제되지 않았습니다. 이미 결제하셨다면 확인 후 자동 반영됩니다.',
      completedAt: publicStatus === 'completed' ? order.fulfilled_at : null,
    },
    { headers: responseHeaders }
  )
}
