import { normalizePathname, stripWorkspacePrefix } from '@/lib/workspace-subject'

// 12번 묶음(회원 이용 정지·관리자 메모, 계획 docs/plan-bundle12-member-suspension.md) 공용 규칙 — 순수 함수만 둔다.
// 서버·브라우저·시험이 같이 쓴다. 회원 화면 문구·사유 분류·최대 정지 일수는 DB(system_settings.member_suspension_policy)에 있다.

export const MEMBER_SUSPENSION_POLICY_SETTING_KEY = 'member_suspension_policy'

// 문구 키(9절). DB 저장 함수(save_member_suspension_policy)의 c_text_keys 와 같은 목록이다(계약 시험이 맞춰 본다).
export const MEMBER_SUSPENSION_TEXT_KEYS = [
  'bannerRestricted',
  'noticeTitle',
  'noticeIntro',
  'noticeBlockedList',
  'noticeBlockedDownload',
  'noticeAvailableList',
  'noticeDeadlines',
  'noticeObjection',
  'noticeUntilLifted',
  'noticeNone',
  'noticeCheckFailed',
  'apiBlocked',
  'loginBlocked',
  'deadlineChargeRefund',
  'deadlineMaterialRefund',
  'deadlineCreditExpiry',
  'ownerMailDeadlines',
  'adminMemoGuide',
  'adminSuspendConfirm',
  'adminDeadlineWarning',
  'adminUnderageGuide',
] as const

export type MemberSuspensionTextKey = (typeof MEMBER_SUSPENSION_TEXT_KEYS)[number]
export const MEMBER_SUSPENSION_TEXT_MAX = 1000

// 정책을 읽지 못할 때만 쓰는 코드 대체 문구(11-1: 이 셋뿐). 나머지 회원 화면 문구는 늘 정책 키로 읽는다.
export const MEMBER_SUSPENSION_FALLBACK_TEXTS = {
  apiBlocked: '이용이 제한된 계정이라 이 기능을 쓸 수 없습니다.',
  loginBlocked: '이 계정은 로그인이 제한되었습니다. 화면 하단의 고객센터로 문의해 주세요.',
  noticeCheckFailed: '이용 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
} as const satisfies Partial<Record<MemberSuspensionTextKey, string>>

export interface MemberSuspensionReasonCategory {
  code: string
  label: string
  clause: string
  // 정지 창 '다운로드도 막기'를 미리 체크할지(분류마다 데이터, Q2)
  blocksDownloadDefault: boolean
  // 새 정지에서 숨김(쓰는 중인 코드는 지우지 않고 숨김만)
  hidden: boolean
  // 정지 창에 adminUnderageGuide 를 보일지(3절 만 14세 미만 안내)
  underageGuide: boolean
}

export interface MemberSuspensionPolicy {
  revision: number
  maxRestrictedDays: number
  texts: Record<MemberSuspensionTextKey, string>
  reasonCategories: MemberSuspensionReasonCategory[]
}

export const MEMBER_SUSPENSION_REASON_CODE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// DB 값 → 정책. 키가 하나라도 빠지거나 모양이 다르면 null(화면은 대체 문구·막힘 쪽으로 간다).
export function parseMemberSuspensionPolicy(value: unknown): MemberSuspensionPolicy | null {
  if (!isRecord(value) || !isRecord(value.texts) || !Array.isArray(value.reasonCategories)) return null
  const revision = value.revision
  const maxDays = value.maxRestrictedDays
  if (typeof revision !== 'number' || !Number.isInteger(revision)) return null
  if (typeof maxDays !== 'number' || !Number.isInteger(maxDays) || maxDays < 1 || maxDays > 365) return null
  const texts = {} as Record<MemberSuspensionTextKey, string>
  for (const key of MEMBER_SUSPENSION_TEXT_KEYS) {
    const text = value.texts[key]
    if (typeof text !== 'string' || !text.trim()) return null
    texts[key] = text
  }
  const reasonCategories: MemberSuspensionReasonCategory[] = []
  for (const raw of value.reasonCategories) {
    if (!isRecord(raw)) return null
    if (typeof raw.code !== 'string' || !MEMBER_SUSPENSION_REASON_CODE_PATTERN.test(raw.code)) return null
    if (typeof raw.label !== 'string' || !raw.label.trim()) return null
    if (typeof raw.blocksDownloadDefault !== 'boolean' || typeof raw.hidden !== 'boolean') return null
    reasonCategories.push({
      code: raw.code,
      label: raw.label,
      clause: typeof raw.clause === 'string' ? raw.clause : '',
      blocksDownloadDefault: raw.blocksDownloadDefault,
      hidden: raw.hidden,
      underageGuide: raw.underageGuide === true,
    })
  }
  if (reasonCategories.length === 0) return null
  return { revision, maxRestrictedDays: maxDays, texts, reasonCategories }
}

