import { formatKstDateTime } from '@/lib/kst-date-format'

// 회원 탈퇴(익명화) 정책 문구·규칙(계획 docs/plan-bundle10-member-withdrawal.md). 값과 문구는 DB(system_settings
// 'member_withdrawal_policy')에만 둔다. 판정은 DB 함수(member_withdrawal_facts)가 하고, 코드는 그 값을 보여 주기만 한다.
// 고지 원문·지문은 DB 함수(get_member_withdrawal_notice)가 만든다. 코드가 채우는 자리표시는 화면 문구의 세 가지뿐이다.
export const MEMBER_WITHDRAWAL_POLICY_SETTING_KEY = 'member_withdrawal_policy'

export interface MemberWithdrawalPolicy {
  // 키가 없거나 true 가 아니면 꺼짐(DB 판정과 같다)
  selfAnonymizeEnabled: boolean
  nonPayerTicketRetentionYears: number | null
  selfWithdrawOrderQuietDays: number | null
  marketingConsentItemKey: string | null
  texts: Record<string, unknown>
}

function readDays(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 3650 ? value : null
}

export function parseMemberWithdrawalPolicy(value: unknown): MemberWithdrawalPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (!raw.texts || typeof raw.texts !== 'object' || Array.isArray(raw.texts)) return null
  return {
    selfAnonymizeEnabled: raw.selfAnonymizeEnabled === true,
    nonPayerTicketRetentionYears: readDays(raw.nonPayerTicketRetentionYears),
    selfWithdrawOrderQuietDays: readDays(raw.selfWithdrawOrderQuietDays),
    marketingConsentItemKey: typeof raw.marketingConsentItemKey === 'string' && raw.marketingConsentItemKey.trim()
      ? raw.marketingConsentItemKey : null,
    texts: raw.texts as Record<string, unknown>,
  }
}

// 'blockReasons.REFUND_PERIOD_OPEN' 처럼 점으로 이은 경로의 문구. 비었거나 문자열이 아니면 null.
export function withdrawalText(policy: MemberWithdrawalPolicy | null, path: string): string | null {
  let node: unknown = policy?.texts
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null
    node = (node as Record<string, unknown>)[key]
  }
  return typeof node === 'string' && node.trim() ? node : null
}

export const WITHDRAWAL_SCREEN_PLACEHOLDERS = {
  nonPayerTicketYears: '{비결제문의보존기간}',
  quietDays: '{결제대기일}',
  availableFrom: '{가능예정일}',
} as const

// 화면 문구의 자리표시를 채운다. 값이 없는 자리표시가 남으면(또는 모르는 자리표시가 있으면) null — 부르는 쪽이 문구를 빼거나 막는다.
export function fillWithdrawalScreenText(
  template: string | null,
  values: { nonPayerTicketYears?: number | null; quietDays?: number | null; availableFrom?: string | null }
): string | null {
  if (!template) return null
  let text = template
  if (values.nonPayerTicketYears != null) text = text.replaceAll(WITHDRAWAL_SCREEN_PLACEHOLDERS.nonPayerTicketYears, String(values.nonPayerTicketYears))
  if (values.quietDays != null) text = text.replaceAll(WITHDRAWAL_SCREEN_PLACEHOLDERS.quietDays, String(values.quietDays))
  if (values.availableFrom) text = text.replaceAll(WITHDRAWAL_SCREEN_PLACEHOLDERS.availableFrom, formatKstDateTime(values.availableFrom))
  return /[{}]/.test(text) ? null : text
}

// ---------------------------------------------------------------------------------------------------------------
// 미리보기(get_member_withdrawal_preview) 값. 대표 화면은 그대로, 회원 화면은 서버가 골라 보낸다(redactionRequired.preview 는 보내지 않음).
// ---------------------------------------------------------------------------------------------------------------
export interface WithdrawalRefundPeriod {
  sourceId: string
  rootSourceId: string
  paymentOrderId: string | null
  deadline: string | null
  blockedUntil: string | null
  refundDays: number
  inBuffer: boolean
}

