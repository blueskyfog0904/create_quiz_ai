import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import {
  PointChargeRefundProcessingError,
  processPointChargeRefund,
} from '@/lib/point-charge-refund-processor'
import {
  completeManualPointChargeRefund,
  RefundRpcError,
  rejectPointChargeRefund,
} from '@/lib/point-charge-refunds-server'
import { markWithdrawnRows } from '@/lib/withdrawn-member-redaction-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { notificationFailed, sendMemberNotification } from '@/lib/member-notifications-server'
import { CHARGE_REFUND_REJECT_REASON_MAX, memberTextHasLongNumber } from '@/lib/member-notifications'
import { memberFacingTextPiiHits } from '@/lib/member-facing-text-pii'
import { readPiiAllowedContacts } from '@/lib/site-board-server'

export const dynamic = 'force-dynamic'

const processRefundSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'complete_manual']),
  adminNote: z.string().trim().max(500).optional(),
  // 16번 Q7: 회원에게 보낼 충전 환불 거절 사유(거절 때 필수, 처리 메모와 따로 — 회원에게 그대로 안내됨)
  memberReason: z.string().trim().max(CHARGE_REFUND_REJECT_REASON_MAX).optional(),
  providerNotCancelledConfirmed: z.boolean().optional(),
  externalMethod: z.enum(['payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel']).optional(),
  refundAmount: z.number().int().min(1).max(100_000).optional(),
  recoveredCredits: z.number().int().min(0).optional(),
}).strict()

// 충전 환불 실행·결제 수동확인·경보 해소 권한(refunds.payment)을 공용 가드로 확인한다.
async function requireAdmin() {
  const guard = await requireAdminApiPermission('refunds.payment')
  if ('error' in guard) return { error: guard.error, status: guard.status } as const
  return { user: { id: guard.access.userId }, access: guard.access } as const
}

export async function GET(request: Request) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status }
    )
  }

  const supabase = createPaymentAdminClient()
  const status = new URL(request.url).searchParams.get('status') ?? 'pending_review'
  const { data: requests, error } = await supabase
    .from('refund_requests')
    .select(`
      *,
      user:profiles!refund_requests_user_id_fkey(id, email),
      source:credit_sources(
        id,
        initial_credits,
        remaining_credits,
        purchased_at,
        expires_at,
        plan:pricing_plans(name, price)
      ),
      processor:profiles!refund_requests_processed_by_fkey(id, email)
    `)
    .eq('status', status)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: '환불 요청을 불러오지 못했습니다.' },
      { status: 500 }
    )
  }

  // 10번: 탈퇴 회원의 환불 사유·메모(16번: 회원에게 보낸 거절 사유 포함)는 내보내지 않는다(가리지 못하면 목록을 내보내지 않음).
  let visibleRequests: Awaited<ReturnType<typeof markWithdrawnRows<NonNullable<typeof requests>[number]>>>
  try {
    visibleRequests = await markWithdrawnRows(requests ?? [], (row) => row.user_id, (row) => ({ ...row, reason: null, admin_note: null, member_reject_reason: null }))
  } catch {
    return NextResponse.json(
      { error: '환불 요청을 불러오지 못했습니다.' },
      { status: 500 }
    )
  }

  // 13번 8절: 실린 회원 이메일의 열람을 먼저 기록한다(탈퇴 회원 빼고, 200명씩 나눠 남김). 남기지 못하면 이메일을 가린다(Q4 가).
  const logged = await recordMemberAccess({
    access: adminCheck.access,
    screen: 'refunds.list',
    memberIds: visibleRequests.filter((row) => !row.memberWithdrawn && row.user?.email).map((row) => row.user_id),
    fields: ['email'],
    context: { list: 'payment', status, count: visibleRequests.length },
    requestMeta: adminRequestMeta(request),
  })

  const { data: stats } = await supabase.from('refund_requests').select('status')
  return NextResponse.json({
    requests: logged ? visibleRequests : visibleRequests.map((row) => ({ ...row, user: row.user ? { ...row.user, email: null } : null })),
    stats: {
      pendingCount:
        stats?.filter((item) => item.status === 'pending_review').length ?? 0,
      completedCount:
        stats?.filter((item) => item.status === 'completed').length ?? 0,
      rejectedCount:
        stats?.filter((item) => item.status === 'rejected').length ?? 0,
      attentionCount:
        stats?.filter((item) =>
          ['retryable_failed', 'manual_review'].includes(item.status)
        ).length ?? 0,
    },
  })
}