// 회원 화면 문구 하나: 정책이 있으면 그 값, 없으면 대체 문구가 있는 세 키만 대체 문구, 그 밖은 null(그 문단을 그리지 않음).
export function memberSuspensionText(policy: MemberSuspensionPolicy | null, key: MemberSuspensionTextKey): string | null {
  if (policy) return policy.texts[key]
  return (MEMBER_SUSPENSION_FALLBACK_TEXTS as Partial<Record<MemberSuspensionTextKey, string>>)[key] ?? null
}

// ── 판정 ────────────────────────────────────────────────────────────────────────────────────────
export type MemberSuspensionScope = 'restricted' | 'login_blocked'

// 활성 = lifted_at IS NULL AND (ends_at IS NULL OR ends_at > now) — DB 함수(member_active_suspension)와 같은 식(3절 '판정').
export function isMemberSuspensionActive(row: { lifted_at: string | null; ends_at: string | null }, nowMs: number) {
  return row.lifted_at === null && (row.ends_at === null || new Date(row.ends_at).getTime() > nowMs)
}

export interface MemberGateRestriction {
  scope: MemberSuspensionScope
  blocksDownload: boolean
  endsAt: string | null
}

export interface MemberGateResult {
  missingRequired: string[]
  restriction: MemberGateRestriction | null
}

// get_my_member_gate() 결과. 모양이 다르면 null(미들웨어는 통과 — 강제는 서버 가드).
export function parseMemberGate(data: unknown): MemberGateResult | null {
  if (!isRecord(data) || !Array.isArray(data.missingRequired)) return null
  if (!data.missingRequired.every((id) => typeof id === 'string')) return null
  const raw = data.restriction
  if (raw === null || raw === undefined) {
    return { missingRequired: data.missingRequired as string[], restriction: null }
  }
  if (!isRecord(raw) || (raw.scope !== 'restricted' && raw.scope !== 'login_blocked') || typeof raw.blocksDownload !== 'boolean') return null
  const endsAt = typeof raw.endsAt === 'string' ? raw.endsAt : null
  return { missingRequired: data.missingRequired as string[], restriction: { scope: raw.scope, blocksDownload: raw.blocksDownload, endsAt } }
}

// ── 경로·헤더·코드 ───────────────────────────────────────────────────────────────────────────────
// 미들웨어가 붙이는 요청 헤더(이용 제한 회원). 밖에서 온 같은 헤더는 늘 지운다(5-2).
export const MEMBER_RESTRICTION_HEADER = 'x-member-restriction'
export const MEMBER_RESTRICTION_HEADER_VALUE = 'restricted'
export const MEMBER_RESTRICTION_PAGE_PATH = '/mypage/restriction'
export const MEMBER_RESTRICTION_CHECK_FAILED_PATH = `${MEMBER_RESTRICTION_PAGE_PATH}?check=failed`
// 로그인 화면 오류 코드(이메일 로그인 액션·카카오 콜백이 인증 서버의 user_banned 를 이것으로 바꾼다)
export const ACCOUNT_BLOCKED_LOGIN_ERROR = 'account_blocked'
export const AUTH_USER_BANNED_CODE = 'user_banned'

