import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { checkAdminLimit } from '@/lib/admin-permissions'
import { alertAdminAuditFailure, recordAdminAudit } from '@/lib/admin-audit-log-server'
import {
  approveMarketRefund,
  getMarketRefundOwnerContext,
  MARKET_REFUND_REJECT_CODES,
  MarketRefundConflictError,
  MarketRefundNeedsOwnerError,
  MarketRefundRuleError,
  MarketRefundShortfallError,
  rejectMarketRefund,
  settleMarketRefundByOwner,
} from '@/lib/market-refunds'
import { isMarketRefundMemberWithdrawnError, MARKET_REFUND_MEMBER_WITHDRAWN_MESSAGE } from '@/lib/market-refund-rules'
import { createAdminClient } from '@/lib/supabase/bypass'
import { notificationFailed, sendMemberNotification } from '@/lib/member-notifications-server'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  action: z.enum(['approve', 'reject', 'owner_settle']),
  adminNote: z.string().trim().max(1000).optional(),
  // 부족분 안내를 확인한 뒤 다시 보내는 금액(복구 + 다시 지급)
  confirmedRefundCredits: z.number().int().min(0).optional(),
  // 8번: 거부 사유 종류(필수 — 요건을 갖춘 신청은 TARGET_CHANGED·PROVIDED_CONFIRMED 만)
  rejectCode: z.enum(MARKET_REFUND_REJECT_CODES as [string, ...string[]]).optional(),
  // PROVIDED_CONFIRMED 의 근거(연결 문의, 또는 제공 경로·시각)
  evidence: z.string().trim().max(500).optional(),
  // 8번: 대표 정산 — 문제 원천(현금 환불 이력 등)의 몫만
  ownerItems: z.array(z.object({
    sourceId: z.string().uuid(),
    restored: z.number().int().min(0),
    reissued: z.number().int().min(0),
    unrecovered: z.number().int().min(0),
    reason: z.string().trim().min(1).max(500),
  }).strict()).max(20).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

// 마켓 환불 승인·거부 권한(refunds.market)을 공용 가드로 확인한다.
async function requireAdmin() {
  const guard = await requireAdminApiPermission('refunds.market')
  if ('error' in guard) return { error: guard.error, status: guard.status } as const
  return { user: { id: guard.access.userId }, access: guard.access } as const
}

// 처리 결과를 요청한 회원에게 알린다(16번 공용 함수, 문구는 DB). 알림이 실패해도 환불 처리 결과는 바꾸지 않는다 — 실패 여부만 돌려준다.
// 거절 사유는 화면에서 필수('회원에게 안내됩니다')다. 사유 없이 보내는 길은 없다(빈 사유 대체 문구 없음, Q2) — 비면 실패로 알린다.
async function notifyMarketRefundProcessed(
  action: 'approve' | 'reject',
  request: {
    user_id: string
    approved_refund_credits: number | null
    requested_refund_credits?: number | null
    admin_note?: string | null
    allocated_items?: unknown
  }
): Promise<boolean> {
  const result = action === 'approve'
    ? await sendMemberNotification({ kind: 'marketRefundApproved', userId: request.user_id, marketRefund: request })
    : await sendMemberNotification({ kind: 'marketRefundRejected', userId: request.user_id, values: { '{사유}': (request.admin_note ?? '').trim() } })
  return notificationFailed(result)
}