// 16번: 환불 완료 알림은 공용 함수로(문구는 DB). 실패 여부만 돌려준다 — 환불 결과는 그대로이고 화면에 notificationFailed 로 알린다.
async function notifyRefundCompleted(
  userId: string,
  refundAmount: number,
  externalMethod?: 'payapp_cancel_request' | 'bank_transfer' | 'provider_admin_cancel'
): Promise<boolean> {
  return notificationFailed(await sendMemberNotification({
    kind: externalMethod === 'bank_transfer' ? 'chargeRefundBankTransfer' : 'chargeRefundCompleted',
    userId,
    values: { '{금액}': refundAmount },
  }))
}

// 거절 함수(5인자) 오류 → 응답. 사유 검사는 400, 거절할 수 없는 상태는 409, 그 밖(검사 함수 오류 등)은 거절 전체가 취소된 것이라 503.
const REJECT_ERRORS: Record<string, { status: number; error: string }> = {
  REFUND_REJECT_MEMBER_REASON_REQUIRED: { status: 400, error: '회원에게 보낼 거절 사유를 300자 이내로 적어 주세요.' },
  REFUND_REJECT_MEMBER_REASON_PII: { status: 400, error: '거절 사유에 개인정보로 보이는 글이 있습니다. 지우고 다시 거절해 주세요.' },
  REFUND_REJECT_MEMBER_REASON_LONG_NUMBER: { status: 400, error: '거절 사유에 계좌번호·카드번호 같은 긴 숫자는 적지 마세요.' },
  REFUND_REJECT_ACTOR_REQUIRED: { status: 400, error: '처리하는 관리자를 확인하지 못했습니다. 다시 로그인해 주세요.' },
  REFUND_REQUEST_NOT_REJECTABLE: { status: 409, error: '현재 거절할 수 없는 환불 요청입니다.' },
  REFUND_REJECT_CONFIRMATION_REQUIRED: { status: 409, error: '수동 확인 환불을 거절하려면 결제사 미취소 확인과 처리 메모가 모두 필요합니다.' },
}

