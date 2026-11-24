import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  anonymizeMember,
  cancelMemberWithdrawalRequest,
  cleanupWithdrawnMemberAccount,
  createMemberWithdrawalRequest,
  deleteFullDeletedAuthUser,
  fullDeleteMember,
  notifyOwnerWithdrawalRequest,
  readMemberWithdrawalNotice,
  readMemberWithdrawalPolicy,
  readMemberWithdrawalPreview,
  recordWithdrawalReviewNeeded,
} from '@/lib/member-withdrawal-server'
import {
  describeMemberWithdrawalError,
  MEMBER_WITHDRAWAL_ERRORS,
  memberWithdrawalErrorCode,
  withdrawalBlockMessages,
  withdrawalCompletionKept,
  withdrawalText,
  type MemberWithdrawalPolicy,
  type MemberWithdrawalPreview,
} from '@/lib/member-withdrawal'
import { getConsentSenderName } from '@/lib/signup-consent-server'

// 회원 탈퇴(계획 6-2). 판정은 DB 미리보기(member_withdrawal_facts)로 한다.
// - 관리자: 403
// - 결제·결제 시도·요청·남길 문의가 모두 없음: 완전 삭제(지금과 같음, 스위치와 상관없음). 프로필을 지운 뒤 로그인 계정 삭제가
//   실패했으면 다시 눌렀을 때(미리보기가 '회원 없음') 로그인 계정 삭제를 마저 한다.
// - 결제 시도만·문의가 있는 비결제(selfAllowed): 익명화(anonymize_member self)
// - 결제 회원(requestAllowed): 탈퇴 요청(channel screen) — 대표가 회원 상세에서 처리
// - 그 밖: 409 와 이유·가능 예정일. 대표 확인이 필요한 막힘은 POST request_review 로 경보를 남긴다.
// selfAnonymizeEnabled 가 꺼져 있으면 익명화·요청은 409(잠시 후 이용), 완전 삭제는 된다.

const DeleteBodySchema = z.object({
  confirmEmail: z.string().optional(),
  // 문의가 있는 비결제 회원의 보존 선택(13절 3번 답 전까지 선택으로 받음)
  ticketRetentionAgreed: z.boolean().nullable().optional(),
  // 화면에 보여 준 고지 원문의 지문(서버가 다시 만든 원문과 같아야 한다)
  noticeSha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  // 화면에 보여 준 소멸 크레딧(익명화는 이보다 많이 사라지면 거절)
  expectedBalance: z.number().int().min(0).optional(),
})

const PostBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel_request'), requestId: z.string().uuid() }).strict(),
  z.object({ action: z.literal('request_review'), ticketRetentionAgreed: z.boolean().nullable().optional() }).strict(),
])

function errorResponse(error: Parameters<typeof describeMemberWithdrawalError>[0], policy: MemberWithdrawalPolicy | null) {
  const view = describeMemberWithdrawalError(error, policy)
  return NextResponse.json({ error: view.message, code: view.code }, { status: view.status })
}

function blockedResponse(reasons: string[], preview: MemberWithdrawalPreview, policy: MemberWithdrawalPolicy | null) {
  const block = withdrawalBlockMessages(reasons, preview, policy)
  return NextResponse.json(
    { error: block.lines.join(' '), code: 'MEMBER_WITHDRAW_BLOCKED', reasons, review: block.review },
    { status: 409 }
  )
}

const noticeChanged = (policy: MemberWithdrawalPolicy | null) =>
  errorResponse({ message: 'MEMBER_WITHDRAW_NOTICE_INVALID' }, policy)

