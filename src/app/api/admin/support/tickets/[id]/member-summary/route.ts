import { NextRequest, NextResponse } from 'next/server'
import { UUID_PATTERN } from '@/lib/admin-orders'
import { getAdminMemberSummary } from '@/lib/admin-member-detail-server'
import { readMemberContacts, recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { readWithdrawnUserIdsForRedaction } from '@/lib/withdrawn-member-redaction-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// 문의 상세 창의 회원 요약(건수)과 연락처. 조회만 한다. 회원은 주소가 아니라 그 문의에서 읽는다.
// 13번 8-2: 전화번호는 목록에 싣지 않고 여기서만 준다(서버 키). 돌려주기 전에 열람 기록 support.ticket(email·phone)을 남기고,
// 기록에 실패하면 연락처를 가린다(contact: null, contactMasked: true — Q4 가).
export async function GET(request: NextRequest, { params }: RouteContext) {
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
    // 10번: 탈퇴 회원 문의는 화면 세션(RLS)에서 열리지 않는다. 서버 키 경로도 같은 결과로 둔다(열람은 대표 열람 기록 경로로만).
    if ((await readWithdrawnUserIdsForRedaction([ticket.user_id])).has(ticket.user_id)) {
      return NextResponse.json({ error: '문의를 찾을 수 없습니다.' }, { status: 404 })
    }

    const summary = await getAdminMemberSummary(guard.access, ticket.user_id, id)
    const contact = (await readMemberContacts([ticket.user_id])).get(ticket.user_id) ?? null
    const logged = contact
      ? await recordMemberAccess({
          access: guard.access,
          screen: 'support.ticket',
          memberIds: [ticket.user_id],
          fields: ['email', 'phone'],
          context: { ticketId: id },
          requestMeta: adminRequestMeta(request),
        })
      : true
    return NextResponse.json({
      success: true,
      data: summary,
      contact: contact && logged ? { email: contact.email, phone: contact.phone } : null,
      contactMasked: !logged,
    })
  } catch (error) {
    console.error('[admin-support] 회원 요약을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '회원 요약을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
