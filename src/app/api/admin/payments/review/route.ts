import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const reviewSchema = z.object({
  paymentOrderId: z.string().uuid(),
  action: z.enum(['paid_confirmed', 'unpaid_confirmed', 'cancel_handled']),
  note: z.string().trim().min(1).max(500),
  mulNo: z.string().regex(/^[0-9]{1,40}$/).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  externalMethod: z.enum(['payapp_cancel_request', 'bank_transfer', 'provider_admin_cancel']).optional(),
}).strict()

const reviewErrorMessages: Record<string, string> = {
  PAYMENT_REVIEW_INPUT_INVALID: '처리 내용과 메모를 확인해 주세요.',
  PAYMENT_ORDER_NOT_FOUND: '주문을 찾을 수 없습니다.',
  PAYMENT_REVIEW_NOT_PENDING: '이미 처리된 주문입니다. 새로고침 후 다시 확인해 주세요.',
  PAYMENT_REVIEW_ACTION_NOT_ALLOWED: '이 주문의 현재 상태에서는 선택한 처리를 할 수 없습니다. 새로고침 후 가능한 처리를 다시 확인해 주세요.',
  PAYMENT_REVIEW_MUL_NO_INVALID: '페이앱 결제요청번호를 확인해 주세요.',
  PAYMENT_REVIEW_PAID_AT_INVALID: '결제 시각은 주문 생성 이후, 현재 이전이어야 합니다.',
  PAYAPP_MUL_NO_CONFLICT: '다른 주문에 이미 쓰인 결제요청번호입니다.',
  PAYAPP_ORDER_NOT_FULFILLABLE: '지급할 수 없는 주문 상태입니다. 새로고침 후 다시 확인해 주세요.',
  PAYMENT_ORDER_USER_NOT_FOUND: '주문한 회원을 찾을 수 없습니다.',
}

const TRANSIENT_DATABASE_ERRORS = ['40P01', '40001', '55P03', '57014']

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

// 관리자 결제 확인(계획 6.4). 모든 조치는 감사 기록으로 남고 관련 경보를 해소한다.
export async function PATCH(request: Request) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status })
  }

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '처리 내용과 메모를 확인해 주세요.' }, { status: 400 })
  }

  const input = parsed.data
  const admin = createPaymentAdminClient()
  // 생성 타입은 선택 인자를 표현하지만 null은 표현하지 못한다. 없는 값은 보내지 않는다.
  const { data, error } = await admin.rpc('resolve_payment_order_review', {
    p_payment_order_id: input.paymentOrderId,
    p_action: input.action,
    p_actor_id: adminCheck.user.id,
    p_note: input.note,
    ...(input.mulNo ? { p_mul_no: input.mulNo } : {}),
    ...(input.paidAt ? { p_paid_at: input.paidAt } : {}),
    ...(input.externalMethod ? { p_external_method: input.externalMethod } : {}),
  })

  if (error) {
    if (!error.code || TRANSIENT_DATABASE_ERRORS.includes(error.code)) {
      return NextResponse.json(
        { error: '다른 처리와 겹쳤습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 503 }
      )
    }
    const code = Object.keys(reviewErrorMessages).find((key) => error.message?.includes(key))
    return NextResponse.json(
      { error: code ? reviewErrorMessages[code] : '결제 확인을 처리하지 못했습니다.', code },
      { status: 409 }
    )
  }

  const result = data as { status?: string; user_id?: string } | null
  if (input.action === 'paid_confirmed' && result?.status === 'completed' && result.user_id) {
    const { error: notificationError } = await admin.from('notifications').insert({
      user_id: result.user_id,
      type: 'success',
      title: '크레딧 충전 완료',
      message: '결제가 확인되어 크레딧이 충전되었습니다.',
      link: '/mypage/credits',
      is_read: false,
    })
    if (notificationError) {
      console.error('[PaymentReview] Completion notification failed', {
        errorCode: notificationError.code,
      })
    }
  }

  return NextResponse.json({
    success: true,
    status: result?.status ?? null,
    message: '결제 확인 처리를 기록했습니다.',
  })
}