// 정지 판정을 하지 않는 최소 제외(5-2): 로그인·카카오 콜백·API·관리자·Next 내부·정적 파일. 동의 제외 목록과 따로 둔다.
const MEMBER_GATE_EXCLUDED_PREFIXES = ['/login', '/auth/callback', '/api', '/admin', '/_next'] as const
const MEMBER_GATE_STATIC_FILE_PATTERN = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|csv|hwpx?|txt|pdf|json|xml|webmanifest|woff2?|ttf|otf|map|js|css)$/i

function matchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

export function isMemberGateExcludedPath(pathname: string) {
  const normalized = normalizePathname(pathname)
  const scoped = stripWorkspacePrefix(normalized).scopedPath
  return [normalized, scoped].some((path) =>
    MEMBER_GATE_EXCLUDED_PREFIXES.some((prefix) => matchesPrefix(path, prefix)) || MEMBER_GATE_STATIC_FILE_PATTERN.test(path))
}

export type MemberSuspensionBlockCode = 'MEMBER_SUSPENDED' | 'SUSPENSION_CHECK_FAILED'
export const MEMBER_SUSPENSION_BLOCK_CODES: readonly MemberSuspensionBlockCode[] = ['MEMBER_SUSPENDED', 'SUSPENSION_CHECK_FAILED']

// API 응답(두 모양: body.code / body.error.code)에서 정지 막힘 코드를 읽는다. 아니면 null.
export function readSuspensionBlockCode(status: number, body: unknown): MemberSuspensionBlockCode | null {
  if (status !== 403 && status !== 503) return null
  if (!isRecord(body)) return null
  const nested = isRecord(body.error) ? body.error.code : undefined
  const code = typeof body.code === 'string' ? body.code : typeof nested === 'string' ? nested : null
  return code && (MEMBER_SUSPENSION_BLOCK_CODES as readonly string[]).includes(code) ? code as MemberSuspensionBlockCode : null
}

// ── 환불·소멸 기한(6-2, 관리자 화면) ────────────────────────────────────────────────────────────────
export interface MemberRefundDeadlines {
  paidBalance: number
  earliestCreditExpiry: string | null
  chargeRefundUntil: string | null
  materialRefundUntil: string | null
}

export type MemberDeadlineKind = 'chargeRefund' | 'materialRefund' | 'creditExpiry'

// 기한 종류 이름은 회원이 읽는 글(안내 화면·대표 이메일 {기한 종류})이라 정책 문구 키로 둔다.
export const MEMBER_DEADLINE_TEXT_KEYS: Record<MemberDeadlineKind, MemberSuspensionTextKey> = {
  chargeRefund: 'deadlineChargeRefund',
  materialRefund: 'deadlineMaterialRefund',
  creditExpiry: 'deadlineCreditExpiry',
}

export function parseMemberRefundDeadlines(data: unknown): MemberRefundDeadlines | null {
  if (!isRecord(data)) return null
  const at = (value: unknown) => (typeof value === 'string' ? value : null)
  return {
    paidBalance: typeof data.paidBalance === 'number' ? data.paidBalance : 0,
    earliestCreditExpiry: at(data.earliestCreditExpiry),
    chargeRefundUntil: at(data.chargeRefundUntil),
    materialRefundUntil: at(data.materialRefundUntil),
  }
}

// ── 날짜 표시(공용 셈법 하나) ─────────────────────────────────────────────────────────────────────────
// 정지 끝나는 날(ends_at)과 환불 마감·크레딧 만료는 모두 '끝 시각을 넣지 않는' 시각이다(정지·환불은 마지막 날 다음 날 00:00 KST).
// 회원에게 보이는 날짜는 그 1ms 앞의 한국 날짜다 — 안내 화면과 대표 이메일 초안이 이 함수 하나를 같이 쓴다(하루 늦게 안내하지 않게).
const KST_OFFSET_MS_FOR_LABEL = 9 * 60 * 60 * 1000
export function formatMemberLastDay(exclusiveEnd: string | Date): string {
  const kst = new Date(new Date(exclusiveEnd).getTime() - 1 + KST_OFFSET_MS_FOR_LABEL)
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`
}
// 시작 시각처럼 그 순간이 들어가는 시각의 한국 날짜
export function formatMemberDay(instant: string | Date): string {
  const kst = new Date(new Date(instant).getTime() + KST_OFFSET_MS_FOR_LABEL)
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`
}

