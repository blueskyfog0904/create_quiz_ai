// 관리자 ID는 아이디+비밀번호로 로그인하며, 내부적으로 아래 도메인의
// 합성 이메일 계정(Supabase Auth)에 매핑된다. 클라이언트에서도 사용하므로
// 비밀값이 아니며, 일반 회원가입에서는 이 도메인 이메일을 거부한다.
export const ADMIN_ACCOUNT_EMAIL_DOMAIN = 'admin.summersun.local'

export const ADMIN_LOGIN_ID_PATTERN = /^[a-z0-9_-]{3,30}$/

export function normalizeAdminLoginId(value: string) {
  return value.trim().toLowerCase()
}

export function resolveAdminLoginEmail(value: string) {
  const normalized = normalizeAdminLoginId(value)
  return normalized.includes('@') ? normalized : `${normalized}@${ADMIN_ACCOUNT_EMAIL_DOMAIN}`
}

export function isAdminAccountEmail(email: string) {
  return email.trim().toLowerCase().endsWith(`@${ADMIN_ACCOUNT_EMAIL_DOMAIN}`)
}

export function extractAdminLoginId(email: string) {
  return isAdminAccountEmail(email) ? email.split('@')[0] : email
}
