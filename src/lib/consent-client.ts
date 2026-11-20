import { buildConsentPagePath } from '@/lib/consent-gate'

// 돈 API 가 403 CONSENT_REQUIRED 를 돌려주면 결제·구매·생성 화면은 동의 화면으로 보낸다(공용 처리 하나).
// 두 응답 모양(payload.error.code / body.code)을 모두 읽는다.
export function readConsentBlockCode(status: number, body: unknown): string | null {
  if (status !== 403 && status !== 503) return null
  if (!body || typeof body !== 'object') return null
  const record = body as { code?: unknown; error?: unknown }
  const nested = record.error && typeof record.error === 'object' ? (record.error as { code?: unknown }).code : undefined
  const code = typeof record.code === 'string' ? record.code : typeof nested === 'string' ? nested : null
  return code && ['CONSENT_REQUIRED', 'CONSENT_CHECK_FAILED', 'CONSENT_PROFILE_MISSING', 'ADMIN_ACCOUNT_NOT_MEMBER'].includes(code)
    ? code
    : null
}

// 동의 화면으로 보냈으면 true. 그 밖의 막힘(확인 실패·관리자 계정·회원 정보 없음)은 호출한 화면이 문구를 보여 준다.
export function redirectToConsentIfRequired(status: number, body: unknown) {
  if (readConsentBlockCode(status, body) !== 'CONSENT_REQUIRED') {
    return false
  }
  const next = `${window.location.pathname}${window.location.search}`
  window.location.assign(buildConsentPagePath(next))
  return true
}