// 대표 정산 대화상자용 원천 정보(대표만). 표시용이며 확정은 DB 함수가 다시 판정한다.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json({ success: false, error: adminCheck.error }, { status: adminCheck.status })
  }
  if (adminCheck.access.role !== 'owner') {
    return NextResponse.json({ success: false, error: '대표 계정만 볼 수 있습니다.', code: 'OWNER_ONLY' }, { status: 403 })
  }
  const { id } = await params
  try {
    const context = await getMarketRefundOwnerContext(id)
    if (!context) return NextResponse.json({ success: false, error: '환불 요청을 찾을 수 없습니다.' }, { status: 404 })
    return NextResponse.json({ success: true, data: context })
  } catch {
    return NextResponse.json({ success: false, error: '원천 정보를 불러오지 못했습니다.' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json({ success: false, error: adminCheck.error }, { status: adminCheck.status })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      success: false,
      error: parsed.error.issues[0]?.message || '처리 요청이 올바르지 않습니다.',
    }, { status: 400 })
  }

  // 처리 전에 요청을 읽는다: 본인이 낸 환불 요청은 승인·거부 모두 하지 않는다(대표 포함 — 다른 관리자가 처리한다).
  const { data: refundRequest, error: refundRequestError } = await createAdminClient()
    .from('market_refund_requests')
    .select('user_id, requested_refund_credits')
    .eq('id', id)
    .maybeSingle()
  if (refundRequestError) {
    return NextResponse.json({ success: false, error: '환불 요청을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  // 없는 요청은 아래 처리 함수가 기존대로 오류로 돌려준다.
  if (refundRequest?.user_id === adminCheck.user.id) {
    return NextResponse.json({
      success: false,
      error: '본인 계정의 환불 요청은 처리할 수 없습니다. 다른 관리자에게 처리를 요청해 주세요.',
      code: 'ADMIN_SELF_TARGET',
    }, { status: 403 })
  }

  if (parsed.data.action === 'owner_settle') {
    if (adminCheck.access.role !== 'owner') {
      return NextResponse.json({ success: false, error: '대표 계정만 정산할 수 있습니다.', code: 'OWNER_ONLY' }, { status: 403 })
    }
    if (!parsed.data.ownerItems || !parsed.data.adminNote) {
      return NextResponse.json({ success: false, error: '원천별 정산 값과 정산 메모를 입력해 주세요.' }, { status: 400 })
    }
  }
  if (parsed.data.action === 'reject' && !parsed.data.rejectCode) {
    return NextResponse.json({ success: false, error: '거부 사유 종류를 골라 주세요.', code: 'REJECT_CODE_INVALID' }, { status: 400 })
  }

  // 승인은 계정의 1건 승인 한도 안에서만 한다(거부는 한도 없음, 대표는 한도 없음).
  // 기준은 그 요청의 환불 요청 크레딧(확인한 복구량이 더 크면 그 값)이다. 하루 누적 한도는 이 권한에 없다.
  if (parsed.data.action === 'approve' && adminCheck.access.role !== 'owner' && refundRequest) {
    const refundCredits = Math.max(refundRequest.requested_refund_credits, parsed.data.confirmedRefundCredits ?? 0)
    // 복구할 크레딧이 0인 요청은 한도와 무관하다.
    if (refundCredits > 0 && !checkAdminLimit(adminCheck.access, 'refunds.market', 'per_request', refundCredits)) {
      return NextResponse.json({
        success: false,
        error: '이 환불은 계정의 1건 승인 한도를 넘습니다. 대표 관리자에게 확인을 요청해 주세요.',
        code: 'ADMIN_LIMIT_EXCEEDED',
      }, { status: 403 })
    }
  }

  try {
    if (parsed.data.action === 'owner_settle') {
      // 작업 기록은 DB 함수가 같은 트랜잭션에서 남긴다(market_refund_owner_settle).
      await settleMarketRefundByOwner({
        requestId: id,
        ownerId: adminCheck.user.id,
        items: parsed.data.ownerItems ?? [],
        note: parsed.data.adminNote ?? '',
        confirmedRefundCredits: parsed.data.confirmedRefundCredits,
      })
      const { data: settled } = await createAdminClient().from('market_refund_requests').select('*').eq('id', id).maybeSingle()
      // 행을 다시 읽지 못하면 알림을 보내지 못한 것으로 본다(예외 환불 route 와 같음)
      const settledNotificationFailed = settled ? await notifyMarketRefundProcessed('approve', settled) : true
      return NextResponse.json({ success: true, data: settled, message: '대표 정산으로 환불을 처리했습니다.', notificationFailed: settledNotificationFailed })
    }

    const data = parsed.data.action === 'approve'
      ? await approveMarketRefund({
        requestId: id,
        adminId: adminCheck.user.id,
        adminNote: parsed.data.adminNote ?? null,
        confirmedRefundCredits: parsed.data.confirmedRefundCredits,
      })
      : await rejectMarketRefund({
        requestId: id,
        adminId: adminCheck.user.id,
        adminNote: parsed.data.adminNote ?? null,
        rejectCode: parsed.data.rejectCode as (typeof MARKET_REFUND_REJECT_CODES)[number],
        evidence: parsed.data.evidence,
      })

    const processedNotificationFailed = await notifyMarketRefundProcessed(parsed.data.action === 'approve' ? 'approve' : 'reject', data)

    // 처리가 끝난 뒤 작업 기록을 남긴다. 환불 처리 함수는 고치지 않으므로 같은 트랜잭션이 아니다(계획 U3-5).
    // 기록이 빠지면 응답에 경고를 싣고 대표에게 알린다. 처리 결과는 바꾸지 않는다.
    const auditAction = parsed.data.action === 'approve' ? 'market_refund_approve' : 'market_refund_reject'
    const rejectCode = parsed.data.action === 'reject' ? parsed.data.rejectCode ?? null : null
    const audited = await recordAdminAudit({
      actorId: adminCheck.user.id,
      action: auditAction,
      targetType: 'market_refund_request',
      targetId: id,
      targetUserId: data.user_id,
      amount: parsed.data.action === 'approve' ? data.approved_refund_credits ?? null : null,
      reason: parsed.data.adminNote ?? null,
      details: {
        status: data.status ?? null,
        requested_refund_credits: data.requested_refund_credits ?? null,
        approved_refund_credits: data.approved_refund_credits ?? null,
        confirmed_refund_credits: parsed.data.confirmedRefundCredits ?? null,
        refund_kind: data.refund_kind ?? null,
        reject_code: rejectCode,
      },
    })
    if (!audited) {
      await alertAdminAuditFailure({ action: auditAction, refTable: 'market_refund_requests', refId: id, link: '/admin/refunds' })
    }

    return NextResponse.json({
      success: true,
      data,
      message: parsed.data.action === 'approve' ? '문제마켓 환불이 승인되었습니다.' : '문제마켓 환불이 거부되었습니다.',
      notificationFailed: processedNotificationFailed,
      ...(audited ? {} : { auditWarning: '처리는 완료됐지만 작업 기록을 남기지 못했습니다. 대표 관리자에게 알렸습니다.' }),
    })
  } catch (error) {
    if (isMarketRefundMemberWithdrawnError(error)) {
      return NextResponse.json({ success: false, error: MARKET_REFUND_MEMBER_WITHDRAWN_MESSAGE, code: 'MEMBER_WITHDRAWN' }, { status: 409 })
    }
    if (error instanceof MarketRefundNeedsOwnerError) {
      return NextResponse.json({ success: false, error: error.message, code: 'NEEDS_OWNER' }, { status: 409 })
    }
    if (error instanceof MarketRefundRuleError) {
      // 받지 않은 자료 환불의 승인·대표 정산이 판정 변경으로 막히면 DB 가 요청을 거부(TARGET_CHANGED)해 두었다 — 회원에게 알린다.
      if (error.code === 'TARGET_CHANGED' && (parsed.data.action === 'approve' || parsed.data.action === 'owner_settle')) {
        const { data: rejected } = await createAdminClient().from('market_refund_requests').select('*').eq('id', id).maybeSingle()
        // 16번 6절: 자동 거절 알림이 실패하면(행을 못 읽음 포함) 409 응답에 같은 칸으로 알린다
        const rejectedNotificationFailed = !rejected ? true : rejected.status === 'rejected' ? await notifyMarketRefundProcessed('reject', rejected) : false
        return NextResponse.json({ success: false, error: error.message, code: error.code, details: error.details, notificationFailed: rejectedNotificationFailed }, { status: 409 })
      }
      return NextResponse.json({ success: false, error: error.message, code: error.code, details: error.details }, { status: 409 })
    }
    // 환불 기간 설정을 읽지 못해 승인을 멈춤(아무것도 바뀌지 않음). 잠시 후 다시.
    if (error instanceof Error && error.name === 'REFUND_POLICY_UNAVAILABLE') {
      return NextResponse.json({
        success: false,
        error: error.message,
        code: 'REFUND_POLICY_UNAVAILABLE',
      }, { status: 503 })
    }
    if (error instanceof MarketRefundShortfallError) {
      return NextResponse.json({
        success: false,
        error: error.message,
        code: 'MARKET_REFUND_SHORTFALL',
        requested: error.requested,
        restorable: error.restorable,
      }, { status: 409 })
    }

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '문제마켓 환불 처리에 실패했습니다.',
    }, { status: error instanceof MarketRefundConflictError ? 409 : 500 })
  }
}
