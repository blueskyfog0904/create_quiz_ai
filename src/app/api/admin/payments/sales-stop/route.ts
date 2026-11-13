import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractAdminLoginId } from '@/lib/admin-accounts-shared'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const stopSchema = z.object({
  reason: z.string().trim().min(1).max(300),
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

// 충전 판매 전체 중지. 중지만 한다 — 재개는 조건 확인이 필요해 SQL Editor에서 한다(supabase/ops/payment_sales_stop_resume.sql).
// 처리자는 요청 본문이 아니라 세션 사용자로 기록한다.
export async function POST(request: Request) {
  const adminCheck = await requireAdmin()
  if ('error' in adminCheck) {
    return NextResponse.json({ error: adminCheck.error }, { status: adminCheck.status })
  }

  const parsed = stopSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '중지 사유를 입력해 주세요(300자 이내).' }, { status: 400 })
  }

  const { user } = adminCheck
  const { data, error } = await createPaymentAdminClient().rpc('stop_payment_sales', {
    p_scope: 'master',
    p_changed_by: `admin:${user.email ? extractAdminLoginId(user.email) : user.id}`,
    p_reason: parsed.data.reason,
  })

  const result = data as { changed?: boolean; master_accepts_new_orders?: boolean } | null
  // 꺼졌다는 것을 응답으로 확인하지 못하면 성공이라고 하지 않는다.
  if (error || result?.master_accepts_new_orders !== false) {
    console.error('[sales-stop] 충전 판매 중지 실패', error)
    return NextResponse.json(
      { error: '충전 판매를 중지하지 못했습니다. 화면을 새로고침해 현재 상태를 확인하고, 그대로면 SQL Editor에서 중지해 주세요.' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    message: result.changed ? '충전 판매를 중지했습니다.' : '충전 판매가 이미 중지되어 있습니다.',
  })
}
