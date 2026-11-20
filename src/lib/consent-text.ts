// 가입 동의 문구의 공백 규칙(DB 함수 public.consent_normalize_text 와 같은 문자 목록 — 마이그레이션 20261120120000).
// CRLF→LF 로 바꾼 뒤 앞뒤의 공백 문자만 지운다. 로케일·JS 의 \s 정의에 기대지 않도록 문자를 직접 적는다.
const CONSENT_SPACE_CHARS = ' \\t\\n\\r\\v\\f\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff'
const LEADING_SPACE = new RegExp(`^[${CONSENT_SPACE_CHARS}]+`)
const TRAILING_SPACE = new RegExp(`[${CONSENT_SPACE_CHARS}]+$`)

export function normalizeConsentText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.replace(/\r\n/g, '\n').replace(LEADING_SPACE, '').replace(TRAILING_SPACE, '')
}

export function isConsentTextEmpty(value: unknown) {
  return normalizeConsentText(value) === ''
}
