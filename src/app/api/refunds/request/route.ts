import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  getPointChargeRefundEligibility,
  RefundRpcError,
  reportPointChargePolicyFallback,
  requestPointChargeRefund,
  resolvePointChargeRefundBlockReason,
} from '@/lib/point-charge-refunds-server'
import { fillPointChargeRefundDays } from '@/lib/point-charge-policy'
import { getPointChargePolicyCached } from '@/lib/point-charge-policy-server'

// 판정이 법정 기간으로 대체됐는지(신청이 됐든 거절됐든) 확인해 경보를 남긴다(최선 노력, 응답을 바꾸지 않음).
async function reportFallbackIfAny(userId: string, sourceId: string) {
  try {
    const eligibility = await getPointChargeRefundEligibility({ userId, sourceId })
    if (eligibility.policyFallback) {
      await reportPointChargePolicyFallback({ userId, sourceId, screen: 'refund_request' })
    }
  } catch {
    // 경보용 확인 실패는 신청 결과와 무관하다.
  }
}

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

  // 문구 설정을 못 읽어도 신청은 막지 않는다(판정은 DB 함수가 한다).
  const policy = await getPointChargePolicyCached()

  try {
    const result = await requestPointChargeRefund({
      userId: user.id,
      sourceId: parsed.data.sourceId,
      reason: parsed.data.reason,
    })

    await reportFallbackIfAny(user.id, parsed.data.sourceId)

    return NextResponse.json({
      success: true,
      requestId: result.request_id,
      refundAmount: result.refund_amount,
      refundableUntil: result.refundable_until,
      message: policy?.refundRequestAccepted
        ? fillPointChargeRefundDays(policy.refundRequestAccepted, policy.refundDays)
        : '환불 신청이 접수되었습니다. 담당자가 확인한 뒤 원래 결제수단으로 환불합니다.',
    })
  } catch (error) {
    await reportFallbackIfAny(user.id, parsed.data.sourceId)
    // 거절 사유는 DB 문구를 먼저 쓴다(없으면 코드의 일반 문구).
    const dbReason = error instanceof RefundRpcError && policy?.refundBlockReasons[error.code]
      ? resolvePointChargeRefundBlockReason(error.code, policy)
      : null
    return NextResponse.json(
      {
        error:
          dbReason ??
          (error instanceof Error
            ? error.message
            : '환불 요청을 처리하지 못했습니다.'),
      },
      { status: 400 }
    )
  }
}
