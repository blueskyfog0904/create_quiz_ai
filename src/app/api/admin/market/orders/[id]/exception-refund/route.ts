import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import {
  exceptionMarketRefund,
  getMarketOrderRefundContext,
  MarketRefundConflictError,
  MarketRefundNeedsOwnerError,
  MarketRefundRuleError,
  MarketRefundShortfallError,
} from '@/lib/market-refunds'
import { buildMarketRefundApprovedMessage } from '@/lib/market-refund-rules'
import { createAdminClient } from '@/lib/supabase/bypass'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

const BodySchema = z.object({
  // preview: 쓰기 없이 지금 금액·대상만 받는다(DB 가 금액 비교에서 멈춤)
  preview: z.boolean().optional(),
  claimType: z.enum(['defect', 'withdrawal']),
  claimChannel: z.enum(['ticket', 'email', 'phone']).nullable(),
  subproductIds: z.array(z.string().uuid()).max(20).nullable(),
  expectedCredits: z.number().int(),
  expectedCommitted: z.number().int().min(0),
  reason: z.string().trim().min(1, '사유를 적어 주세요.').max(1000),
  supportTicketId: z.string().uuid().nullable(),
  ticketRevisionId: z.string().uuid().nullable(),
  claimReceivedAt: z.string().datetime({ offset: true }).nullable(),
  confirmedRefundCredits: z.number().int().min(0).optional(),
  // 이메일·전화 접수의 증빙(발신 주소·수신 시각 / 통화 번호·시각) — 그 경로에서는 필수
  evidence: z.string().trim().max(500).optional(),
}).strict()

// 예외 환불(8번): 권한 refunds.market. 1건 한도·본인 주문·대표 전용 경로는 DB 함수가 잠금 아래에서 판정한다.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('refunds.market')
  if ('error' in guard) return NextResponse.json({ success: false, error: guard.error }, { status: guard.status })
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ success: false, error: '주문을 찾을 수 없습니다.' }, { status: 404 })
  }
  try {
    const context = await getMarketOrderRefundContext(id)
    if (!context) return NextResponse.json({ success: false, error: '주문을 찾을 수 없습니다.' }, { status: 404 })
    if (context.order.userId === guard.access.userId) {
      return NextResponse.json({ success: false, error: '본인 계정의 주문은 처리할 수 없습니다.', code: 'SELF_TARGET' }, { status: 403 })
    }
    return NextResponse.json({ success: true, data: { ...context, isOwner: guard.access.role === 'owner' } })
  } catch {
    return NextResponse.json({ success: false, error: '주문 정보를 불러오지 못했습니다.' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('refunds.market')
  if ('error' in guard) return NextResponse.json({ success: false, error: guard.error }, { status: guard.status })
  const { id } = await params
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ success: false, error: parsed.success ? '주문을 찾을 수 없습니다.' : parsed.error.issues[0]?.message ?? '요청이 올바르지 않습니다.' }, { status: 400 })
  }
  const body = parsed.data
  // 이메일·전화 접수는 접수 시각을 증명할 증빙을 사유와 함께 남긴다(계획 0절).
  const needsEvidence = body.claimType === 'withdrawal' && (body.claimChannel === 'email' || body.claimChannel === 'phone')
  if (needsEvidence && !body.preview && (body.evidence ?? '').length < 5) {
    return NextResponse.json({ success: false, error: '접수 증빙(발신 주소·수신 시각, 또는 통화 번호·시각)을 적어 주세요.', code: 'EVIDENCE_REQUIRED' }, { status: 400 })
  }
  try {
    const result = await exceptionMarketRefund({
      adminId: guard.access.userId,
      orderId: id,
      claimType: body.claimType,
      claimChannel: body.claimChannel,
      subproductIds: body.subproductIds,
      expectedCredits: body.preview ? -1 : body.expectedCredits,
      expectedCommitted: body.expectedCommitted,
      reason: needsEvidence && body.evidence ? `${body.reason}\n(접수 증빙: ${body.evidence})` : body.reason,
      supportTicketId: body.supportTicketId,
      ticketRevisionId: body.ticketRevisionId,
      claimReceivedAt: body.claimReceivedAt,
      confirmedRefundCredits: body.confirmedRefundCredits,
    })
    // 처리 결과를 회원에게 알린다(실패해도 결과는 그대로).
    const { data: refundRequest } = await createAdminClient().from('market_refund_requests')
      .select('user_id, requested_refund_credits, approved_refund_credits, allocated_items').eq('id', result.requestId).maybeSingle()
    if (refundRequest) {
      await createAdminClient().from('notifications').insert({
        user_id: refundRequest.user_id,
        type: 'success',
        title: '문제마켓 환불이 처리되었습니다',
        message: buildMarketRefundApprovedMessage(refundRequest),
        link: '/mypage/credits',
        is_read: false,
      })
    }
    return NextResponse.json({ success: true, data: result, message: '예외 환불을 처리했습니다.' })
  } catch (error) {
    if (error instanceof MarketRefundRuleError) {
      // 미리보기는 AMOUNT_CHANGED 의 details 로 지금 금액·대상을 돌려받는다.
      if (body.preview && error.code === 'AMOUNT_CHANGED') {
        return NextResponse.json({ success: true, preview: error.details })
      }
      return NextResponse.json({ success: false, error: error.message, code: error.code, details: error.details }, { status: 409 })
    }
    if (error instanceof MarketRefundNeedsOwnerError) {
      return NextResponse.json({ success: false, error: `${error.message} 대표 확인 대기 요청으로 남겼습니다.`, code: 'NEEDS_OWNER' }, { status: 409 })
    }
    if (error instanceof MarketRefundShortfallError) {
      return NextResponse.json({ success: false, error: error.message, code: 'MARKET_REFUND_SHORTFALL', requested: error.requested, restorable: error.restorable }, { status: 409 })
    }
    if (error instanceof MarketRefundConflictError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 409 })
    }
    return NextResponse.json({ success: false, error: '예외 환불 처리에 실패했습니다.' }, { status: 500 })
  }
}
