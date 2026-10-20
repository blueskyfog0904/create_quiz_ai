import { handlePayAppFeedback } from '@/lib/payapp-webhook-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'

export const dynamic = 'force-dynamic'

// 페이앱은 응답 본문이 SUCCESS가 아니면 실패로 보고 재통보한다. redirect 응답은 쓰지 않는다.
export async function POST(request: Request) {
  let reply: { body: 'SUCCESS' | 'FAIL'; status: number }

  try {
    reply = await handlePayAppFeedback(await request.text(), createPaymentAdminClient())
  } catch {
    reply = { body: 'FAIL', status: 503 }
  }

  return new Response(reply.body, {
    status: reply.status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
