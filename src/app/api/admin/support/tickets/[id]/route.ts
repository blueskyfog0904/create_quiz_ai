import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { adminRequestMeta } from '@/lib/admin-request-meta'
import { getSupportPageContent } from '@/lib/support-page-content-server'
import { fillSupportNotificationText, type SupportPageContent } from '@/lib/support-page-content'
import { findTemplateBlanks } from '@/lib/support-reply-template'

export const dynamic = 'force-dynamic'

// 13번 5절: 첫 답변과 답변 수정을 한 route 로 받는다. 저장·작업 기록·이력은 DB 함수 save_support_ticket_answer 가
// 한 거래에서 한다(세션 UPDATE 없음). 화면은 지금 보이는 답변의 sha256(없으면 빈 글)과 창을 열 때 만든 operationKey 를 보낸다.
const TicketUpdateSchema = z.object({
  adminResponse: z.string().trim().min(1, '답변을 입력해 주세요.').max(10000, '답변은 10000자 이하로 적어 주세요.'),
  status: z.enum(['in_progress', 'resolved', 'closed']).optional(),
  expectedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  reason: z.string().trim().max(300, '수정 사유는 300자 이하로 적어 주세요.').optional(),
  operationKey: z.string().uuid(),
})

interface RouteContext {
  params: Promise<{ id: string }>
}

interface SavedTicket {
  id: string
  user_id: string
  subject: string
  status: string
  admin_response: string | null
  responded_at: string | null
  response_edited_at: string | null
  updated_at: string | null
}

interface SaveAnswerResult {
  ticket: SavedTicket
  isEdit: boolean
  historyId: string | null
  replayed: boolean
}

// DB 함수 오류 코드 → 응답
const ERRORS: Record<string, { status: number; error: string }> = {
  SUPPORT_ANSWER_INPUT_INVALID: { status: 400, error: '답변 입력값이 올바르지 않습니다.' },
  SUPPORT_ANSWER_ACTOR_NOT_ALLOWED: { status: 403, error: '문의 답변 권한이 없습니다.' },
  SUPPORT_TICKET_NOT_FOUND: { status: 404, error: '문의를 찾을 수 없습니다.' },
  SUPPORT_TICKET_DELETED_BY_MEMBER: { status: 409, error: '회원이 삭제한 문의라 답변을 저장할 수 없습니다.' },
  MEMBER_WITHDRAWN: { status: 409, error: '탈퇴한 회원의 문의라 답변을 저장할 수 없습니다.' },
  SUPPORT_ANSWER_CONFLICT: { status: 409, error: '다른 관리자가 먼저 답변을 저장하거나 고쳤습니다. 최신 답변을 다시 불러왔으니 확인 후 다시 저장해 주세요.' },
  SUPPORT_ANSWER_REASON_REQUIRED: { status: 400, error: '수정 사유를 적어 주세요.' },
  SUPPORT_ANSWER_UNCHANGED: { status: 400, error: '바뀐 내용이 없습니다.' },
}

const db = () => createAdminClient() as unknown as SupabaseClient

function errorCode(message: string | undefined) {
  return Object.keys(ERRORS).find((code) => message?.includes(code)) ?? null
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('support.manage')
  if ('error' in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = TicketUpdateSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || '답변 입력값이 올바르지 않습니다.' }, { status: 400 })
  }

  // 빈칸 표시(DB 값)가 남은 답변은 저장하지 않는다. 표시 값을 읽지 못하면 검사할 수 없으므로 저장을 막는다.
  let content: SupportPageContent
  try {
    content = await getSupportPageContent()
  } catch (error) {
    console.error('[SupportTicket] support page content unavailable', { message: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: '답변 검사에 필요한 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
  if (findTemplateBlanks(parsed.data.adminResponse, content.admin.templateBlankMarker).length > 0) {
    return NextResponse.json({
      error: `채우지 않은 빈칸(${content.admin.templateBlankMarker})이 남아 있습니다. 내용을 채운 뒤 저장해 주세요.`,
      code: 'SUPPORT_ANSWER_BLANK_LEFT',
    }, { status: 400 })
  }

  const { data, error } = await db().rpc('save_support_ticket_answer', {
    p_actor_id: guard.access.userId,
    p_ticket_id: id,
    p_response: parsed.data.adminResponse,
    p_status: parsed.data.status ?? null,
    p_expected_sha256: parsed.data.expectedSha256,
    p_reason: parsed.data.reason ? parsed.data.reason : null,
    p_operation_key: parsed.data.operationKey,
    p_request_meta: adminRequestMeta(request),
  })

  if (error) {
    const code = errorCode(error.message)
    if (!code) {
      console.error('[SupportTicket] save answer failed', { errorCode: error.code })
      return NextResponse.json({ error: '답변을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
    }
    // 충돌이면 최신 답변을 함께 돌려준다(화면이 다시 읽어 보여 준다).
    if (code === 'SUPPORT_ANSWER_CONFLICT') {
      const { data: latest } = await db()
        .from('support_tickets')
        .select('id, status, admin_response, responded_at, response_edited_at, updated_at')
        .eq('id', id)
        .maybeSingle()
      return NextResponse.json({ ...ERRORS[code], code, latest: latest ?? null }, { status: ERRORS[code].status })
    }
    return NextResponse.json({ error: ERRORS[code].error, code }, { status: ERRORS[code].status })
  }

  const result = data as SaveAnswerResult
  const ticket = result.ticket

  // 같은 operationKey 로 다시 온 요청(재요청)이면 알림을 다시 보내지 않는다(첫 요청 때 결과로 이미 안내했다).
  if (result.replayed) {
    return NextResponse.json({ success: true, ticket, isEdit: result.isEdit, replayed: true })
  }

  // 수정 알림은 설정(notifyOnAnswerEdit)이 켜져 있을 때만 같은 type 으로 보낸다.
  if (result.isEdit && !content.admin.notifyOnAnswerEdit) {
    return NextResponse.json({ success: true, ticket, isEdit: true })
  }

  const title = result.isEdit ? content.member.answerEditedNotificationTitle : content.member.answerCreatedNotificationTitle
  const message = result.isEdit ? content.member.answerEditedNotificationMessage : content.member.answerCreatedNotificationMessage
  if (!title.trim() || !message.trim()) {
    return NextResponse.json({ success: true, ticket, isEdit: result.isEdit, notificationFailed: true })
  }

  // 회원 알림은 서버 키로 넣는다(관리자 세션의 알림 INSERT 정책을 없앨 수 있게 — 20261117140000 3절).
  const { error: notificationError } = await createAdminClient().from('notifications').insert({
    user_id: ticket.user_id,
    type: 'inquiry_reply',
    title: fillSupportNotificationText(title, ticket.subject),
    message: fillSupportNotificationText(message, ticket.subject),
    link: '/mypage/support',
  })

  // 답변은 이미 저장됐다. 알림만 실패한 경우 화면이 안내하도록 표시한다.
  if (notificationError) {
    console.error('[SupportTicket] Reply notification failed', {
      errorCode: notificationError.code,
    })
    return NextResponse.json({ success: true, ticket, isEdit: result.isEdit, notificationFailed: true })
  }

  return NextResponse.json({ success: true, ticket, isEdit: result.isEdit })
}
