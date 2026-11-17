import { isAdminAccountEmail } from '@/lib/admin-accounts-shared'

// 비밀번호 재설정(W3-7)의 규칙. 화면·서버 액션·route가 함께 쓰므로 순수 함수만 둔다.

export const PASSWORD_RESET_REQUEST_PATH = '/forgot-password'
export const PASSWORD_RESET_FORM_PATH = '/reset-password'
// 기본 메일 템플릿({{ .ConfirmationURL }})의 ?code= 가 돌아오는 곳이자, "계속" 버튼의 POST를 받는 곳.
export const PASSWORD_RESET_CONFIRM_PATH = '/auth/confirm'
export const PASSWORD_RESET_DONE_LOGIN_PATH = '/login?reset=done'

// 가입 여부와 무관하게 항상 같은 안내를 보여 준다(가입된 이메일인지 드러내지 않는다).
export const PASSWORD_RESET_REQUEST_NOTICE =
  '해당 이메일로 가입된 계정이 있으면 비밀번호 재설정 메일을 보냈습니다. 메일이 보이지 않으면 스팸함을 확인하고, 1분 뒤에 다시 요청해 주세요. 카카오로 가입한 계정은 비밀번호가 없으므로 메일이 가지 않습니다. 카카오 로그인을 이용해 주세요.'

export const PASSWORD_RESET_INVALID_EMAIL_MESSAGE = '이메일 주소를 정확히 입력해 주세요.'
// 회원가입(auth/actions.ts)이 관리자 내부 도메인을 거부할 때와 같은 문구
export const PASSWORD_RESET_BLOCKED_EMAIL_MESSAGE = '사용할 수 없는 이메일 주소입니다.'
export const PASSWORD_RESET_RATE_LIMIT_MESSAGE = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.'
export const PASSWORD_RESET_TEMPORARY_ERROR_MESSAGE = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
export const PASSWORD_RESET_ADMIN_MESSAGE =
  '관리자 계정의 비밀번호는 이 화면에서 바꿀 수 없습니다. 관리자 ID 관리에서 변경해 주세요.'
export const PASSWORD_RESET_KAKAO_MESSAGE =
  '카카오로 가입한 계정은 비밀번호가 없습니다. 카카오 로그인을 이용해 주세요.'

// 마이페이지 비밀번호 변경(profile-view.tsx)과 같은 규칙·문구
export const PASSWORD_MIN_LENGTH = 6

export function validateNewPassword(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) {
    return '새 비밀번호가 일치하지 않습니다.'
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `비밀번호는 최소 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`
  }
  return null
}

export function normalizeResetEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

// 요청 화면에서 받은 이메일을 형식만 보고 가른다(계정이 있는지는 보지 않는다).
export function checkResetRequestEmail(email: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return PASSWORD_RESET_INVALID_EMAIL_MESSAGE
  }
  // 관리자 ID는 내부 도메인의 합성 이메일이라 메일함이 없다.
  if (isAdminAccountEmail(email)) {
    return PASSWORD_RESET_BLOCKED_EMAIL_MESSAGE
  }
  return null
}

type ResetAccountProfile = { provider?: string | null; is_admin?: boolean | null }

// 같은 안내를 보여 주되 메일은 보내지 않는 계정: 카카오 가입(비밀번호 로그인이 새로 생기지 않게, 계획 Q-8)과 관리자.
export function shouldSkipResetMail(profiles: readonly ResetAccountProfile[]): boolean {
  return profiles.some((profile) => profile.provider === 'kakao' || profile.is_admin === true)
}

export type PasswordResetBlockReason = 'admin' | 'kakao'

// 복구 세션으로 들어온 계정이 관리자이거나 카카오 가입 계정이면 비밀번호 변경을 거부한다. profile은 세션의 사용자 id로 읽은 행.
export function getPasswordResetBlockReason(
  email: string | null | undefined,
  profile: ResetAccountProfile | null
): PasswordResetBlockReason | null {
  if ((email ? isAdminAccountEmail(email) : false) || profile?.is_admin === true) {
    return 'admin'
  }
  return profile?.provider === 'kakao' ? 'kakao' : null
}

export const PASSWORD_RESET_BLOCK_MESSAGES: Record<PasswordResetBlockReason, string> = {
  admin: PASSWORD_RESET_ADMIN_MESSAGE,
  kakao: PASSWORD_RESET_KAKAO_MESSAGE,
}

