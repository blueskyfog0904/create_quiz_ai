import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { MarketRefundConflictError, MarketRefundRuleError, requestMarketPartialRefund, requestMarketRefund } from '@/lib/market-refunds'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  targetKind: z.enum(['legacy_purchase', 'v2_order']),
  targetId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
  // 8번: 패키지의 받지 않은 자료 환불(부분). 화면이 본 금액과 다르면 409 AMOUNT_CHANGED.
  kind: z.enum(['full', 'partial']).optional(),
  expectedCredits: z.number().int().positive().optional(),
  priorRequestId: z.string().uuid().optional(),
})

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: '로그인이 필요합니다.' },
    }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: { code: 'INVALID_INPUT', message: parsed.error.issues[0]?.message || '환불 요청이 올바르지 않습니다.' },
    }, { status: 400 })
  }

  if (parsed.data.kind === 'partial') {
    if (parsed.data.targetKind !== 'v2_order' || typeof parsed.data.expectedCredits !== 'number') {
      return NextResponse.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '받지 않은 자료 환불 요청이 올바르지 않습니다.' },
      }, { status: 400 })
    }
    try {
      const result = await requestMarketPartialRefund({
        userId: user.id,
        orderId: parsed.data.targetId,
        expectedCredits: parsed.data.expectedCredits,
        reason: parsed.data.reason ?? null,
        priorRequestId: parsed.data.priorRequestId ?? null,
      })
      return NextResponse.json({ success: true, data: result, message: '받지 않은 자료의 환불 신청이 접수되었습니다.' })
    } catch (error) {
      if (error instanceof MarketRefundRuleError) {
        const status = error.code === 'POLICY_UNAVAILABLE' ? 503 : 409
        return NextResponse.json({ success: false, error: { code: error.code, message: error.message }, details: error.details }, { status })
      }
      if (error instanceof MarketRefundConflictError) {
        return NextResponse.json({ success: false, error: { code: 'CONFLICT', message: error.message } }, { status: 409 })
      }
      return NextResponse.json({ success: false, error: { code: 'INTERNAL_ERROR', message: '환불 신청 처리에 실패했습니다.' } }, { status: 500 })
    }
  }

  try {
    const refundRequest = await requestMarketRefund({
      userId: user.id,
      targetKind: parsed.data.targetKind,
      targetId: parsed.data.targetId,
      reason: parsed.data.reason ?? null,
    })

    return NextResponse.json({
      success: true,
      data: refundRequest,
      message: '환불 신청이 접수되었습니다.',
    })
  } catch (error) {
    // 판정은 error.name 으로만 한다(거절 문구는 DB 값이라 글자로 판정하지 않는다).
    if (error instanceof Error && error.name === 'REFUND_POLICY_UNAVAILABLE') {
      return NextResponse.json({
        success: false,
        error: { code: 'REFUND_POLICY_UNAVAILABLE', message: error.message },
      }, { status: 503 })
    }
    if (error instanceof MarketRefundConflictError) {
      return NextResponse.json({ success: false, error: { code: 'CONFLICT', message: error.message } }, { status: 409 })
    }
    const isDownloadBlocked = error instanceof Error && error.name === 'DOWNLOAD_EXISTS'
    return NextResponse.json({
      success: false,
      error: {
        code: isDownloadBlocked ? 'ALREADY_DOWNLOADED' : 'REFUND_NOT_ALLOWED',
        message: error instanceof Error ? error.message : '환불 신청 처리에 실패했습니다.',
      },
    }, { status: isDownloadBlocked ? 409 : 400 })
  }
}
