import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  isWithdrawalRetryable,
  MEMBER_WITHDRAWAL_POLICY_SETTING_KEY,
  parseMemberWithdrawalPolicy,
  parseMemberWithdrawalPreview,
  WITHDRAWAL_MAX_RETRIES,
  withdrawalReviewAlertDetails,
  withdrawalText,
  type MemberWithdrawalPolicy,
  type MemberWithdrawalPreview,
  type WithdrawalRedactionItem,
} from '@/lib/member-withdrawal'
import type { Database, Json } from '@/types/supabase'

// 회원 탈퇴(익명화) 서버 모듈(계획 6-1). 판정·처리는 DB 함수가 한다(service_role 전용). 여기서는 부르고, 다시 시도하고,
// 로그인 계정(auth)·카카오 연결을 정리한다. 보관함(withdrawn_member_records)은 service_role 도 읽지 못한다 — 열람은 기록을 남기는 함수로만.

type Functions = Database['public']['Functions']
export type WithdrawalRpcError = { code?: string | null; message?: string | null; details?: string | null }
export type WithdrawalRpcResult<T> = { ok: true; data: T } | { ok: false; error: WithdrawalRpcError }

function failure(error: { code?: string; message?: string; details?: string } | null): { ok: false; error: WithdrawalRpcError } {
  return { ok: false, error: { code: error?.code ?? null, message: error?.message ?? null, details: error?.details ?? null } }
}

