import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminApiPermission } from '@/lib/admin-permissions-server'
import { recordAdminAudit } from '@/lib/admin-audit-log-server'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  anonymizeMember,
  callOwnerWithdrawalRpc,
  cancelMemberWithdrawalRequest,
  cleanupWithdrawnMemberAccount,
  createMemberWithdrawalRequest,
  readMemberWithdrawalNotice,
  readMemberWithdrawalPolicy,
  readWithdrawalTargetUserId,
  withdrawalRequestMeta,
  type WithdrawalTargetKind,
} from '@/lib/member-withdrawal-server'
import { describeMemberWithdrawalError, type MemberWithdrawalPolicy } from '@/lib/member-withdrawal'

export const dynamic = 'force-dynamic'

// 회원 탈퇴(대표 전용, 계획 6-5): 요청 기록·회신, 고지 원문 만들기, 익명화, 가림·확인함, 보류 주문 닫기, 추가 기록,
// 보관함·탈퇴 회원 문의 열람(사유·IP·기기 기록), 로그인 계정 정리 다시 시도. 권한은 이 가드와 DB 함수(대표 확인) 둘 다 본다.

interface RouteContext {
  params: Promise<{ id: string }>
}

const uuid = z.string().uuid()
const datetime = z.string().datetime({ offset: true })
const operationKey = z.string().trim().min(8).max(200)
const reason = z.string().trim().min(1, '사유를 적어 주세요.').max(500)
const targetKind = z.enum(['support_ticket', 'support_ticket_revision', 'refund_request', 'market_refund_request'])

const BodySchema = z.discriminatedUnion('action', [
  // 이메일·전화 요청에 보낼 고지 원문(서버가 지금 값으로 만든다)
  z.object({ action: z.literal('notice'), ticketRetentionAgreed: z.boolean().nullable() }).strict(),
  z.object({
    action: z.literal('record_request'),
    channel: z.enum(['email', 'phone']),
    requesterKind: z.enum(['self', 'legal_guardian', 'agent']),
    receivedAt: datetime,
    identityNote: z.string().trim().max(500).nullable(),
    noticeSha256: z.string().regex(/^[0-9a-f]{64}$/),
    ticketRetentionAgreed: z.boolean().nullable(),
    noticeSentAt: datetime.nullable(),
    consentReplyReceivedAt: datetime.nullable(),
  }).strict(),
  z.object({
    action: z.literal('record_reply'),
    requestId: uuid,
    noticeSentAt: datetime.nullable(),
    consentReplyReceivedAt: datetime.nullable(),
    ticketRetentionAgreed: z.boolean().nullable(),
  }).strict(),
  z.object({ action: z.literal('cancel_request'), requestId: uuid }).strict(),
  z.object({
    action: z.literal('anonymize'),
    requestId: uuid,
    expectedBalance: z.number().int().min(0),
    confirmEmail: z.string().trim().min(1, '회원 이메일을 입력해 주세요.'),
    providerUnverifiedConfirmed: z.boolean(),
    pendingTicketsConfirmed: z.boolean(),
    ticketRetentionAgreed: z.boolean().nullable(),
    reason: z.string().trim().max(500).nullable(),
    operationKey,
  }).strict(),
  z.object({
    action: z.literal('redact'),
    targetKind,
    targetId: uuid,
    field: z.enum(['subject', 'message', 'admin_response', 'reason', 'admin_note']),
    targetText: z.string().min(1, '가릴 문구를 입력해 주세요.').max(2000),
    operationKey,
  }).strict(),
  z.object({ action: z.literal('mark_reviewed'), targetKind, targetId: uuid }).strict(),
  z.object({
    action: z.literal('close_held_order'),
    orderId: uuid,
    method: z.enum(['payapp_cancel_request', 'provider_admin_cancel', 'bank_transfer']),
    note: z.string().trim().min(1, '메모를 적어 주세요.').max(1000),
    operationKey,
  }).strict(),
  z.object({
    action: z.literal('add_event'),
    kind: z.enum(['market_cash_refund', 'note']),
    refId: uuid.nullable(),
    details: z.record(z.string(), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])),
  }).strict(),
  z.object({ action: z.literal('read_record'), reason }).strict(),
  z.object({ action: z.literal('read_ticket'), ticketId: uuid, reason }).strict(),
  z.object({ action: z.literal('retry_account') }).strict(),
])

function fail(error: Parameters<typeof describeMemberWithdrawalError>[0], policy: MemberWithdrawalPolicy | null) {
  const view = describeMemberWithdrawalError(error, policy)
  return NextResponse.json({ success: false, error: view.message, code: view.code }, { status: view.status })
}

