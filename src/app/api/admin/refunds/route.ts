import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import {
  PointChargeRefundProcessingError,
  processPointChargeRefund,
} from '@/lib/point-charge-refund-processor'
import {
  completeManualPointChargeRefund,
  rejectPointChargeRefund,
} from '@/lib/point-charge-refunds-server'

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
    if (!input.adminNote || !input.externalMethod || !input.refundAmount) {
      return NextResponse.json(
        { error: '처리 메모, 외부 처리 방식, 실제 환불 금액을 입력해 주세요.' },
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
        recoveredCredits: input.recoveredCredits ?? null,
      }) as { already_completed?: boolean; user_id?: string } | null

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
