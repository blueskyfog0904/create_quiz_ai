import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const TicketUpdateSchema = z.object({
  adminResponse: z.string().trim().min(1),
  status: z.enum(['in_progress', 'resolved', 'closed']).optional(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  if (!profile?.is_admin) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  return { supabase, user }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const admin = await requireAdmin()
  if ('error' in admin) return admin.error

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = TicketUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '답변 입력값이 올바르지 않습니다.' }, { status: 400 })
  }

  const { data: ticket, error } = await admin.supabase
    .from('support_tickets')
    .update({
      admin_response: parsed.data.adminResponse,
      status: parsed.data.status || 'resolved',
      responded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    // 회원이 삭제한 문의는 읽기 전용이다. 답변을 저장하지 않는다.
    .eq('is_deleted_by_user', false)
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!ticket) {
    return NextResponse.json({ error: '문의를 찾을 수 없거나 회원이 삭제한 문의입니다.' }, { status: 404 })
  }

  const { error: notificationError } = await admin.supabase.from('notifications').insert({
    user_id: ticket.user_id,
    type: 'inquiry_reply',
    title: '문의하신 내용에 답변이 등록되었습니다.',
    message: `제목: ${ticket.subject}\n\n답변을 확인해보세요.`,
    link: '/mypage/support',
  })

  // 답변은 이미 저장됐다. 알림만 실패한 경우 화면이 안내하도록 표시한다.
  if (notificationError) {
    console.error('[SupportTicket] Reply notification failed', {
      errorCode: notificationError.code,
    })
    return NextResponse.json({ success: true, ticket, notificationFailed: true })
  }

  return NextResponse.json({ success: true, ticket })
}
