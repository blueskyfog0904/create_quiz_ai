import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const resolveAlertSchema = z.object({
  alertId: z.string().uuid(),
  note: z.string().trim().min(1).max(500),
}).strict()

const alertErrorMessages: Record<string, string> = {
  PAYMENT_ALERT_INPUT_INVALID: '처리 메모를 확인해 주세요.',
  PAYMENT_ALERT_NOT_FOUND: '경보를 찾을 수 없습니다.',
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

// 관리자 결제 경보 해소. 처리자는 요청 본문이 아니라 세션 사용자로 기록한다.
export async function PATCH(request: Request) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status })
  }

  const parsed = resolveAlertSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '처리 메모를 확인해 주세요.' }, { status: 400 })
  }

  const admin = createPaymentAdminClient()
  const { data, error } = await admin.rpc('resolve_payment_alert', {
    p_alert_id: parsed.data.alertId,
    p_actor_id: adminCheck.user.id,
    p_note: parsed.data.note,
  })

  if (error) {
    if (!error.code || TRANSIENT_DATABASE_ERRORS.includes(error.code)) {
      return NextResponse.json(
        { error: '다른 처리와 겹쳤습니다. 잠시 후 다시 시도해 주세요.' },
        { status: 503 }
      )
    }
    const code = Object.keys(alertErrorMessages).find((key) => error.message?.includes(key))
    if (!code) {
      console.error('[PaymentAlert] Resolve failed', { errorCode: error.code })
      return NextResponse.json({ error: '경보를 해소하지 못했습니다.' }, { status: 500 })
    }
    return NextResponse.json({ error: alertErrorMessages[code], code }, { status: 409 })
  }

  const result = data as { already_resolved?: boolean } | null
  return NextResponse.json({
    success: true,
    message: result?.already_resolved ? '이미 해소된 경보입니다.' : '경보 해소를 기록했습니다.',
  })
}