// DELETE - 탈퇴(완전 삭제·익명화·결제 회원 탈퇴 요청)
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json(
        { error: '인증이 필요합니다.' },
        { status: 401 }
      )
    }

    const parsed = DeleteBodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: '요청이 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }, { status: 400 })
    }
    const body = parsed.data

    // Verify email matches
    if (body.confirmEmail !== user.email) {
      return NextResponse.json(
        { error: '이메일 주소가 일치하지 않습니다.' },
        { status: 400 }
      )
    }

    // 관리자 계정은 여기서 지우지 않는다(대표 관리자가 0명이 되는 길을 막는다). 관리자 ID 관리에서 처리한다.
    const { data: profile, error: profileLookupError } = await supabase
      .from('profiles')
      .select('is_admin, provider, kakao_id')
      .eq('id', user.id)
      .maybeSingle()
    if (profileLookupError) {
      throw new Error(`profiles 조회 실패: ${profileLookupError.message}`)
    }
    const policy = await readMemberWithdrawalPolicy()
    if (profile?.is_admin) {
      return NextResponse.json(
        { error: withdrawalText(policy, 'blockReasons.ADMIN') ?? MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_ADMIN.message },
        { status: 403 }
      )
    }

    const previewResult = await readMemberWithdrawalPreview(user.id, body.ticketRetentionAgreed ?? null)
    if (!previewResult.ok) {
      // 완전 삭제 중 프로필은 지웠는데 로그인 계정 삭제가 실패한 회원: 남길 기록이 없으므로 로그인 계정 삭제를 마저 한다.
      if (!profile && memberWithdrawalErrorCode(previewResult.error.message) === 'MEMBER_WITHDRAW_USER_NOT_FOUND') {
        await deleteFullDeletedAuthUser(user.id)
        return NextResponse.json({
          success: true,
          kind: 'deleted',
          marketing: null,
          message: withdrawalText(policy, 'completionTitle'),
        })
      }
      return errorResponse(previewResult.error, policy)
    }
    const preview = previewResult.data
    if (preview.isAdmin) {
      return errorResponse({ message: 'MEMBER_WITHDRAW_ADMIN' }, policy)
    }

    // 결제 회원: 탈퇴 요청(회원 본인 확인·고지 원문 기록). 대표가 확인한 뒤 익명화한다.
    if (preview.hadPayment) {
      if (preview.openRequest) return errorResponse({ message: 'MEMBER_WITHDRAW_REQUEST_EXISTS' }, policy)
      if (!preview.requestAllowed) return blockedResponse(preview.requestReasons, preview, policy)
      if (!body.noticeSha256) return noticeChanged(policy)
      const notice = await readMemberWithdrawalNotice(user.id, 'request', null)
      if (!notice.ok) return errorResponse(notice.error, policy)
      if (notice.data.sha256 !== body.noticeSha256) return noticeChanged(policy)
      const created = await createMemberWithdrawalRequest({
        userId: user.id,
        channel: 'screen',
        notice: notice.data,
        recordedBy: user.id,
      })
      if (!created.ok) return errorResponse(created.error, policy)
      // 대표에게 알림(대표 전용, 개인정보 없음). 처리 기한을 놓치지 않게.
      await notifyOwnerWithdrawalRequest(user.id, created.data.requestId)
      return NextResponse.json({
        success: true,
        kind: 'request_created',
        requestId: created.data.requestId,
        marketing: created.data.marketing,
        message: withdrawalText(policy, 'requestCreated'),
      })
    }

    // 비결제·결제 시도만: 문의가 있으면 보존 선택이 필요하다.
    const retention = preview.ticketCount > 0 ? body.ticketRetentionAgreed : null
    if (preview.ticketCount > 0 && typeof retention !== 'boolean') {
      return NextResponse.json({ error: '1:1 문의 보존 여부를 선택해 주세요.', code: 'TICKET_RETENTION_REQUIRED' }, { status: 400 })
    }
    const fullDelete = retention === false ? preview.fullDeleteIfTicketsDeleted : preview.fullDeleteAllowed

    if (fullDelete) {
      // 마케팅 동의 중이면 탈퇴와 함께 철회되므로 그 결과(보낸 곳·철회·처리 일시)를 완료 화면에 알린다(정보통신망법 50조).
      // 보낸 곳(사이트 운영자명)은 지우기 전에 읽는다 — 읽지 못해도 탈퇴는 막지 않고, 지운 뒤에 실패해 500 이 나지 않게.
      const sender = preview.marketingAgreed ? await getConsentSenderName().catch(() => null) : null
      // 남는 기록이 없으므로 지금처럼 완전 삭제한다(삭제 목록에 생성 기록을 더함).
      await fullDeleteMember(user.id, { provider: profile?.provider ?? null, kakaoId: profile?.kakao_id ?? null })
      return NextResponse.json({
        success: true,
        kind: 'deleted',
        marketing: preview.marketingAgreed
          ? { sender, withdrawnAt: new Date().toISOString(), result: withdrawalText(policy, 'marketingResult') }
          : null,
        message: withdrawalText(policy, 'completionTitle'),
      })
    }

    const selfAllowed = retention === false ? preview.selfAllowedIfTicketsDeleted : preview.selfAllowed
    const selfReasons = retention === false ? preview.selfReasonsIfTicketsDeleted : preview.selfReasons
    if (!selfAllowed) return blockedResponse(selfReasons, preview, policy)
    if (!body.noticeSha256 || body.expectedBalance === undefined) return noticeChanged(policy)
    const notice = await readMemberWithdrawalNotice(user.id, 'self', retention ?? true)
    if (!notice.ok) return errorResponse(notice.error, policy)
    // 동의한 소멸량은 서버가 만든 고지의 값으로 기록한다(화면 값이 다르면 고지가 바뀐 것으로 본다).
    if (notice.data.sha256 !== body.noticeSha256 || notice.data.expectedBalance !== body.expectedBalance) return noticeChanged(policy)

    const result = await anonymizeMember({
      actorId: user.id,
      userId: user.id,
      method: 'self',
      expectedBalance: notice.data.expectedBalance,
      noticeText: notice.data.text,
      // 회원 한 명에 한 번만 익명화한다 — 같은 키로 다시 오면 저장한 결과를 돌려받는다.
      operationKey: `member_withdraw_self:${user.id}`,
      ticketRetentionAgreed: retention ?? true,
    })
    if (!result.ok) return errorResponse(result.error, policy)

    // 로그인 계정 정리(소프트 삭제·카카오 연결 끊기). 실패하면 경보가 남고 대표가 다시 시도한다 — 탈퇴 결과는 그대로.
    await cleanupWithdrawnMemberAccount(user.id)

    return NextResponse.json({
      success: true,
      kind: 'anonymized',
      ticketsRetained: result.data.ticketsRetained,
      // 완료 화면의 '보관하는 기록' 줄(경로·결과에 맞는 DB 문구)
      kept: withdrawalCompletionKept(policy, result.data),
      marketing: result.data.marketing,
      message: withdrawalText(policy, 'completionTitle'),
    })
  } catch (error) {
    console.error('Account withdrawal error:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { error: '회원 탈퇴에 실패했습니다. 잠시 후 다시 시도해 주세요.' },
      { status: 500 }
    )
  }
}

