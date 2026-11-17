import { NextRequest, NextResponse } from 'next/server'
import { UUID_PATTERN } from '@/lib/admin-orders'
import { getAdminMemberSummary } from '@/lib/admin-member-detail-server'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { createAdminClient } from '@/lib/supabase/bypass'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// 문의 상세 창의 회원 요약(건수). 조회만 한다. 회원은 주소가 아니라 그 문의에서 읽는다.
export async function GET(_request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('support.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { id } = await params
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: '문의를 찾을 수 없습니다.' }, { status: 404 })
  }

  try {
    const { data: ticket, error } = await createAdminClient()
      .from('support_tickets')
      .select('user_id')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!ticket) {
      return NextResponse.json({ error: '문의를 찾을 수 없습니다.' }, { status: 404 })
    }

    const summary = await getAdminMemberSummary(guard.access, ticket.user_id, id)
    return NextResponse.json({ success: true, data: summary })
  } catch (error) {
    console.error('[admin-support] 회원 요약을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '회원 요약을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