type AuthErrorLike = { code?: string; status?: number } | null | undefined

// resetPasswordForEmail 결과 → 화면에 보일 것.
// 메일 발송 한도(over_email_send_rate_limit)는 가입된 주소에서만 나므로 오류로 보이면 가입 여부가 드러난다 → 같은 안내로 답한다.
export function resolveResetRequestOutcome(error: AuthErrorLike): { success: true; message: string } | { success: false; error: string } {
  if (!error || error.code === 'over_email_send_rate_limit') {
    return { success: true, message: PASSWORD_RESET_REQUEST_NOTICE }
  }
  if (error.code === 'over_request_rate_limit' || error.status === 429) {
    return { success: false, error: PASSWORD_RESET_RATE_LIMIT_MESSAGE }
  }
  return { success: false, error: PASSWORD_RESET_TEMPORARY_ERROR_MESSAGE }
}

// updateUser({ password }) 오류 → 한국어 문구
export function describePasswordUpdateError(error: AuthErrorLike): string {
  if (error?.code === 'same_password') {
    return '기존 비밀번호와 다른 비밀번호를 입력해 주세요.'
  }
  if (error?.code === 'weak_password') {
    return '비밀번호가 너무 단순합니다. 더 길거나 복잡한 비밀번호를 입력해 주세요.'
  }
  if (error?.code === 'over_request_rate_limit' || error?.status === 429) {
    return PASSWORD_RESET_RATE_LIMIT_MESSAGE
  }
  return '비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

// 메일 링크의 token_hash. type이 recovery가 아니거나 모양이 이상하면 null.
export function parseRecoveryTokenHash(tokenHash: unknown, type: unknown): string | null {
  if (type !== 'recovery' || typeof tokenHash !== 'string') {
    return null
  }
  return /^[A-Za-z0-9_-]{16,256}$/.test(tokenHash) ? tokenHash : null
}

// 재설정 화면의 실패 사유. 주소의 error 값은 이 목록에 있을 때만 쓴다.
export const PASSWORD_RESET_ERROR_MESSAGES = {
  // 출처 검사에서 걸린 경우. 링크는 쓰이지 않았으므로 '만료'가 아니라 브라우저를 바꿔 보라고 안내한다.
  untrusted_origin: '이 브라우저에서 요청을 확인하지 못했습니다. 메일의 링크를 다른 브라우저(크롬, 사파리 등)에서 다시 열어 주세요.',
  invalid_link: '링크가 만료되었거나 이미 사용되었습니다. 재설정 메일을 다시 요청해 주세요.',
  other_browser:
    '이 링크는 재설정을 요청한 브라우저에서만 열 수 있습니다. 요청한 기기에서 메일을 열거나, 지금 이 기기에서 재설정 메일을 다시 요청해 주세요.',
  admin: PASSWORD_RESET_ADMIN_MESSAGE,
  kakao: PASSWORD_RESET_KAKAO_MESSAGE,
} as const

export type PasswordResetErrorCode = keyof typeof PASSWORD_RESET_ERROR_MESSAGES

export function resolvePasswordResetError(value: unknown): PasswordResetErrorCode | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PASSWORD_RESET_ERROR_MESSAGES, value)
    ? (value as PasswordResetErrorCode)
    : null
}

// 확인 route가 보낼 곳. 주소에서 받은 값(next 등)은 쓰지 않고 정해진 경로로만 보낸다(열린 리다이렉트 방지).
export function buildPasswordResetRedirectPath(error?: PasswordResetErrorCode | null): string {
  return error ? `${PASSWORD_RESET_FORM_PATH}?error=${error}` : PASSWORD_RESET_FORM_PATH
}