export interface WithdrawalBreakdownItem {
  source_id: string
  category: string
  paid: boolean
  paid_root_id: string | null
  credits: number
  forfeited: number
  expired_cleared: number
  expires_at: string | null
  cash_value: number | null
}

export interface WithdrawalRedactionItem {
  // 13번: support_ticket_answer_revision(답변 수정 이력 — 이전 답변·수정 사유)
  kind: 'support_ticket' | 'support_ticket_revision' | 'support_ticket_answer_revision' | 'refund_request' | 'market_refund_request'
  id: string
  preview: string | null
  reasons: string[]
}

export interface MemberWithdrawalPreview {
  userId: string
  isAdmin: boolean
  withdrawnAt: string | null
  provider: string | null
  hadPayment: boolean
  hadPaymentReasons: string[]
  hasOrdersOrAttempts: boolean
  hasRequestHistory: boolean
  openRequestId: string | null
  ticketCount: number
  pendingTicketCount: number
  inProgress: Record<string, number>
  inProgressTotal: number
  refundPeriodOpen: WithdrawalRefundPeriod[]
  providerUnverified: string[]
  redactionRequired: WithdrawalRedactionItem[]
  lastPaymentActivityAt: string | null
  quietUntil: string | null
  balance: {
    spendable: number
    forfeitTotal: number
    forfeitPaid: number
    forfeitFree: number
    expired: number
    paidCashValue: number
    paidCashValueUnknown: boolean
    breakdown: WithdrawalBreakdownItem[]
  }
  marketingAgreed: boolean
  selfAnonymizeEnabled: boolean
  fullDeleteAllowed: boolean
  selfAllowed: boolean
  selfReasons: string[]
  requestAllowed: boolean
  requestReasons: string[]
  selfAllowedIfTicketsDeleted: boolean
  selfReasonsIfTicketsDeleted: string[]
  fullDeleteIfTicketsDeleted: boolean
  openRequest: {
    id: string
    channel: string
    requesterKind: string
    receivedAt: string
    noticeSha256: string
    noticeSentAt: string | null
    consentReplyReceivedAt: string | null
    ticketRetentionAgreed: boolean | null
    expectedBalance: number
    expectedForfeitPaid: number
    expectedForfeitFree: number
    marketingWithdrawnAt: string | null
    createdAt: string
  } | null
  counts: Record<string, number>
}

// 미리보기 모양이 맞는지만 본다(값 판정은 DB). 모양이 다르면 null.
export function parseMemberWithdrawalPreview(value: unknown): MemberWithdrawalPreview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const balance = raw.balance as Record<string, unknown> | undefined
  if (raw.exists !== true || typeof raw.userId !== 'string' || typeof raw.hadPayment !== 'boolean'
      || typeof raw.selfAllowed !== 'boolean' || typeof raw.requestAllowed !== 'boolean'
      || !Array.isArray(raw.selfReasons) || !Array.isArray(raw.requestReasons)
      || !Array.isArray(raw.refundPeriodOpen) || !Array.isArray(raw.redactionRequired)
      || !balance || typeof balance.forfeitTotal !== 'number' || !Array.isArray(balance.breakdown)) {
    return null
  }
  return raw as unknown as MemberWithdrawalPreview
}

// 막힘 해제 예정일: 환불 기간이 남은 충전 건의 차단 끝(마감 + 여유) 중 가장 늦은 것.
export function latestRefundBlockedUntil(periods: WithdrawalRefundPeriod[]): string | null {
  let latest: string | null = null
  for (const period of periods) {
    if (period.blockedUntil && (!latest || new Date(period.blockedUntil) > new Date(latest))) latest = period.blockedUntil
  }
  return latest
}

// 대표 확인이 필요한 막힘(경보 MEMBER_WITHDRAW_REVIEW_NEEDED 대상, 계획 3절). CASH_VALUE_UNKNOWN: 원 환산을 모르는 유료 크레딧 —
// 화면 요청은 막고 대표가 결제 금액을 확인해 이메일·전화 요청으로 처리한다.
export const WITHDRAWAL_REVIEW_REASONS = ['IN_PROGRESS', 'PROVIDER_UNVERIFIED', 'REDACTION_REQUIRED', 'CASH_VALUE_UNKNOWN'] as const

