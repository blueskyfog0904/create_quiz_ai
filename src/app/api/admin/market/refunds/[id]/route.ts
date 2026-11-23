import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { checkAdminLimit } from '@/lib/admin-permissions'
import { alertAdminAuditFailure, recordAdminAudit } from '@/lib/admin-audit-log-server'
import {
  approveMarketRefund,
  MarketRefundConflictError,
  MarketRefundShortfallError,
  rejectMarketRefund,
} from '@/lib/market-refunds'
import { createAdminClient } from '@/lib/supabase/bypass'

export const dynamic = 'force-dynamic'

const BodySchema = z.object({
  action: z.enum(['approve', 'reject']),
  adminNote: z.string().trim().max(1000).optional(),
  // 부족분 안내를 확인한 뒤 다시 보내는 복구량
  confirmedRefundCredits: z.number().int().min(0).optional(),
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

// 처리 결과를 요청한 회원에게 알린다. 알림이 실패해도 환불 처리 결과는 바꾸지 않는다.
async function notifyMarketRefundProcessed(
  action: 'approve' | 'reject',
  request: { user_id: string; approved_refund_credits: number | null }
) {
  try {
    const approved = action === 'approve'
    const { error } = await createAdminClient().from('notifications').insert({
      user_id: request.user_id,
      type: approved ? 'success' : 'info',
      title: approved ? '문제마켓 환불이 승인되었습니다' : '문제마켓 환불 요청이 거절되었습니다',
      message: approved
        ? typeof request.approved_refund_credits === 'number'
          ? `${request.approved_refund_credits.toLocaleString()} 크레딧이 복구되었습니다.`
          : '크레딧 복구 내역은 크레딧 관리에서 확인해 주세요.'
        : '환불 요청이 승인되지 않았습니다. 자세한 내용은 고객지원으로 문의해 주세요.',
      link: approved ? '/mypage/credits' : '/mypage/support',
      is_read: false,
    })

    if (error) {
      console.error('[MarketRefund] Processed notification failed', {
        errorCode: error.code,
      })
    }
  } catch {
    console.error('[MarketRefund] Processed notification failed', {
      errorCode: 'exception',
    })
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
    const data = parsed.data.action === 'approve'
      ? await approveMarketRefund({
        requestId: id,
        adminId: adminCheck.user.id,
        adminNote: parsed.data.adminNote ?? null,
        confirmedRefundCredits: parsed.data.confirmedRefundCredits,
      })
      : await rejectMarketRefund({ requestId: id, adminId: adminCheck.user.id, adminNote: parsed.data.adminNote ?? null })

    await notifyMarketRefundProcessed(parsed.data.action, data)

    // 처리가 끝난 뒤 작업 기록을 남긴다. 환불 처리 함수는 고치지 않으므로 같은 트랜잭션이 아니다(계획 U3-5).
    // 기록이 빠지면 응답에 경고를 싣고 대표에게 알린다. 처리 결과는 바꾸지 않는다.
    const auditAction = parsed.data.action === 'approve' ? 'market_refund_approve' : 'market_refund_reject'
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
      },
    })
    if (!audited) {
      await alertAdminAuditFailure({ action: auditAction, refTable: 'market_refund_requests', refId: id, link: '/admin/refunds' })
    }

    return NextResponse.json({
      success: true,
      data,
      message: parsed.data.action === 'approve' ? '문제마켓 환불이 승인되었습니다.' : '문제마켓 환불이 거부되었습니다.',
      ...(audited ? {} : { auditWarning: '처리는 완료됐지만 작업 기록을 남기지 못했습니다. 대표 관리자에게 알렸습니다.' }),
    })
  } catch (error) {
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
