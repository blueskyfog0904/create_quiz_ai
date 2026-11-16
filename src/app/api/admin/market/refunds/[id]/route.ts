import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
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

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized', status: 401 } as const
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: 'Forbidden: Admin only', status: 403 } as const
  }

  return { user } as const
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

    return NextResponse.json({
      success: true,
      data,
      message: parsed.data.action === 'approve' ? '문제마켓 환불이 승인되었습니다.' : '문제마켓 환불이 거부되었습니다.',
    })
  } catch (error) {
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