// POST - 탈퇴 요청 취소, 대표 확인 요청(막힘 경보)
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })
  }
  const parsed = PostBodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: '요청이 올바르지 않습니다. 새로고침한 뒤 다시 시도해 주세요.' }, { status: 400 })
  }
  const policy = await readMemberWithdrawalPolicy()

  if (parsed.data.action === 'cancel_request') {
    const canceled = await cancelMemberWithdrawalRequest(user.id, parsed.data.requestId)
    if (!canceled.ok) return errorResponse(canceled.error, policy)
    return NextResponse.json({ success: true, message: withdrawalText(policy, 'requestCanceled') })
  }

  // 대표 확인이 필요한 막힘(가림 확인·페이앱 미확인·진행 중)일 때만 경보를 남긴다. 개인정보·user_id 키 없음.
  const previewResult = await readMemberWithdrawalPreview(user.id, parsed.data.ticketRetentionAgreed ?? null)
  if (!previewResult.ok) return errorResponse(previewResult.error, policy)
  const preview = previewResult.data
  if (preview.isAdmin) return errorResponse({ message: 'MEMBER_WITHDRAW_ADMIN' }, policy)
  const reasons = preview.hadPayment
    ? preview.requestReasons
    : parsed.data.ticketRetentionAgreed === false ? preview.selfReasonsIfTicketsDeleted : preview.selfReasons
  const block = withdrawalBlockMessages(reasons, preview, policy)
  if (!block.review) {
    return NextResponse.json({ error: '지금은 담당자 확인이 필요한 상태가 아닙니다. 새로고침해 주세요.' }, { status: 409 })
  }
  await recordWithdrawalReviewNeeded(user.id)
  return NextResponse.json({ success: true, message: withdrawalText(policy, 'reviewPendingNotice') })
}
