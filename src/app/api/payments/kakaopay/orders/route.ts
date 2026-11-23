import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// 카카오페이 결제는 종료했다(9번 묶음, docs/plan-bundle9-payment-refund-notice.md 2-3). 새 결제 주문을 만들지 않는다.
// 결제 화면도 카카오페이 결제수단을 보여 주지 않는다. 이미 만든 주문의 콜백·상태 조회 라우트는 그대로 둔다.
export async function POST() {
  return NextResponse.json(
    {
      error: '카카오페이 결제는 더 이상 제공하지 않습니다. 다른 결제수단으로 결제해 주세요.',
      code: 'PAYMENT_PROVIDER_RETIRED',
    },
    { status: 503 }
  )
}