// 화면 요청만 막는 사유: 대표가 이메일·전화로 받는 요청에서는 막힘이 아니다(스위치 꺼짐, 원 환산을 대표가 결제 내역으로 확인).
export const WITHDRAWAL_SCREEN_ONLY_REASONS = ['DISABLED', 'CASH_VALUE_UNKNOWN'] as const

export function ownerChannelRequestReasons(reasons: readonly string[]): string[] {
  return reasons.filter((reason) => !(WITHDRAWAL_SCREEN_ONLY_REASONS as readonly string[]).includes(reason))
}

// 경보 details: 개인정보·user_id 키를 넣지 않는다(user_id 키가 있으면 판정의 '진행 중(경보)'으로 잡혀 탈퇴가 막힌다).
export function withdrawalReviewAlertDetails(userId: string) {
  return { dedupe_key: `member_withdraw_review:${userId}` }
}

// ---------------------------------------------------------------------------------------------------------------
// 오류 코드 → 안내 문구·HTTP 상태. DB 함수는 RAISE EXCEPTION '<코드>' 로 거절한다.
// 막힘 사유 문구가 DB(texts.blockReasons)에 있는 코드는 그 문구를 먼저 쓴다(blockReason).
// ---------------------------------------------------------------------------------------------------------------
export const MEMBER_WITHDRAWAL_ERRORS: Record<string, { status: number; message: string; blockReason?: string }> = {
  MEMBER_WITHDRAW_INPUT_INVALID: { status: 400, message: '입력 내용을 확인해 주세요. 새로고침한 뒤 다시 시도해 주세요.' },
  MEMBER_WITHDRAW_USER_NOT_FOUND: { status: 404, message: '회원을 찾을 수 없습니다.' },
  MEMBER_ALREADY_WITHDRAWN: { status: 409, message: '이미 탈퇴 처리된 계정입니다.' },
  MEMBER_WITHDRAW_ADMIN: { status: 403, message: '관리자 계정은 탈퇴할 수 없습니다.', blockReason: 'ADMIN' },
  MEMBER_WITHDRAW_ACTOR_NOT_OWNER: { status: 403, message: '대표 계정만 처리할 수 있습니다. 본인 계정은 처리할 수 없습니다.' },
  MEMBER_WITHDRAW_SELF_NOT_ALLOWED: { status: 409, message: '지금은 이 화면에서 탈퇴할 수 없습니다. 새로고침해 안내를 확인해 주세요.' },
  MEMBER_WITHDRAW_IN_PROGRESS: { status: 409, message: '진행 중인 결제나 환불이 있어 지금은 탈퇴할 수 없습니다.', blockReason: 'IN_PROGRESS' },
  MEMBER_WITHDRAW_REFUND_PERIOD_OPEN: { status: 409, message: '환불 기간이 남은 충전 건이 있어 지금은 탈퇴할 수 없습니다.', blockReason: 'REFUND_PERIOD_OPEN' },
  MEMBER_WITHDRAW_PROVIDER_UNVERIFIED: { status: 409, message: '결제 결과를 확인해야 하는 주문이 있습니다. 페이앱 판매자 화면에서 결제 없음을 확인한 뒤 체크해 주세요.', blockReason: 'PROVIDER_UNVERIFIED' },
  MEMBER_WITHDRAW_REDACTION_REQUIRED: { status: 409, message: '가림 확인이 필요한 문의·환불 기록이 있습니다. [가림] 또는 [확인함]을 먼저 해 주세요.', blockReason: 'REDACTION_REQUIRED' },
  MEMBER_WITHDRAW_REQUEST_INVALID: { status: 409, message: '탈퇴 요청이 없거나 상태가 바뀌었습니다. 새로고침해 주세요. 이메일·전화 요청에 유료 소멸분이 있으면 고지 발송·회신 시각을 먼저 기록해야 합니다.' },
  MEMBER_WITHDRAW_REQUEST_EXISTS: { status: 409, message: '이미 접수된 탈퇴 요청이 있습니다.', blockReason: 'REQUEST_PENDING' },
  MEMBER_WITHDRAW_PENDING_TICKETS_UNCONFIRMED: { status: 409, message: '답변을 기다리는 문의가 있습니다. 답변했거나 환불 요청이 없음을 확인하고 체크해 주세요.' },
  // 막힘 사유 CASH_VALUE_UNKNOWN 의 대신 문구(DB 문구 texts.blockReasons.CASH_VALUE_UNKNOWN 이 없을 때만). DB 가 RAISE 하는 코드는 아니다.
  MEMBER_WITHDRAW_CASH_VALUE_UNKNOWN: { status: 409, message: '결제 금액을 확인해야 하는 크레딧이 있어 담당자가 확인한 뒤 탈퇴를 처리합니다.', blockReason: 'CASH_VALUE_UNKNOWN' },
  MEMBER_WITHDRAW_NEW_CHARGE: { status: 409, message: '요청한 뒤 새로 생긴 크레딧이 있습니다. 요청을 취소하고 회원에게 다시 요청받아야 합니다.' },
  MEMBER_WITHDRAW_BALANCE_CHANGED: { status: 409, message: '그사이 크레딧이 바뀌어 동의한 금액보다 많이 사라지게 됩니다. 새로고침해 바뀐 금액을 확인한 뒤 다시 시도해 주세요.' },
  MEMBER_WITHDRAW_NOTICE_INVALID: { status: 409, message: '안내 내용이 바뀌었습니다. 새로고침해 바뀐 안내를 확인한 뒤 다시 시도해 주세요.' },
  MEMBER_WITHDRAW_POLICY_UNAVAILABLE: { status: 503, message: '탈퇴 안내 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' },
  MEMBER_WITHDRAW_STATE_CHANGED: { status: 409, message: '처리하는 동안 결제 상태가 바뀌었습니다. 잠시 후 다시 시도해 주세요.' },
  MEMBER_WITHDRAWN: { status: 403, message: '탈퇴한 계정입니다.' },
  MEMBER_NOT_WITHDRAWN: { status: 409, message: '탈퇴한 회원이 아닙니다. 새로고침해 주세요.' },
  PAYMENT_REVIEW_MEMBER_WITHDRAWN: { status: 409, message: '탈퇴한 회원의 주문이라 지급·정리 처리를 할 수 없습니다. 회원 상세에서 [보류 주문 닫기]로 처리해 주세요.' },
  PAYMENT_ORDER_NOT_FOUND: { status: 404, message: '주문을 찾을 수 없습니다.' },
  MEMBER_HELD_ORDER_INVALID: { status: 409, message: '탈퇴 회원의 보류 주문이 아닙니다. 새로고침해 주세요.' },
  MEMBER_HELD_ORDER_STATE_INVALID: { status: 409, message: '이 주문의 지금 상태로는 선택한 방법으로 닫을 수 없습니다. 새로고침해 상태를 확인해 주세요.' },
  MEMBER_HELD_ORDER_CANCEL_PENDING: { status: 409, message: '취소 통보를 기다려 주세요. 통보가 기록·처리된 뒤에 닫을 수 있습니다.' },
  MEMBER_REDACTION_TARGET_NOT_FOUND: { status: 404, message: '가릴 기록을 찾지 못했습니다. 새로고침해 주세요.' },
  MEMBER_REDACTION_TEXT_NOT_FOUND: { status: 409, message: '입력한 문구가 그 칸에 없습니다. 원문 그대로 입력해 주세요.' },
  MEMBER_WITHDRAWAL_REQUESTS_APPEND_ONLY: { status: 409, message: '탈퇴 요청 기록은 고칠 수 없습니다.' },
  WITHDRAWN_MEMBER_RECORDS_APPEND_ONLY: { status: 409, message: '보관함 기록은 고칠 수 없습니다.' },
  WITHDRAWN_MEMBER_RECORD_EVENTS_APPEND_ONLY: { status: 409, message: '보관함 추가 기록은 고칠 수 없습니다.' },
}