// 가장 빠른 기한(지금 뒤의 것 중). 없으면 null.
export function earliestMemberDeadline(deadlines: MemberRefundDeadlines | null, nowMs: number): { kind: MemberDeadlineKind; at: string } | null {
  if (!deadlines) return null
  const candidates: Array<{ kind: MemberDeadlineKind; at: string | null }> = [
    { kind: 'chargeRefund', at: deadlines.chargeRefundUntil },
    { kind: 'materialRefund', at: deadlines.materialRefundUntil },
    { kind: 'creditExpiry', at: deadlines.earliestCreditExpiry },
  ]
  let best: { kind: MemberDeadlineKind; at: string } | null = null
  for (const candidate of candidates) {
    if (!candidate.at) continue
    const ms = new Date(candidate.at).getTime()
    if (!Number.isFinite(ms) || ms <= nowMs) continue
    if (!best || ms < new Date(best.at).getTime()) best = { kind: candidate.kind, at: candidate.at }
  }
  return best
}

// 기한 경고(3절 돈 원칙): 끝나는 날 없는 로그인 차단은 늘 경고, 그 밖에는 끝나는 날이 가장 빠른 기한과 같거나 넘을 때
// (둘 다 '다음 날 00:00 KST' 라 같은 날을 고르면 값이 같다 — 보수적으로 경고).
export function suspensionExceedsDeadline(
  input: { scope: MemberSuspensionScope; endsAt: string | null },
  earliest: { at: string } | null
) {
  if (input.scope === 'login_blocked' && !input.endsAt) return true
  if (!earliest || !input.endsAt) return false
  return new Date(input.endsAt).getTime() >= new Date(earliest.at).getTime()
}

// ── 관리자 화면 오류 문구(DB 오류 코드 → 관리자에게 보일 말) ─────────────────────────────────────────────
const MEMBER_SUSPENSION_ERROR_CODES = [
  'MEMBER_SUSPEND_INPUT_INVALID',
  'MEMBER_SUSPEND_ACTOR_NOT_ALLOWED',
  'MEMBER_SUSPEND_TARGET_INVALID',
  'MEMBER_SUSPEND_POLICY_UNAVAILABLE',
  'MEMBER_SUSPEND_REASON_UNKNOWN',
  'MEMBER_SUSPEND_PERIOD_INVALID',
  'MEMBER_SUSPEND_ALREADY_ACTIVE',
  'MEMBER_SUSPENSION_NOT_FOUND',
  'MEMBER_SUSPENSION_NOT_ACTIVE',
  'MEMBER_SUSPENSION_NOTICE_ALREADY_RECORDED',
  'MEMBER_NOTE_INPUT_INVALID',
  'MEMBER_NOTE_ACTOR_NOT_ALLOWED',
  'MEMBER_NOTE_TARGET_INVALID',
  'MEMBER_NOTE_NOT_FOUND',
  'MEMBER_NOTE_ALREADY_DELETED',
  'MEMBER_NOTE_ALREADY_REDACTED',
  'MEMBER_SUSPENSION_POLICY_ACTOR_NOT_OWNER',
  'MEMBER_SUSPENSION_POLICY_NOT_FOUND',
  'MEMBER_SUSPENSION_POLICY_REVISION_CONFLICT',
  'MEMBER_SUSPENSION_POLICY_INPUT_INVALID',
  'MEMBER_SUSPENSION_POLICY_CODE_IN_USE',
] as const

export type MemberSuspensionErrorCode = (typeof MEMBER_SUSPENSION_ERROR_CODES)[number]

