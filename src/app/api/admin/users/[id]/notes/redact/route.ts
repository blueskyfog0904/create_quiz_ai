import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { callMemberSuspensionRpc, readMemberRecordOwner } from '@/lib/admin-member-suspension-server'

export const dynamic = 'force-dynamic'

// 12번 묶음(2026-11-26): 관리자 메모 가림(대표 전용). 적지 말아야 할 개인정보가 적힌 메모의 본문을 가림 문구로 바꾼다.
// 가림 문구·작업 기록(글자 수만)은 DB 함수 redact_member_admin_note 가 정한다. 대표 확인도 함수가 다시 한다.

interface RouteContext {
  params: Promise<{ id: string }>
}

const uuid = z.string().uuid()
const BodySchema = z.object({ noteId: uuid }).strict()

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('owner')
  if ('error' in guard) return NextResponse.json({ success: false, error: guard.error }, { status: guard.status })
  const { id } = await params
  if (!uuid.safeParse(id).success) {
    return NextResponse.json({ success: false, error: '회원을 찾을 수 없습니다.' }, { status: 404 })
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: '요청이 올바르지 않습니다.' }, { status: 400 })
  }
  const owner = await readMemberRecordOwner('member_admin_notes', parsed.data.noteId)
  if (!owner.ok) {
    return NextResponse.json({ success: false, error: '메모를 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
  if (owner.userId !== id) {
    return NextResponse.json({ success: false, error: '이 회원의 메모가 아닙니다. 새로고침해 주세요.' }, { status: 404 })
  }
  const result = await callMemberSuspensionRpc('redact_member_admin_note', { p_actor_id: guard.access.userId, p_note_id: parsed.data.noteId })
  if (!result.ok) return NextResponse.json({ success: false, error: result.message, code: result.code }, { status: result.status })
  return NextResponse.json({ success: true, result: result.data })
}
