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

export const dynamic = 'force-dynamic'

const processRefundSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'complete_manual']),
  adminNote: z.string().trim().max(500).optional(),
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

  // 10번: 탈퇴 회원의 환불 사유·메모는 내보내지 않는다(가리지 못하면 목록을 내보내지 않음).
  let visibleRequests: Awaited<ReturnType<typeof markWithdrawnRows<NonNullable<typeof requests>[number]>>>
  try {
    visibleRequests = await markWithdrawnRows(requests ?? [], (row) => row.user_id, (row) => ({ ...row, reason: null, admin_note: null }))
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

async function notifyRefundCompleted(
  userId: string,
  refundAmount: number,
  externalMethod?: 'payapp_cancel_request' | 'bank_transfer' | 'provider_admin_cancel'
) {
  const admin = createPaymentAdminClient()
  const bankTransfer = externalMethod === 'bank_transfer'
  const { error } = await admin.from('notifications').insert({
    user_id: userId,
    type: 'success',
    title: bankTransfer ? '환불이 완료되었습니다' : '원 결제수단 환불이 완료되었습니다',
    message: bankTransfer
      ? `${refundAmount.toLocaleString()}원을 계좌로 환불했습니다.`
      : `${refundAmount.toLocaleString()}원 결제 취소가 완료되었습니다. 환불 반영 시점은 결제수단에 따라 다를 수 있습니다.`,
    link: '/mypage/payments',
    is_read: false,
  })

  if (error) {
    console.error('[PointChargeRefund] Completion notification failed', {
      errorCode: error.code,
    })
  }
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

      if (result?.user_id && !result.already_completed) {
        await notifyRefundCompleted(result.user_id, input.refundAmount, input.externalMethod)
      }
      return NextResponse.json({
        success: true,
        message: result?.already_completed
          ? '이미 완료된 환불 요청입니다.'
          : '수동 환불 완료와 크레딧 회수를 기록했습니다.',
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
    try {
      await rejectPointChargeRefund({
        requestId: input.requestId,
        adminId: adminCheck.user.id,
        adminNote: input.adminNote ?? null,
        providerNotCancelledConfirmed: input.providerNotCancelledConfirmed ?? false,
      })
      return NextResponse.json({
        success: true,
        message: '환불 요청을 거절하고 크레딧 동결을 해제했습니다.',
      })
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : '환불 요청을 거절하지 못했습니다.',
        },
        { status: 409 }
      )
    }
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

    if (result.claimed.user_id && result.claimed.refund_amount) {
      await notifyRefundCompleted(
        result.claimed.user_id,
        result.claimed.refund_amount
      )
    }

    return NextResponse.json({
      success: true,
      newBalance: result.newBalance,
      message: '원 결제수단 환불과 크레딧 회수가 완료되었습니다.',
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
