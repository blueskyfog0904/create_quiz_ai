import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requestPointChargeRefund } from '@/lib/point-charge-refunds-server'

const requestRefundSchema = z.object({
  sourceId: z.string().uuid(),
  reason: z.string().trim().max(500).optional().default('사유 없음'),
}).strict()

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  }

  const parsed = requestRefundSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: '환불 요청 정보가 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  try {
    const result = await requestPointChargeRefund({
      userId: user.id,
      sourceId: parsed.data.sourceId,
      reason: parsed.data.reason,
    })

    return NextResponse.json({
      success: true,
      requestId: result.request_id,
      refundAmount: result.refund_amount,
      refundableUntil: result.refundable_until,
      message: '환불 요청이 접수되었습니다. 관리자 확인 후 원 결제수단으로 환불됩니다.',
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '환불 요청을 처리하지 못했습니다.',
      },
      { status: 400 }
    )
  }
}
