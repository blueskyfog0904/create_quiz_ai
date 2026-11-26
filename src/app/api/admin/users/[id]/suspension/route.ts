import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { callMemberSuspensionRpc, readMemberRecordOwner } from '@/lib/admin-member-suspension-server'

export const dynamic = 'force-dynamic'

// 12번 묶음(계획 4-3·6-2): 회원 이용 정지·해제·알림 기록. 권한은 members.suspend 가드와 DB 함수 둘 다 본다.
// 로그인 차단과 그 해제·알림 기록은 대표만이다 — DB 함수가 MEMBER_SUSPEND_ACTOR_NOT_ALLOWED 로 거절한다(화면도 대표에게만 보인다).
// 작업 기록은 DB 함수가 같은 거래에서 남긴다(자유 글 없음).

interface RouteContext {
  params: Promise<{ id: string }>
}

const uuid = z.string().uuid()
const datetime = z.string().datetime({ offset: true })

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('suspend'),
    scope: z.enum(['restricted', 'login_blocked']),
    blocksDownload: z.boolean().nullable(),
    reasonCode: z.string().trim().min(1).max(40),
    memberReason: z.string().trim().min(1, '회원에게 알릴 사유를 적어 주세요.').max(500, '회원에게 알릴 사유는 500자 이내로 적어 주세요.'),
    internalNote: z.string().trim().max(2000, '내부 메모는 2000자 이내로 적어 주세요.'),
    endsAt: datetime.nullable(),
    operationKey: z.string().trim().min(8).max(200),
  }).strict(),
  z.object({
    action: z.literal('lift'),
    suspensionId: uuid,
    liftReason: z.string().trim().min(1, '해제 사유를 적어 주세요.').max(500, '해제 사유는 500자 이내로 적어 주세요.'),
  }).strict(),
  z.object({
    action: z.literal('notice'),
    suspensionId: uuid,
    via: z.enum(['screen', 'email', 'phone']),
    sentAt: datetime,
    summary: z.string().trim().max(500, '요약은 500자 이내로 적어 주세요.'),
  }).strict(),
])

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('members.suspend')
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

  if (body.action === 'suspend') {
    const result = await callMemberSuspensionRpc('suspend_member', {
      p_actor_id: actorId,
      p_user_id: id,
      p_scope: body.scope,
      p_blocks_download: body.scope === 'login_blocked' ? true : body.blocksDownload,
      p_reason_code: body.reasonCode,
      p_member_reason: body.memberReason,
      p_internal_note: body.internalNote,
      p_ends_at: body.endsAt,
      p_operation_key: body.operationKey,
    })
    if (!result.ok) return NextResponse.json({ success: false, error: result.message, code: result.code }, { status: result.status })
    return NextResponse.json({ success: true, result: result.data })
  }

  // 해제·알림 기록: 그 정지가 주소의 회원 것인지 먼저 본다.
  const owner = await readMemberRecordOwner('member_suspensions', body.suspensionId)
  if (!owner.ok) {
    return NextResponse.json({ success: false, error: '정지 기록을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
  if (owner.userId !== id) {
    return NextResponse.json({ success: false, error: '이 회원의 정지 기록이 아닙니다. 새로고침해 주세요.' }, { status: 404 })
  }

  const result = body.action === 'lift'
    ? await callMemberSuspensionRpc('lift_member_suspension', {
      p_actor_id: actorId,
      p_suspension_id: body.suspensionId,
      p_lift_reason: body.liftReason,
    })
    : await callMemberSuspensionRpc('record_member_suspension_notice', {
      p_actor_id: actorId,
      p_suspension_id: body.suspensionId,
      p_via: body.via,
      p_sent_at: body.sentAt,
      p_summary: body.summary,
    })
  if (!result.ok) return NextResponse.json({ success: false, error: result.message, code: result.code }, { status: result.status })
  return NextResponse.json({ success: true, result: result.data })
}