// 같은 키로 다시 시도하는 오류: MEMBER_WITHDRAW_STATE_CHANGED(40001)와 교착(40P01).
export const WITHDRAWAL_RETRY_SQLSTATES = ['40001', '40P01'] as const
export const WITHDRAWAL_MAX_RETRIES = 2

export function isWithdrawalRetryable(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && (WITHDRAWAL_RETRY_SQLSTATES as readonly string[]).includes(error.code))
}

// 오류 메시지에서 아는 코드를 찾는다(정확히 같으면 그것, 아니면 가장 긴 포함 코드 — MEMBER_WITHDRAW_ 와 MEMBER_WITHDRAWN 이 섞이지 않게).
export function memberWithdrawalErrorCode(message: string | null | undefined): string | null {
  const text = (message ?? '').trim()
  if (!text) return null
  if (text in MEMBER_WITHDRAWAL_ERRORS) return text
  const found = Object.keys(MEMBER_WITHDRAWAL_ERRORS)
    .filter((code) => new RegExp(`(^|[^A-Z_])${code}($|[^A-Z_])`).test(text))
    .sort((a, b) => b.length - a.length)
  return found[0] ?? null
}

// DB 오류 DETAIL(jsonb 문자열)을 읽는다. 아니면 null.
export function parseWithdrawalErrorDetail(details: string | null | undefined): unknown {
  if (!details) return null
  try {
    return JSON.parse(details)
  } catch {
    return null
  }
}