const MEMBER_SUSPENSION_ERROR_VIEW: Record<MemberSuspensionErrorCode, { status: number; message: string }> = {
  MEMBER_SUSPEND_INPUT_INVALID: { status: 400, message: '입력 값이 올바르지 않습니다. 다시 확인해 주세요.' },
  MEMBER_SUSPEND_ACTOR_NOT_ALLOWED: { status: 403, message: '이 작업을 할 권한이 없습니다. 로그인 차단과 그 해제·알림 기록은 대표만 할 수 있습니다.' },
  MEMBER_SUSPEND_TARGET_INVALID: { status: 409, message: '정지할 수 없는 계정입니다(관리자·탈퇴 회원·본인·가입 미완료).' },
  MEMBER_SUSPEND_POLICY_UNAVAILABLE: { status: 503, message: '이용 정지 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.' },
  MEMBER_SUSPEND_REASON_UNKNOWN: { status: 400, message: '사유 분류를 찾지 못했습니다. 새로고침한 뒤 다시 골라 주세요.' },
  MEMBER_SUSPEND_PERIOD_INVALID: { status: 400, message: '끝나는 날이 올바르지 않습니다. 이용 제한은 끝나는 날이 필요하고 최대 일수를 넘을 수 없습니다.' },
  MEMBER_SUSPEND_ALREADY_ACTIVE: { status: 409, message: '이미 정지 중인 회원입니다. 범위나 기간을 바꾸려면 해제한 뒤 다시 정지해 주세요.' },
  MEMBER_SUSPENSION_NOT_FOUND: { status: 404, message: '정지 기록을 찾지 못했습니다. 새로고침해 주세요.' },
  MEMBER_SUSPENSION_NOT_ACTIVE: { status: 409, message: '이미 해제되었거나 기간이 끝난 정지입니다. 새로고침해 주세요.' },
  MEMBER_SUSPENSION_NOTICE_ALREADY_RECORDED: { status: 409, message: '이미 알림을 기록한 정지입니다.' },
  MEMBER_NOTE_INPUT_INVALID: { status: 400, message: '메모는 1~2000자로 적어 주세요.' },
  MEMBER_NOTE_ACTOR_NOT_ALLOWED: { status: 403, message: '이 메모를 처리할 권한이 없습니다(지우기는 작성자·대표, 가림은 대표).' },
  MEMBER_NOTE_TARGET_INVALID: { status: 409, message: '메모를 남길 수 없는 계정입니다(관리자·탈퇴 회원).' },
  MEMBER_NOTE_NOT_FOUND: { status: 404, message: '메모를 찾지 못했습니다. 새로고침해 주세요.' },
  MEMBER_NOTE_ALREADY_DELETED: { status: 409, message: '이미 지운 메모입니다.' },
  MEMBER_NOTE_ALREADY_REDACTED: { status: 409, message: '이미 가림 처리한 메모입니다.' },
  MEMBER_SUSPENSION_POLICY_ACTOR_NOT_OWNER: { status: 403, message: '대표만 저장할 수 있습니다.' },
  MEMBER_SUSPENSION_POLICY_NOT_FOUND: { status: 503, message: '이용 정지 설정 행이 없습니다.' },
  MEMBER_SUSPENSION_POLICY_REVISION_CONFLICT: { status: 409, message: '다른 곳에서 먼저 저장했습니다. 새로고침한 뒤 다시 고쳐 주세요.' },
  MEMBER_SUSPENSION_POLICY_INPUT_INVALID: { status: 400, message: '문구·분류·최대 일수 형식이 올바르지 않습니다.' },
  MEMBER_SUSPENSION_POLICY_CODE_IN_USE: { status: 409, message: '정지 기록에 쓰인 분류 코드는 지울 수 없습니다. 숨김으로 바꿔 주세요.' },
}

// DB 오류 메시지(예: 'MEMBER_SUSPEND_ALREADY_ACTIVE' 또는 'MEMBER_SUSPENSION_POLICY_INPUT_INVALID: texts.noticeTitle')에서 코드를 찾는다.
export function describeMemberSuspensionError(message: string | null | undefined): { code: string; status: number; message: string } {
  const text = message ?? ''
  const code = MEMBER_SUSPENSION_ERROR_CODES
    .filter((candidate) => text.includes(candidate))
    .sort((a, b) => b.length - a.length)[0]
  if (code) return { code, ...MEMBER_SUSPENSION_ERROR_VIEW[code] }
  return { code: 'MEMBER_SUSPENSION_UNKNOWN_ERROR', status: 500, message: '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.' }
}
