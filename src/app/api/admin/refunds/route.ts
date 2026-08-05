import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import {
  claimPointChargeRefund,
  failPointChargeRefund,
  finalizePointChargeRefund,
  rejectPointChargeRefund,
  type ClaimedPointChargeRefund,
} from '@/lib/point-charge-refunds-server'
import {
  cancelTossPayment,
  getCompletedFullCancellation,
  TossPaymentsError,
} from '@/lib/toss-payments-server'

export const dynamic = 'force-dynamic'

const processRefundSchema = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  adminNote: z.string().trim().max(500).optional(),
}).strict()

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized', status: 401 } as const
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: 'Forbidden', status: 403 } as const
  }

  return { user } as const
}

export async function GET(request: Request) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json(
      { error: adminCheck.error },
      { status: adminCheck.status }
    )
  }

  const supabase = await createClient()
  const status = new URL(request.url).searchParams.get('status') ?? 'pending_review'
  const { data: requests, error } = await supabase
    .from('refund_requests')
    .select(`
      *,
      user:profiles!refund_requests_user_id_fkey(id, name, email),
      source:credit_sources(
        id,
        initial_credits,
        remaining_credits,
        purchased_at,
        expires_at,
        plan:pricing_plans(name, price)
      ),
      processor:profiles!refund_requests_processed_by_fkey(id, name)
    `)
    .eq('status', status)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json(
      { error: '환불 요청을 불러오지 못했습니다.' },
      { status: 500 }
    )
  }

  const { data: stats } = await supabase.from('refund_requests').select('status')
  return NextResponse.json({
    requests: requests ?? [],
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

async function notifyRefundCompleted(userId: string, refundAmount: number) {
  const admin = createPaymentAdminClient()
  const { error } = await admin.from('notifications').insert({
    user_id: userId,
    type: 'success',
    title: '원 결제수단 환불이 완료되었습니다',
    message: `${refundAmount.toLocaleString()}원 결제 취소가 완료되었습니다. 카드사 반영 시점은 결제수단에 따라 다를 수 있습니다.`,
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
  if (input.action === 'reject') {
    try {
      await rejectPointChargeRefund({
        requestId: input.requestId,
        adminId: adminCheck.user.id,
        adminNote: input.adminNote ?? null,
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

  let claimed: ClaimedPointChargeRefund | null = null
  try {
    claimed = await claimPointChargeRefund({
      requestId: input.requestId,
      adminId: adminCheck.user.id,
      adminNote: input.adminNote ?? null,
    })

    if (claimed.already_completed) {
      return NextResponse.json({
        success: true,
        message: '이미 원 결제수단 환불이 완료된 요청입니다.',
      })
    }

    if (
      !claimed.payment_key ||
      !claimed.cancel_idempotency_key ||
      !claimed.refund_amount
    ) {
      throw new Error('환불할 원 결제 정보를 확인할 수 없습니다.')
    }

    const canceledPayment = await cancelTossPayment({
      paymentKey: claimed.payment_key,
      cancelReason: input.adminNote || '충전 크레딧 환불 승인',
      idempotencyKey: claimed.cancel_idempotency_key,
    })
    const cancellation = getCompletedFullCancellation(
      canceledPayment,
      claimed.refund_amount
    )
    const result = await finalizePointChargeRefund({
      requestId: input.requestId,
      cancelTransactionKey: cancellation.transactionKey,
      cancelledAt: cancellation.canceledAt,
    })

    if (claimed.user_id) {
      await notifyRefundCompleted(claimed.user_id, claimed.refund_amount)
    }

    return NextResponse.json({
      success: true,
      newBalance: result.new_balance,
      message: '원 결제수단 환불과 크레딧 회수가 완료되었습니다.',
    })
  } catch (error) {
    if (claimed && !claimed.already_completed) {
      const retryable =
        !(error instanceof TossPaymentsError) || error.status >= 500
      await failPointChargeRefund({
        requestId: input.requestId,
        code:
          error instanceof TossPaymentsError
            ? error.code
            : 'REFUND_PROCESSING_FAILED',
        message:
          error instanceof Error
            ? error.message
            : '환불 처리 결과를 확인해야 합니다.',
        retryable,
      }).catch(() => undefined)
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : '환불 처리 결과를 확인해야 합니다.',
      },
      { status: 502 }
    )
  }
}