export interface WithdrawalErrorView {
  status: number
  code: string
  message: string
}

// 오류를 안내 문구로. SELF_NOT_ALLOWED 의 DETAIL reason 과 막힘 사유는 DB 문구(texts.blockReasons)를 먼저 쓴다.
export function describeMemberWithdrawalError(
  error: { code?: string | null; message?: string | null; details?: string | null },
  policy: MemberWithdrawalPolicy | null,
  values: { quietDays?: number | null } = {}
): WithdrawalErrorView {
  const code = memberWithdrawalErrorCode(error.message)
  if (!code) {
    if (isWithdrawalRetryable(error)) {
      return { status: 503, code: error.code ?? 'TRANSIENT', message: '처리가 몰려 잠시 실패했습니다. 잠시 후 다시 시도해 주세요.' }
    }
    return { status: 500, code: 'MEMBER_WITHDRAW_FAILED', message: '탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' }
  }
  const known = MEMBER_WITHDRAWAL_ERRORS[code]
  const detail = parseWithdrawalErrorDetail(error.details) as Record<string, unknown> | null
  let reason = known.blockReason ?? null
  let availableFrom: string | null = null
  // 스스로 탈퇴 거절·화면 요청 거절(예: CASH_VALUE_UNKNOWN)의 DETAIL reason 은 그 막힘 문구로 보여 준다.
  if ((code === 'MEMBER_WITHDRAW_SELF_NOT_ALLOWED' || code === 'MEMBER_WITHDRAW_REQUEST_INVALID')
      && detail && !Array.isArray(detail) && typeof detail.reason === 'string') {
    reason = detail.reason
    availableFrom = typeof detail.quietUntil === 'string' ? detail.quietUntil : null
  }
  if (code === 'MEMBER_WITHDRAW_REFUND_PERIOD_OPEN' && Array.isArray(detail)) {
    availableFrom = latestRefundBlockedUntil(detail as WithdrawalRefundPeriod[])
  }
  const fromPolicy = reason
    ? fillWithdrawalScreenText(withdrawalText(policy, `blockReasons.${reason}`), {
        quietDays: values.quietDays ?? policy?.selfWithdrawOrderQuietDays,
        availableFrom,
      })
    : null
  return { status: known.status, code, message: fromPolicy ?? known.message }
}