export async function PATCH(request: Request) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status }
    )
  }

  const parsed = processRefundSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: '환불 처리 정보가 올바르지 않습니다.' },
      { status: 400 }
    )
  }

  const input = parsed.data
  // 결제사 관리자 취소·계좌 송금으로 이미 환불한 건을 완료 처리한다. 메모와 처리 방식이 필수다.
  if (input.action === 'complete_manual') {
    // 9번: 회수량은 화면이 미리보기에서 받은 값(전액 모드는 쓸 수 있는 몫 합)을 늘 보낸다. 빠지면 DB 가 전량 회수하므로 받지 않는다.
    if (!input.adminNote || !input.externalMethod || !input.refundAmount || input.recoveredCredits === undefined) {
      return NextResponse.json(
        { error: '처리 메모, 외부 처리 방식, 실제 환불 금액, 회수 크레딧을 입력해 주세요.' },
        { status: 400 }
      )
    }

    try {
      const result = await completeManualPointChargeRefund({
        requestId: input.requestId,
        adminId: adminCheck.user.id,
        note: input.adminNote,
        externalMethod: input.externalMethod,
        refundAmount: input.refundAmount,
        recoveredCredits: input.recoveredCredits,
      }) as { already_completed?: boolean; user_id?: string; double_refund_suspected?: boolean } | null

      // 다른 방식으로 이미 완료된 요청에 계좌 송금 완료가 들어왔다. DB가 이중 환불 의심 경보를 남겼다.
      if (result?.double_refund_suspected) {
        return NextResponse.json(
          { error: '이미 다른 방식으로 환불이 완료된 요청입니다. 계좌로 송금했다면 이중 환불이므로 회수해야 합니다.' },
          { status: 409 }
        )
      }

      const failed = result?.user_id && !result.already_completed
        ? await notifyRefundCompleted(result.user_id, input.refundAmount, input.externalMethod)
        : false
      return NextResponse.json({
        success: true,
        message: result?.already_completed
          ? '이미 완료된 환불 요청입니다.'
          : '수동 환불 완료와 크레딧 회수를 기록했습니다.',
        notificationFailed: failed,
      })
    } catch (error) {
      // 회수량은 화면이 미리보기에서 받은 값을 그대로 보낸다(API 는 다시 계산하지 않음). 그사이 원천이 바뀌면 DB 가 거절한다.
      if (error instanceof RefundRpcError && error.code === 'MANUAL_REFUND_RECOVERY_INVALID') {
        return NextResponse.json(
          { error: '그사이 회수할 크레딧이 바뀌었습니다. 새로고침한 뒤 원천별 값을 다시 확인해 주세요.', code: error.code },
          { status: 409 }
        )
      }
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : '수동 환불 완료를 처리하지 못했습니다.',
        },
        { status: 409 }
      )
    }
  }

  if (input.action === 'reject') {
    // 16번 Q7: 회원에게 보낼 거절 사유(필수 1~300자). 개인정보 모양·긴 숫자(계좌·카드번호)는 여기서 먼저 막고 DB 함수가 다시 막는다.
    const memberReason = input.memberReason ?? ''
    if (!memberReason) {
      return NextResponse.json({ error: REJECT_ERRORS.REFUND_REJECT_MEMBER_REASON_REQUIRED.error, code: 'REFUND_REJECT_MEMBER_REASON_REQUIRED' }, { status: 400 })
    }
    if (memberFacingTextPiiHits(memberReason, await readPiiAllowedContacts()).length > 0) {
      return NextResponse.json({ error: REJECT_ERRORS.REFUND_REJECT_MEMBER_REASON_PII.error, code: 'REFUND_REJECT_MEMBER_REASON_PII' }, { status: 400 })
    }
    if (memberTextHasLongNumber(memberReason)) {
      return NextResponse.json({ error: REJECT_ERRORS.REFUND_REJECT_MEMBER_REASON_LONG_NUMBER.error, code: 'REFUND_REJECT_MEMBER_REASON_LONG_NUMBER' }, { status: 400 })
    }
    let rejected: { userId: string | null; memberReason: string }
    try {
      rejected = await rejectPointChargeRefund({
        requestId: input.requestId,
        adminId: adminCheck.user.id,
        adminNote: input.adminNote ?? null,
        providerNotCancelledConfirmed: input.providerNotCancelledConfirmed ?? false,
        memberReason,
      })
    } catch (error) {
      const code = error instanceof RefundRpcError ? error.code : null
      const known = code ? REJECT_ERRORS[code] : undefined
      if (known) return NextResponse.json({ error: known.error, code }, { status: known.status })
      // 검사 함수 오류·연결 오류: 거절 전체가 취소됐다(닫힌 쪽으로 실패)
      return NextResponse.json({ error: '환불 요청을 거절하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
    }
    // 재요청은 REFUND_REQUEST_NOT_REJECTABLE 예외라 여기까지 오지 않는다(알림이 다시 가지 않음). 처리 메모는 알림에 넣지 않는다.
    // 알림·실패 안내에는 DB 가 저장한(다듬은) 사유를 쓴다(회원이 받는 글 = 증빙). 회원 id 를 돌려받지 못하면 거절은 됐고 알림만 못 보낸 것.
    const failed = rejected.userId
      ? notificationFailed(await sendMemberNotification({
        kind: 'chargeRefundRejected',
        userId: rejected.userId,
        values: { '{사유}': rejected.memberReason },
      }))
      : true
    return NextResponse.json({
      success: true,
      message: '환불 요청을 거절하고 크레딧 동결을 해제했습니다.',
      notificationFailed: failed,
      // 알림이 실패하면 저장된 사유를 돌려준다 — 거절 창이 지우지 않고 보여 주어 고객지원으로 그대로 옮길 수 있게.
      ...(failed ? { memberReason: rejected.memberReason } : {}),
    })
  }

  try {
    const result = await processPointChargeRefund({
      requestId: input.requestId,
      adminId: adminCheck.user.id,
      adminNote: input.adminNote ?? null,
    })

    if (result.alreadyCompleted) {
      return NextResponse.json({
        success: true,
        message: '이미 원 결제수단 환불이 완료된 요청입니다.',
      })
    }

    // 관리자 결제 확인 주문은 자동 취소하지 않는다. 사용자 알림도 보내지 않는다.
    if (result.manualReviewRequired) {
      return NextResponse.json({
        success: true,
        message: '관리자 결제 확인 주문이라 자동 취소하지 않고 수동 확인으로 보냈습니다. 페이앱 관리자에서 결제를 대조해 취소한 뒤 수동 완료로 처리하세요.',
      })
    }

    const failed = result.claimed.user_id && result.claimed.refund_amount
      ? await notifyRefundCompleted(result.claimed.user_id, result.claimed.refund_amount)
      : false

    return NextResponse.json({
      success: true,
      newBalance: result.newBalance,
      message: '원 결제수단 환불과 크레딧 회수가 완료되었습니다.',
      notificationFailed: failed,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '환불 처리 결과를 확인해야 합니다.',
      },
      {
        status:
          error instanceof PointChargeRefundProcessingError
            ? error.status
            : 502,
      }
    )
  }
}