// 대상 기록이 주소의 회원 것인지 DB 함수를 부르기 전에 본다(다른 회원 기록을 이 회원 맥락으로 처리하거나, 열람 기록이 잘못 남지 않게).
async function rejectOtherMemberTarget(kind: WithdrawalTargetKind, targetId: string, userId: string) {
  const owner = await readWithdrawalTargetUserId(kind, targetId)
  if (!owner.ok) {
    return NextResponse.json({ success: false, error: '대상 기록을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503 })
  }
  if (owner.data !== userId) {
    return NextResponse.json({ success: false, error: '이 회원의 기록이 아닙니다. 새로고침해 주세요.' }, { status: 404 })
  }
  return null
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const guard = await requireAdminApiPermission('owner')
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
  const policy = await readMemberWithdrawalPolicy()

  switch (body.action) {
    case 'notice': {
      const notice = await readMemberWithdrawalNotice(id, 'request', body.ticketRetentionAgreed)
      if (!notice.ok) return fail(notice.error, policy)
      return NextResponse.json({ success: true, notice: notice.data })
    }
    case 'record_request': {
      // 대표가 복사해 보낸 원문과 지금 서버 원문이 같아야 기록한다(금액이 바뀌었으면 원문을 다시 만들어 보낸다).
      const notice = await readMemberWithdrawalNotice(id, 'request', body.ticketRetentionAgreed)
      if (!notice.ok) return fail(notice.error, policy)
      if (notice.data.sha256 !== body.noticeSha256) return fail({ message: 'MEMBER_WITHDRAW_NOTICE_INVALID' }, policy)
      const created = await createMemberWithdrawalRequest({
        userId: id,
        channel: body.channel,
        notice: notice.data,
        recordedBy: actorId,
        ticketRetentionAgreed: body.ticketRetentionAgreed,
        requesterKind: body.requesterKind,
        identityNote: body.identityNote,
        receivedAt: body.receivedAt,
        noticeSentAt: body.noticeSentAt,
        consentReplyReceivedAt: body.consentReplyReceivedAt,
      })
      if (!created.ok) return fail(created.error, policy)
      return NextResponse.json({ success: true, requestId: created.data.requestId, marketing: created.data.marketing })
    }
    case 'record_reply': {
      const rejected = await rejectOtherMemberTarget('member_withdrawal_request', body.requestId, id)
      if (rejected) return rejected
      const result = await callOwnerWithdrawalRpc('record_member_withdrawal_request_reply', {
        p_actor_id: actorId,
        p_request_id: body.requestId,
        p_notice_sent_at: body.noticeSentAt,
        p_consent_reply_received_at: body.consentReplyReceivedAt,
        p_ticket_retention_agreed: body.ticketRetentionAgreed,
      })
      if (!result.ok) return fail(result.error, policy)
      return NextResponse.json({ success: true, reply: result.data })
    }
    case 'cancel_request': {
      const canceled = await cancelMemberWithdrawalRequest(id, body.requestId)
      if (!canceled.ok) return fail(canceled.error, policy)
      // 회원 권리 행사(탈퇴 요청)를 대표가 닫은 기록(누가·언제)
      await recordAdminAudit({
        actorId,
        action: 'member_withdraw_request_cancel',
        targetType: 'member_withdrawal_request',
        targetId: body.requestId,
        targetUserId: id,
        details: { marketing_withdrawn_at: canceled.data.marketingWithdrawnAt },
      })
      return NextResponse.json({ success: true })
    }
    case 'anonymize': {
      // 확인 창: 회원 이메일(없으면 회원 id)을 그대로 입력해야 한다.
      const { data: profile, error: profileError } = await createAdminClient().from('profiles')
        .select('email').eq('id', id).maybeSingle()
      if (profileError) return NextResponse.json({ success: false, error: '회원 정보를 읽지 못했습니다.' }, { status: 503 })
      if (!profile) return NextResponse.json({ success: false, error: '회원을 찾을 수 없습니다.' }, { status: 404 })
      if (body.confirmEmail !== (profile.email ?? id)) {
        return NextResponse.json({ success: false, error: '입력한 이메일이 회원 이메일과 다릅니다.' }, { status: 400 })
      }
      const result = await anonymizeMember({
        actorId,
        userId: id,
        method: 'owner',
        requestId: body.requestId,
        expectedBalance: body.expectedBalance,
        providerUnverifiedConfirmed: body.providerUnverifiedConfirmed,
        pendingTicketsConfirmed: body.pendingTicketsConfirmed,
        ticketRetentionAgreed: body.ticketRetentionAgreed,
        reason: body.reason,
        operationKey: body.operationKey,
      })
      if (!result.ok) return fail(result.error, policy)
      const cleanup = await cleanupWithdrawnMemberAccount(id)
      return NextResponse.json({ success: true, result: result.data, cleanup: cleanup.ok ? cleanup.data : null })
    }
    case 'redact': {
      const rejected = await rejectOtherMemberTarget(body.targetKind, body.targetId, id)
      if (rejected) return rejected
      const result = await callOwnerWithdrawalRpc('redact_member_text', {
        p_actor_id: actorId,
        p_target_kind: body.targetKind,
        p_target_id: body.targetId,
        p_field: body.field,
        p_target_text: body.targetText,
        p_operation_key: body.operationKey,
      })
      if (!result.ok) return fail(result.error, policy)
      return NextResponse.json({ success: true, result: result.data })
    }
    case 'mark_reviewed': {
      const rejected = await rejectOtherMemberTarget(body.targetKind, body.targetId, id)
      if (rejected) return rejected
      const result = await callOwnerWithdrawalRpc('mark_member_text_reviewed', {
        p_actor_id: actorId,
        p_target_kind: body.targetKind,
        p_target_id: body.targetId,
      })
      if (!result.ok) return fail(result.error, policy)
      return NextResponse.json({ success: true, result: result.data })
    }
    case 'close_held_order': {
      const rejected = await rejectOtherMemberTarget('payment_order', body.orderId, id)
      if (rejected) return rejected
      const result = await callOwnerWithdrawalRpc('close_withdrawn_member_held_order', {
        p_actor_id: actorId,
        p_order_id: body.orderId,
        p_method: body.method,
        p_note: body.note,
        p_operation_key: body.operationKey,
      })
      if (!result.ok) return fail(result.error, policy)
      return NextResponse.json({ success: true, result: result.data })
    }
    case 'add_event': {
      // 현금 정산은 정산마다 한 건(정산 식별값 settlementKey 로 같은 정산의 중복만 막는다).
      if (body.kind === 'market_cash_refund' && (typeof body.details.settlementKey !== 'string' || !body.details.settlementKey.trim())) {
        return NextResponse.json({ success: false, error: '정산 식별값이 없습니다. 새로고침한 뒤 다시 시도해 주세요.' }, { status: 400 })
      }
      const result = await callOwnerWithdrawalRpc('add_withdrawn_member_event', {
        p_actor_id: actorId,
        p_user_id: id,
        p_kind: body.kind,
        p_ref_id: body.refId,
        p_details: body.details,
      })
      if (!result.ok) return fail(result.error, policy)
      return NextResponse.json({ success: true, recorded: result.data.recorded === true })
    }
    case 'read_record': {
      // 열람 기록(사유·요청 IP·기기)을 DB 함수가 남긴 뒤 내용을 돌려준다. 응답은 저장하지 않는다.
      const result = await callOwnerWithdrawalRpc('read_withdrawn_member_record', {
        p_actor_id: actorId,
        p_user_id: id,
        p_reason: body.reason,
        p_request_meta: withdrawalRequestMeta(request),
      })
      if (!result.ok) return fail(result.error, policy)
      return NextResponse.json({ success: true, record: result.data }, { headers: { 'Cache-Control': 'no-store' } })
    }
    case 'read_ticket': {
      // 열람 기록이 남기 전에 이 회원의 문의인지 본다.
      const rejected = await rejectOtherMemberTarget('support_ticket', body.ticketId, id)
      if (rejected) return rejected
      const result = await callOwnerWithdrawalRpc('read_withdrawn_member_ticket', {
        p_actor_id: actorId,
        p_ticket_id: body.ticketId,
        p_reason: body.reason,
        p_request_meta: withdrawalRequestMeta(request),
      })
      if (!result.ok) return fail(result.error, policy)
      return NextResponse.json({ success: true, ticket: result.data }, { headers: { 'Cache-Control': 'no-store' } })
    }
    case 'retry_account': {
      // 탈퇴 회원이 아니면 로그인 계정을 건드리지 않고 409(MEMBER_NOT_WITHDRAWN)
      const cleanup = await cleanupWithdrawnMemberAccount(id)
      if (!cleanup.ok) return fail(cleanup.error, policy)
      return NextResponse.json({ success: true, cleanup: cleanup.data })
    }
  }
}