// ---------------------------------------------------------------------------------------------------------------
// 막힘 사유 → 화면 문구(DB texts.blockReasons). DISABLED 면 그 한 줄만(잠시 후 이용). 결제 여부 표시용 사유는 뺀다.
// 환불 기간: 가능 예정일 = 차단 끝 중 가장 늦은 것, 여유 기간 중인 건이 있으면 휴일 연장 안내 줄을 더하고 크레딧 화면 링크를 둔다.
// ---------------------------------------------------------------------------------------------------------------
const HIDDEN_BLOCK_REASONS = new Set(['PAYER', 'NOT_PAYER', 'WITHDRAWN'])

export interface WithdrawalBlock {
  lines: string[]
  review: boolean
  refundLink: boolean
}

export function withdrawalBlockMessages(
  reasons: readonly string[],
  preview: Pick<MemberWithdrawalPreview, 'refundPeriodOpen' | 'quietUntil'>,
  policy: MemberWithdrawalPolicy | null
): WithdrawalBlock {
  const shown = reasons.includes('DISABLED') ? ['DISABLED'] : reasons.filter((reason) => !HIDDEN_BLOCK_REASONS.has(reason))
  const lines: string[] = []
  const fallback = (reason: string) => MEMBER_WITHDRAWAL_ERRORS[`MEMBER_WITHDRAW_${reason}`]?.message
    ?? MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_SELF_NOT_ALLOWED.message
  for (const reason of shown) {
    const availableFrom = reason === 'REFUND_PERIOD_OPEN' ? latestRefundBlockedUntil(preview.refundPeriodOpen)
      : reason === 'RECENT_PAYMENT_ACTIVITY' ? preview.quietUntil : null
    lines.push(fillWithdrawalScreenText(withdrawalText(policy, `blockReasons.${reason}`), {
      quietDays: policy?.selfWithdrawOrderQuietDays,
      availableFrom,
    }) ?? fallback(reason))
    if (reason === 'REFUND_PERIOD_OPEN' && preview.refundPeriodOpen.some((period) => period.inBuffer)) {
      const buffer = withdrawalText(policy, 'blockReasons.REFUND_PERIOD_BUFFER')
      if (buffer) lines.push(buffer)
    }
  }
  return {
    lines,
    review: shown.some((reason) => (WITHDRAWAL_REVIEW_REASONS as readonly string[]).includes(reason)),
    refundLink: shown.includes('REFUND_PERIOD_OPEN'),
  }
}

// 익명화 완료 화면의 '보관하는 기록' 줄(DB 문구). 결제 회원은 completionKept 하나, 비결제는 completionKeptNonPayer 에
// 결제 시도·주문 기록이 남았으면 completionKeptAttemptOnly, 문의를 보존했으면 completionKeptTickets 를 덧붙인다.
// 자리표시가 채워지지 않은 줄은 뺀다.
export function withdrawalCompletionKept(
  policy: MemberWithdrawalPolicy | null,
  result: { hadPayment: boolean; ticketsRetained: boolean; counts?: Record<string, number> | null }
): string[] {
  const count = (key: string) => {
    const value = result.counts?.[key]
    return typeof value === 'number' ? value : 0
  }
  const fill = (template: string | null) =>
    fillWithdrawalScreenText(template, { nonPayerTicketYears: policy?.nonPayerTicketRetentionYears })
  const lines = result.hadPayment
    ? [fill(withdrawalText(policy, 'completionKept'))]
    : [
        fill(withdrawalText(policy, 'completionKeptNonPayer')),
        count('attemptFingerprints') > 0 || count('orderFingerprints') > 0 ? fill(withdrawalText(policy, 'completionKeptAttemptOnly')) : null,
        result.ticketsRetained && count('ticketsKept') > 0 ? fill(withdrawalText(policy, 'completionKeptTickets')) : null,
      ]
  return lines.filter((line): line is string => Boolean(line))
}

// 고지 원문(LF 로 이은 줄) → 화면: 첫 줄은 제목, 마지막 줄(최종 확인 문구)은 마지막 체크 항목이 되므로 목록에서 뺀다.
export function splitWithdrawalNotice(text: string, confirmLabel: string | null): { title: string; lines: string[] } {
  const lines = text.split('\n')
  const title = lines.shift() ?? ''
  if (confirmLabel && lines[lines.length - 1] === confirmLabel) lines.pop()
  return { title, lines }
}
