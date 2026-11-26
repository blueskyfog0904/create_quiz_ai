import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { UUID_PATTERN } from '@/lib/admin-orders'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { createAdminClient } from '@/lib/supabase/bypass'
import { readWithdrawnUserIdsForRedaction } from '@/lib/withdrawn-member-redaction-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// 13번 5절: 문의 상세의 '이전 답변'(접어 둔 목록). 답변 이력 표는 서버 키로만 읽는다(직원 세션 권한 없음).
// 탈퇴 회원 문의는 404(열람은 대표의 탈퇴 보관 열람 경로로만). 열면 열람 기록 support.ticket(answer_history)을 먼저 남긴다.
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
    const db = createAdminClient() as unknown as SupabaseClient
    const { data: ticket, error } = await db.from('support_tickets').select('user_id').eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    const userId = (ticket as { user_id: string } | null)?.user_id
    if (!userId || (await readWithdrawnUserIdsForRedaction([userId])).has(userId)) {
      return NextResponse.json({ error: '문의를 찾을 수 없습니다.' }, { status: 404 })
    }

    const { data: revisions, error: revisionsError } = await db
      .from('support_ticket_answer_revisions')
      .select('id, previous_response, previous_shown_at, edited_by, reason, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: false })
    if (revisionsError) throw new Error(revisionsError.message)
    // 보일 이전 답변이 없으면 열람한 것이 없다(기록하지 않음).
    if (!revisions || revisions.length === 0) return NextResponse.json({ success: true, revisions: [] })

    const logged = await recordMemberAccess({
      access: guard.access,
      screen: 'support.ticket',
      memberIds: [userId],
      fields: ['answer_history'],
      context: { ticketId: id, count: revisions.length },
      requestMeta: adminRequestMeta(request),
    })
    if (!logged) {
      return NextResponse.json({ error: '열람 기록을 남기지 못해 이전 답변을 보여 드릴 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
    }

    return NextResponse.json({ success: true, revisions })
  } catch (error) {
    console.error('[admin-support] 이전 답변을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '이전 답변을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
}
