import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { callMemberSuspensionRpc, readMemberRecordOwner } from '@/lib/admin-member-suspension-server'

export const dynamic = 'force-dynamic'

// 12번 묶음(계획 4-3·6-2): 회원 관리자 메모 추가·지우기. 권한은 members.memo 가드와 DB 함수 둘 다 본다.
// 지우기는 작성자 본인(members.memo)이나 대표만 — DB 함수가 MEMBER_NOTE_ACTOR_NOT_ALLOWED 로 거절한다. 가림은 대표 전용 route(./redact).

interface RouteContext {
  params: Promise<{ id: string }>
}

const uuid = z.string().uuid()

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    body: z.string().trim().min(1, '메모를 적어 주세요.').max(2000, '메모는 2000자 이내로 적어 주세요.'),
  }).strict(),
  z.object({ action: z.literal('delete'), noteId: uuid }).strict(),
])

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('members.memo')
  if ('error' in guard) return NextResponse.json({ success: false, error: guard.error }, { status: guard.status })
  const { id } = await params
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ success: false, error: '회원을 찾을 수 없습니다.' }, { status: 404 })
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? '요청이 올바르지 않습니다.' }, { status: 400 })
  }
  const body = parsed.data
  const actorId = guard.access.userId

  if (body.action === 'add') {
    const result = await callMemberSuspensionRpc('add_member_admin_note', { p_actor_id: actorId, p_user_id: id, p_body: body.body })
    if (!result.ok) return NextResponse.json({ success: false, error: result.message, code: result.code }, { status: result.status })
    return NextResponse.json({ success: true, result: result.data })
  }

  const owner = await readMemberRecordOwner('member_admin_notes', body.noteId)
  if (!owner.ok) {
    return NextResponse.json({ success: false, error: '메모를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
  if (owner.userId !== id) {
    return NextResponse.json({ success: false, error: '이 회원의 메모가 아닙니다. 새로고침해 주세요.' }, { status: 404 })
  }
  const result = await callMemberSuspensionRpc('delete_member_admin_note', { p_actor_id: actorId, p_note_id: body.noteId })
  if (!result.ok) return NextResponse.json({ success: false, error: result.message, code: result.code }, { status: result.status })
  return NextResponse.json({ success: true, result: result.data })
}