function asObject(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

// 탈퇴 정책(캐시 없음 — 돈과 기록이 움직이는 경로). 읽지 못하면 null(부르는 쪽이 막는다).
export async function readMemberWithdrawalPolicy(): Promise<MemberWithdrawalPolicy | null> {
  try {
    const { data, error } = await createAdminClient().from('system_settings')
      .select('value').eq('key', MEMBER_WITHDRAWAL_POLICY_SETTING_KEY).maybeSingle()
    if (error) throw error
    return parseMemberWithdrawalPolicy(data?.value ?? null)
  } catch (error) {
    console.error('[member-withdrawal] 탈퇴 정책 설정을 읽지 못했습니다.', { code: (error as { code?: string })?.code })
    return null
  }
}

export async function readMemberWithdrawalPreview(
  userId: string,
  ticketRetentionAgreed: boolean | null = null
): Promise<WithdrawalRpcResult<MemberWithdrawalPreview>> {
  const { data, error } = await createAdminClient().rpc('get_member_withdrawal_preview', {
    p_user_id: userId,
    p_ticket_retention_agreed: ticketRetentionAgreed,
  } as unknown as Functions['get_member_withdrawal_preview']['Args'])
  if (error) return failure(error)
  const preview = parseMemberWithdrawalPreview(data)
  return preview ? { ok: true, data: preview } : failure({ message: 'MEMBER_WITHDRAW_PREVIEW_INVALID' })
}

export interface MemberWithdrawalNotice {
  kind: 'self' | 'request'
  text: string
  sha256: string
  expectedBalance: number
  expectedForfeitPaid: number
  expectedForfeitFree: number
  paidCashValue: number
  hadPayment: boolean
}

// 고지 원문은 DB 가 정책 틀과 지금 값으로 만든다(지문 포함). 코드는 만들지 않는다.
export async function readMemberWithdrawalNotice(
  userId: string,
  kind: 'self' | 'request',
  ticketRetentionAgreed: boolean | null
): Promise<WithdrawalRpcResult<MemberWithdrawalNotice>> {
  const { data, error } = await createAdminClient().rpc('get_member_withdrawal_notice', {
    p_user_id: userId,
    p_kind: kind,
    p_ticket_retention_agreed: ticketRetentionAgreed,
  } as unknown as Functions['get_member_withdrawal_notice']['Args'])
  if (error) return failure(error)
  const notice = asObject(data)
  if (typeof notice.text !== 'string' || typeof notice.sha256 !== 'string' || typeof notice.expectedBalance !== 'number') {
    return failure({ message: 'MEMBER_WITHDRAW_POLICY_UNAVAILABLE' })
  }
  return { ok: true, data: notice as unknown as MemberWithdrawalNotice }
}

export interface WithdrawalMarketingResult {
  sender: string | null
  withdrawnAt: string
  result: string | null
}

export interface CreateWithdrawalRequestInput {
  userId: string
  channel: 'screen' | 'email' | 'phone'
  notice: Pick<MemberWithdrawalNotice, 'text' | 'sha256' | 'expectedBalance' | 'expectedForfeitPaid' | 'expectedForfeitFree'>
  recordedBy: string
  ticketRetentionAgreed?: boolean | null
  requesterKind?: 'self' | 'legal_guardian' | 'agent'
  identityNote?: string | null
  receivedAt?: string | null
  noticeSentAt?: string | null
  consentReplyReceivedAt?: string | null
}

export async function createMemberWithdrawalRequest(input: CreateWithdrawalRequestInput): Promise<WithdrawalRpcResult<{
  requestId: string
  marketing: WithdrawalMarketingResult | null
}>> {
  const { data, error } = await createAdminClient().rpc('create_member_withdrawal_request', {
    p_user_id: input.userId,
    p_channel: input.channel,
    p_notice_text: input.notice.text,
    p_notice_sha256: input.notice.sha256,
    p_expected_balance: input.notice.expectedBalance,
    p_expected_forfeit_paid: input.notice.expectedForfeitPaid,
    p_expected_forfeit_free: input.notice.expectedForfeitFree,
    p_identity_note: input.identityNote ?? null,
    p_recorded_by: input.recordedBy,
    p_ticket_retention_agreed: input.ticketRetentionAgreed ?? null,
    p_requester_kind: input.requesterKind ?? 'self',
    p_received_at: input.receivedAt ?? null,
    p_notice_sent_at: input.noticeSentAt ?? null,
    p_consent_reply_received_at: input.consentReplyReceivedAt ?? null,
  } as unknown as Functions['create_member_withdrawal_request']['Args'])
  if (error) return failure(error)
  const result = asObject(data)
  return {
    ok: true,
    data: { requestId: String(result.requestId), marketing: (result.marketing ?? null) as WithdrawalMarketingResult | null },
  }
}

export async function cancelMemberWithdrawalRequest(userId: string, requestId: string): Promise<WithdrawalRpcResult<{
  marketingWithdrawnAt: string | null
}>> {
  const { data, error } = await createAdminClient().rpc('cancel_member_withdrawal_request', {
    p_user_id: userId,
    p_request_id: requestId,
  })
  if (error) return failure(error)
  return { ok: true, data: { marketingWithdrawnAt: (asObject(data).marketingWithdrawnAt as string | null) ?? null } }
}

export interface AnonymizeMemberInput {
  actorId: string
  userId: string
  method: 'self' | 'owner'
  requestId?: string | null
  expectedBalance?: number | null
  noticeText?: string | null
  providerUnverifiedConfirmed?: boolean
  reason?: string | null
  operationKey: string
  ticketRetentionAgreed?: boolean | null
  pendingTicketsConfirmed?: boolean
}

export interface AnonymizeMemberResult {
  withdrawn: true
  userId: string
  method: 'self' | 'owner'
  withdrawnAt: string
  hadPayment: boolean
  forfeited: number
  forfeitedPaid: number
  forfeitedFree: number
  expiredCleared: number
  agreed: { balance: number; paid: number; free: number }
  ticketsRetained: boolean
  counts: Record<string, number>
  marketing: WithdrawalMarketingResult | null
  kakaoUnlinkPending: boolean
  authScrubPending: boolean
  replay?: boolean
}

// 익명화. 40P01(교착)·40001(MEMBER_WITHDRAW_STATE_CHANGED)은 같은 키로 2회까지 다시 시도한다(계획 5-2).
export async function anonymizeMember(input: AnonymizeMemberInput): Promise<WithdrawalRpcResult<AnonymizeMemberResult>> {
  const args = {
    p_actor_id: input.actorId,
    p_user_id: input.userId,
    p_method: input.method,
    p_request_id: input.requestId ?? null,
    p_expected_balance: input.expectedBalance ?? null,
    p_notice_text: input.noticeText ?? null,
    p_provider_unverified_confirmed: input.providerUnverifiedConfirmed === true,
    p_reason: input.reason ?? null,
    p_operation_key: input.operationKey,
    p_ticket_retention_agreed: input.ticketRetentionAgreed ?? null,
    p_pending_tickets_confirmed: input.pendingTicketsConfirmed === true,
  } as unknown as Functions['anonymize_member']['Args']
  let lastError: WithdrawalRpcError | null = null
  for (let attempt = 0; attempt <= WITHDRAWAL_MAX_RETRIES; attempt += 1) {
    const { data, error } = await createAdminClient().rpc('anonymize_member', args)
    if (!error) return { ok: true, data: data as unknown as AnonymizeMemberResult }
    lastError = failure(error).error
    if (!isWithdrawalRetryable(error)) break
  }
  return { ok: false, error: lastError ?? {} }
}

// 경보(최선 노력, 실패해도 응답을 바꾸지 않음). 개인정보는 넣지 않는다.
async function recordWithdrawalAlert(code: string, severity: 'warning' | 'critical', message: string, details: Record<string, Json>) {
  try {
    const { error } = await createAdminClient().rpc('record_payment_alert', {
      p_code: code,
      p_severity: severity,
      p_message: message,
      p_details: { ...details, attempted_at: new Date().toISOString() },
    })
    if (error) console.error('[member-withdrawal] 경보 기록 실패', { code: error.code, alert: code })
  } catch {
    // 경보 기록 실패는 화면 응답과 무관하다.
  }
}

// 스스로 탈퇴가 대표 확인으로 막힌 때(가림 확인·페이앱 미확인·진행 중). details 에 user_id 키를 넣지 않는다.
export async function recordWithdrawalReviewNeeded(userId: string) {
  await recordWithdrawalAlert(
    'MEMBER_WITHDRAW_REVIEW_NEEDED',
    'warning',
    '회원이 탈퇴하려 했지만 대표 확인이 필요해 막혔습니다. 회원 상세(dedupe_key 의 회원)에서 확인하고 10일 안에 회원에게 안내하세요(런북 RB-11).',
    withdrawalReviewAlertDetails(userId)
  )
}

// 결제 회원이 탈퇴 화면에서 요청을 남기면 대표에게 알린다(관리자 알림 — required_permission 'owner' 는 대표만 본다, 슬랙으로도 나감).
// 처리 기한을 놓치지 않게. 제목·본문에 개인정보를 넣지 않고 회원 상세 링크만 둔다. 실패해도 요청 결과는 바꾸지 않는다.
export async function notifyOwnerWithdrawalRequest(userId: string, requestId: string) {
  try {
    const { error } = await createAdminClient().from('admin_events').insert({
      kind: 'member_withdrawal_request',
      severity: 'warning',
      title: '회원 탈퇴 요청 접수(탈퇴 화면)',
      body: '결제 회원이 탈퇴 화면에서 탈퇴를 요청했습니다. 회원 상세의 회원 탈퇴 구역에서 확인하고 처리 기한 안에 처리해 주세요(런북 RB-11).',
      link: `/admin/users/${userId}`,
      ref_table: 'member_withdrawal_requests',
      ref_id: requestId,
      required_permission: 'owner',
      dedupe_key: `member_withdrawal_request:${requestId}`,
    })
    // 23505: 같은 요청으로 이미 알렸다.
    if (error && error.code !== '23505') console.error('[member-withdrawal] 탈퇴 요청 알림 실패', { code: error.code })
  } catch {
    console.error('[member-withdrawal] 탈퇴 요청 알림 실패')
  }
}

// 카카오 연결 끊기(어드민 키·회원번호 기준). 키는 환경변수에만 둔다(대표 할 일: Vercel 등록).
// 이미 끊긴 회원(-101)은 끊긴 것으로 본다.
async function requestKakaoUnlink(kakaoId: string): Promise<'unlinked' | 'no_key' | 'failed'> {
  const adminKey = process.env.KAKAO_ADMIN_KEY
  if (!adminKey) return 'no_key'
  try {
    const response = await fetch('https://kapi.kakao.com/v1/user/unlink', {
      method: 'POST',
      headers: {
        Authorization: `KakaoAK ${adminKey}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      body: new URLSearchParams({ target_id_type: 'user_id', target_id: kakaoId }),
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) return 'unlinked'
    const body = await response.json().catch(() => null) as { code?: number } | null
    if (body?.code === -101) return 'unlinked'
    console.error('[member-withdrawal] 카카오 연결 끊기 실패', { status: response.status, code: body?.code ?? null })
    return 'failed'
  } catch {
    return 'failed'
  }
}

export type WithdrawnAccountCleanup = { authScrubbed: boolean; kakao: 'none' | 'unlinked' | 'pending' }

interface WithdrawnMemberAccountStatus {
  withdrawnAt: string | null
  authScrubbedAt: string | null
  kakaoUnlinkPending: boolean
}

// 탈퇴 여부·로그인 계정 정리 시각·남은 카카오 연결 끊기(보관함 기준, DB 함수 withdrawn_member_account_status).
// 탈퇴 회원이 아니면 withdrawnAt 이 null 이다(오류 아님).
async function readAccountStatus(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<WithdrawalRpcResult<WithdrawnMemberAccountStatus>> {
  const { data, error } = await admin.rpc('withdrawn_member_account_status', { p_user_id: userId })
  if (error) return failure(error)
  const value = asObject(data)
  return {
    ok: true,
    data: {
      withdrawnAt: typeof value.withdrawnAt === 'string' ? value.withdrawnAt : null,
      authScrubbedAt: typeof value.authScrubbedAt === 'string' ? value.authScrubbedAt : null,
      kakaoUnlinkPending: value.kakaoUnlinkPending === true,
    },
  }
}

// 익명화 뒤 로그인 계정 정리(계획 5-7, 14절 6번). 먼저 탈퇴 회원인지 보관함으로 확인한다 — 아니면(또는 확인하지 못하면)
// 되돌릴 수 없는 소프트 삭제를 부르지 않는다(MEMBER_NOT_WITHDRAWN). ① 정리 시각이 없을 때만 auth.admin.deleteUser(id, true) →
// mark_withdrawn_member_auth_scrubbed. ② 카카오 연결 끊기는 남아 있을 때만. 실패한 단계는 경보를 남긴다(알림용 — 다시 시도 표시는 보관함 값).
// 회원 상세의 [로그인 계정 정리 다시 시도]가 같은 함수를 다시 부른다.
export async function cleanupWithdrawnMemberAccount(userId: string): Promise<WithdrawalRpcResult<WithdrawnAccountCleanup>> {
  const admin = createAdminClient()
  const status = await readAccountStatus(admin, userId)
  if (!status.ok) return status
  if (!status.data.withdrawnAt) return failure({ message: 'MEMBER_NOT_WITHDRAWN' })

  let authScrubbed = status.data.authScrubbedAt !== null
  if (!authScrubbed) {
    const { error } = await admin.auth.admin.deleteUser(userId, true)
    // 이미 소프트 삭제된 계정은 찾지 못함(404)으로 온다. 프로필이 남아 있으므로 완전 삭제가 아니다 — 정리된 것으로 본다.
    if (!error || error.status === 404) {
      const { error: markError } = await admin.rpc('mark_withdrawn_member_auth_scrubbed', { p_user_id: userId })
      authScrubbed = !markError
      if (markError) console.error('[member-withdrawal] 로그인 계정 정리 기록 실패', { code: markError.code })
    } else {
      console.error('[member-withdrawal] 로그인 계정 소프트 삭제 실패', { status: error.status ?? null })
    }
    if (!authScrubbed) {
      // 문구는 정기 작업(remind_unanswered_admin_work)과 같은 DB 정책 texts.alertAuthScrubPending. 읽지 못하면 코드 값.
      const message = withdrawalText(await readMemberWithdrawalPolicy(), 'alertAuthScrubPending') ?? 'MEMBER_AUTH_SCRUB_PENDING'
      await recordWithdrawalAlert('MEMBER_AUTH_SCRUB_PENDING', 'warning', message,
        { user_id: userId, dedupe_key: `member_auth_scrub:${userId}` })
    }
  }

  let kakao: WithdrawnAccountCleanup['kakao'] = 'none'
  if (status.data.kakaoUnlinkPending) {
    const { data: target, error: targetError } = await admin.rpc('withdrawn_member_kakao_unlink_target', { p_user_id: userId })
    const targetValue = asObject(target)
    if (targetError) {
      kakao = 'pending'
    } else if (typeof targetValue.kakaoId === 'string' && targetValue.kakaoId) {
      // 그 회원번호로 다른 계정이 새로 연결됐으면 끊지 않고 칸만 비운다(새 계정의 연결을 끊지 않게).
      const outcome = targetValue.newIdentityExists === true ? 'new_identity_exists' : await requestKakaoUnlink(targetValue.kakaoId)
      if (outcome === 'unlinked' || outcome === 'new_identity_exists') {
        const { error } = await admin.rpc('clear_withdrawn_member_kakao_unlink', { p_user_id: userId, p_outcome: outcome })
        kakao = error ? 'pending' : 'unlinked'
      } else {
        kakao = 'pending'
      }
    }
  }
  if (kakao === 'pending') {
    await recordWithdrawalAlert('MEMBER_KAKAO_UNLINK_PENDING', 'warning',
      '탈퇴 회원의 카카오 연결 끊기가 끝나지 않았습니다(어드민 키 KAKAO_ADMIN_KEY 미등록 또는 실패). 회원 상세에서 [로그인 계정 정리 다시 시도]를 눌러 주세요.',
      { user_id: userId, dedupe_key: `member_kakao_unlink:${userId}` })
  }
  return { ok: true, data: { authScrubbed, kakao } }
}

// 탈퇴 회원의 로그인 계정 정리 상태(회원 상세의 [다시 시도] 표시용). 보관함의 정리 시각으로 본다 — 경보가 풀렸거나 남지 않아도
// (서버가 정리 전에 멈춘 경우) 정리 시각이 없으면 다시 시도 버튼이 보인다.
export async function readWithdrawnMemberAccountStatus(userId: string): Promise<{ authPending: boolean; kakaoPending: boolean } | null> {
  const status = await readAccountStatus(createAdminClient(), userId)
  if (!status.ok) return null
  return {
    authPending: status.data.withdrawnAt !== null && status.data.authScrubbedAt === null,
    kakaoPending: status.data.kakaoUnlinkPending,
  }
}

// 완전 삭제의 마지막 단계: 로그인 계정(auth) 삭제. 프로필을 지운 뒤 실패하면 경보(dedupe_key 만)를 남기고 던진다.
// 회원이 다시 누르면 미리보기가 '회원 없음'으로 오므로 route 가 이 함수만 다시 불러 마저 지운다.
// 지웠으면(또는 이미 없으면) 앞서 남긴 경보를 푼다(DB 가 프로필·로그인 계정이 모두 없을 때만 푼다). 풀지 못해도 탈퇴는 끝난 것이다.
export async function deleteFullDeletedAuthUser(userId: string) {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.deleteUser(userId)
  // 이미 지워졌으면(404) 끝난 것으로 본다.
  if (!error || error.status === 404) {
    const { error: resolveError } = await admin.rpc('resolve_member_full_delete_auth_alert', { p_user_id: userId })
    if (resolveError) console.error('[member-withdrawal] 완전 삭제 경보 해소 실패', { code: resolveError.code })
    return
  }
  await recordWithdrawalAlert('MEMBER_FULL_DELETE_AUTH_PENDING', 'warning',
    '완전 삭제 중 회원 정보는 지웠지만 로그인 계정 삭제가 끝나지 않았습니다. 회원이 탈퇴를 다시 누르면 마저 지웁니다. 계속 남으면 런북 RB-11 의 수동 처리로 확인하세요.',
    { dedupe_key: `member_full_delete_auth:${userId}` })
  throw new Error(`계정 삭제 실패: ${error.status ?? ''}`)
}

// 완전 삭제(결제·결제 시도·요청·남길 문의가 모두 없는 회원). 판정은 부르는 쪽이 미리보기(fullDeleteAllowed)로 한다.
// 문의를 지우기 전에 관리자 이벤트의 문의 제목 사본을 '탈퇴 회원 문의'로 바꾼다(14절 4번).
// 카카오 연결 끊기는 프로필 삭제가 성공한 뒤, 로그인 계정 삭제 전에 한다(중간에 실패했을 때 카카오 연결만 끊긴 채 남지 않게).
// 회원번호는 부르는 쪽이 프로필을 지우기 전에 읽어 넘긴다. 실패해도 탈퇴는 진행한다(회원번호는 경보에 넣지 않음 — 런북 수동 처리).
export async function fullDeleteMember(userId: string, profile: { provider: string | null; kakaoId: string | null }) {
  const admin = createAdminClient()
  const { error: scrubError } = await admin.rpc('scrub_member_admin_events', { p_user_id: userId })
  if (scrubError) throw new Error(`관리자 이벤트 정리 실패: ${scrubError.code ?? ''}`)

  // 프로필이 지워지면 나머지는 CASCADE 로 지워진다. auth.users 를 참조하는 표와 RESTRICT·생성 기록(SET NULL)은 먼저 지운다.
  const deletions = ['exam_papers', 'questions', 'support_tickets', 'credit_transactions', 'ai_question_generation_runs'] as const
  for (const table of deletions) {
    const { error } = await admin.from(table).delete().eq('user_id', userId)
    if (error) throw new Error(`${table} 삭제 실패: ${error.code ?? ''}`)
  }
  const { error: profileError } = await admin.from('profiles').delete().eq('id', userId)
  if (profileError) throw new Error(`profiles 삭제 실패: ${profileError.code ?? ''}`)

  if (profile.provider === 'kakao' && profile.kakaoId) {
    const outcome = await requestKakaoUnlink(profile.kakaoId)
    if (outcome !== 'unlinked') {
      await recordWithdrawalAlert('MEMBER_KAKAO_UNLINK_FAILED', 'warning',
        '완전 삭제한 카카오 회원의 연결 끊기에 실패했습니다. 회원번호는 남기지 않았으므로 런북 RB-11 의 수동 처리(카카오 개발자 콘솔)로 확인하세요.',
        { dedupe_key: `member_kakao_unlink_deleted:${userId}`, reason: outcome })
    }
  }
  // auth 계정까지 지워야 재로그인·재가입 충돌이 없다.
  await deleteFullDeletedAuthUser(userId)
}

// 대상 기록(문의·문의 수정 이력·환불·주문·탈퇴 요청)의 회원 id. 대표 API 가 주소의 회원과 같은지 먼저 본다. 없으면 null.
export type WithdrawalTargetKind = WithdrawalRedactionItem['kind'] | 'payment_order' | 'member_withdrawal_request'

export async function readWithdrawalTargetUserId(kind: WithdrawalTargetKind, targetId: string): Promise<WithdrawalRpcResult<string | null>> {
  const admin = createAdminClient()
  let table: 'support_tickets' | 'refund_requests' | 'market_refund_requests' | 'payment_orders' | 'member_withdrawal_requests'
  let id = targetId
  switch (kind) {
    case 'support_ticket_revision': {
      const { data, error } = await admin.from('support_ticket_revisions').select('ticket_id').eq('id', targetId).maybeSingle()
      if (error) return failure(error)
      if (!data) return { ok: true, data: null }
      table = 'support_tickets'
      id = data.ticket_id
      break
    }
    // 13번: 답변 수정 이력 → 그 문의 → 회원(표는 타입에 아직 없어 이름만 맞춰 읽는다)
    case 'support_ticket_answer_revision': {
      const { data, error } = await (admin as unknown as SupabaseClient).from('support_ticket_answer_revisions').select('ticket_id').eq('id', targetId).maybeSingle()
      if (error) return failure(error)
      if (!data) return { ok: true, data: null }
      table = 'support_tickets'
      id = (data as { ticket_id: string }).ticket_id
      break
    }
    case 'support_ticket':
      table = 'support_tickets'
      break
    case 'refund_request':
      table = 'refund_requests'
      break
    case 'market_refund_request':
      table = 'market_refund_requests'
      break
    case 'payment_order':
      table = 'payment_orders'
      break
    case 'member_withdrawal_request':
      table = 'member_withdrawal_requests'
      break
  }
  const { data, error } = await admin.from(table).select('user_id').eq('id', id).maybeSingle()
  if (error) return failure(error)
  return { ok: true, data: (data as { user_id: string | null } | null)?.user_id ?? null }
}

// 탈퇴한 회원 id 집합(service_role 경로의 가림용, 계획 6-6). 읽지 못하면 예외 — 가림 없이 내보내지 않게.
export async function readWithdrawnUserIds(userIds: readonly (string | null | undefined)[]): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
  if (ids.length === 0) return new Set()
  const { data, error } = await createAdminClient().from('profiles').select('id').in('id', ids).not('withdrawn_at', 'is', null)
  if (error) throw new Error(`탈퇴 회원 조회 실패: ${error.code ?? ''}`)
  return new Set((data ?? []).map((row) => row.id))
}

// 탈퇴 회원 보류 주문(늦은 결제 기록 있음) id 집합(결제 검토 화면이 버튼 대신 안내를 보일 주문). 읽지 못하면 예외.
export async function readWithdrawnHeldOrderIds(orderIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(orderIds)]
  if (ids.length === 0) return new Set()
  const { data, error } = await createAdminClient().rpc('withdrawn_member_held_order_ids', { p_order_ids: ids })
  if (error) throw new Error(`탈퇴 회원 보류 주문 조회 실패: ${error.code ?? ''}`)
  return new Set(Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : [])
}

// 열람 기록에 넣는 요청 정보(14절 13번): IP·기기. 개인정보 처리 기록(감사)에만 남는다.
export function withdrawalRequestMeta(request: Request): Record<string, string | null> {
  const forwarded = request.headers.get('x-forwarded-for')
  return {
    ip: forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null,
    user_agent: request.headers.get('user-agent')?.slice(0, 300) ?? null,
  }
}

// 대표 전용 함수들. 권한은 route 가드와 DB(member_withdrawal_require_owner) 둘 다 본다.
export async function callOwnerWithdrawalRpc<Name extends
  | 'record_member_withdrawal_request_reply'
  | 'redact_member_text'
  | 'mark_member_text_reviewed'
  | 'close_withdrawn_member_held_order'
  | 'add_withdrawn_member_event'
  | 'read_withdrawn_member_record'
  | 'read_withdrawn_member_ticket'
>(name: Name, args: Record<string, unknown>): Promise<WithdrawalRpcResult<Record<string, unknown>>> {
  const { data, error } = await createAdminClient().rpc(name, args as unknown as Functions[Name]['Args'])
  if (error) return failure(error)
  return { ok: true, data: asObject(data) }
}