// "계속" 버튼의 POST가 우리 사이트의 화면에서 온 것인지 본다(다른 사이트가 남의 브라우저로 복구 링크를 제출해
// 공격자 계정으로 로그인시키는 것을 막는다). 폼의 action이 상대 경로라 정상 요청의 Origin은 요청 주소의 origin과 같다.
// Origin이 없거나 'null'(리퍼러 정책 등)이면 브라우저가 붙이는 Sec-Fetch-Site가 same-origin일 때만 받는다. 둘 다 없으면 거부.
export function isTrustedFormPostOrigin(input: {
  origin?: string | null
  secFetchSite?: string | null
  requestUrl: string
  envSiteUrl?: string | null
}): boolean {
  const origin = input.origin?.trim()
  if (!origin || origin === 'null') {
    return input.secFetchSite === 'same-origin'
  }
  const allowed: string[] = []
  for (const value of [input.requestUrl, input.envSiteUrl?.trim()]) {
    try {
      if (value) allowed.push(new URL(value).origin)
    } catch {
      // 주소로 읽을 수 없는 값은 허용 목록에 넣지 않는다.
    }
  }
  return allowed.includes(origin)
}

// 복구 표시 쿠키: 메일 링크로 들어온 세션에서만 새 비밀번호 화면을 보여 주기 위한 표시(일반 로그인 세션과 구분).
// 서명이 없어 브라우저에서 직접 만들어 넣을 수 있으므로 보안 경계가 아니다. 다만 세션을 가진 쪽은 이 화면 없이도
// Supabase API로 자기 비밀번호를 바꿀 수 있으므로, 이 표시를 위조해도 새로 얻는 것은 없다(화면을 가리는 편의 수준).
export const PASSWORD_RECOVERY_COOKIE = 'sst-password-recovery'
export const PASSWORD_RECOVERY_MAX_AGE_SECONDS = 30 * 60

// 표시에 넣는 세션 키: 액세스 토큰의 session_id. 미들웨어(decodeSessionId)와 같이 getUser/verifyOtp가 검증한 토큰을 디코드만 한다.
// 읽을 수 없으면 미들웨어처럼 사용자 id로 대신한다.
export function resolveRecoverySessionKey(accessToken: string | null | undefined, userId: string): string {
  const payload = accessToken?.split('.')[1]
  if (payload) {
    try {
      const parsed = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { session_id?: unknown }
      if (typeof parsed.session_id === 'string' && parsed.session_id) {
        return parsed.session_id
      }
    } catch {
      // 아래 기본값
    }
  }
  return `uid:${userId}`
}

export function buildRecoveryMarker(sessionKey: string, now: number): string {
  return `${sessionKey}:${now}`
}

export function isRecoveryMarkerValid(marker: string | null | undefined, sessionKey: string | null | undefined, now = Date.now()): boolean {
  if (!marker || !sessionKey) {
    return false
  }
  const separatorIndex = marker.lastIndexOf(':')
  if (separatorIndex < 1 || marker.slice(0, separatorIndex) !== sessionKey) {
    return false
  }
  const startedAt = Number(marker.slice(separatorIndex + 1))
  if (!Number.isFinite(startedAt)) {
    return false
  }
  const age = now - startedAt
  return age >= 0 && age <= PASSWORD_RECOVERY_MAX_AGE_SECONDS * 1000
}

// 재설정 메일에 실리는 주소(redirectTo)의 사이트 주소. 메일에 들어가는 값이므로 요청 헤더보다 NEXT_PUBLIC_SITE_URL을 먼저 쓴다
// (헤더를 꾸민 요청이 남의 메일 링크 주소를 바꾸지 못하게). 환경변수가 없을 때만 auth/callback처럼 요청 헤더에서 정한다.
export function resolveResetMailOrigin(input: {
  forwardedHost?: string | null
  forwardedProto?: string | null
  envSiteUrl?: string | null
  fallbackOrigin: string
}): string {
  const envSiteUrl = input.envSiteUrl?.trim()
  if (envSiteUrl) {
    // 경로가 붙었거나 형식이 틀린 값이 메일 링크에 그대로 실리지 않게 origin만 쓴다. 읽지 못하면 요청 헤더로 내려간다.
    try {
      const { origin, protocol } = new URL(envSiteUrl)
      if (protocol === 'http:' || protocol === 'https:') return origin
    } catch {
      // 아래 요청 헤더 계산으로 내려간다.
    }
  }

  const forwardedHost = input.forwardedHost?.split(',')[0]?.trim()
  const forwardedProto = input.forwardedProto?.split(',')[0]?.trim()
  if (forwardedHost && forwardedProto && /^(http|https)$/i.test(forwardedProto)) {
    return `${forwardedProto.toLowerCase()}://${forwardedHost}`
  }
  return input.fallbackOrigin
}
