import { normalizeConsentText } from '@/lib/consent-text'

// 회원가입 약관 동의(4번 묶음)에서 화면·서버가 함께 쓰는 형식과 순수 함수. 항목·문구 데이터는 DB 에만 있다.

export type ConsentItem = {
  id: string
  version: number
  label: string
  content: string
  required: boolean
  // 연결 약관 전문 주소(문서가 없거나 꺼져 있으면 null — 링크를 숨긴다)
  policyHref: string | null
  // 현재 버전 원문의 '회원에게 보이는 변경 안내'(첫 도입이면 null)
  note: string | null
  revisedAt: string | null
}

export type ConsentSubmissionItem = {
  item_id: string
  version: number
  agreed: boolean
}

export type ConsentRecordResult = {
  item_id: string
  item_version: number
  agreed: boolean
  created_at: string
}

export const SIGNUP_CONSENT_TEXTS_SETTING_KEY = 'signup_consent_texts'

export const SIGNUP_CONSENT_TEXT_KEYS = [
  'kakaoConfirmNotice',
  'kakaoCancelDoneNotice',
  'consentTitle',
  'consentFirstIntro',
  'consentRevisedIntro',
  'declineConfirm',
  'optionalResultTemplate',
  'optionalReceiptTemplate',
  'optionalNotRequiredHint',
] as const

export type SignupConsentTextKey = (typeof SIGNUP_CONSENT_TEXT_KEYS)[number]
export type SignupConsentTexts = Record<SignupConsentTextKey, string>

export const SIGNUP_CONSENT_TEXT_LABELS: Record<SignupConsentTextKey, string> = {
  kakaoConfirmNotice: '카카오 가입 확인 안내',
  kakaoCancelDoneNotice: '카카오 가입 취소 완료 안내',
  consentTitle: '동의 화면 제목',
  consentFirstIntro: '동의 화면 설명(처음 도입)',
  consentRevisedIntro: '동의 화면 설명(약관 개정)',
  declineConfirm: '동의하지 않음 확인 창',
  optionalResultTemplate: '선택 동의 처리 결과 안내 틀',
  optionalReceiptTemplate: '이메일 가입 선택 동의 접수 안내 틀',
  optionalNotRequiredHint: '선택 항목 안내',
}

export const SIGNUP_CONSENT_TEXT_MAX_LENGTH = 500

const RESULT_PLACEHOLDERS = ['{전송자}', '{항목}', '{결과}', '{처리일자}'] as const
const RECEIPT_PLACEHOLDERS = ['{항목}', '{결과}'] as const

export function normalizeSignupConsentTexts(value: unknown): SignupConsentTexts {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(
    SIGNUP_CONSENT_TEXT_KEYS.map((key) => [key, normalizeConsentText(record[key])])
  ) as SignupConsentTexts
}

function findPlaceholders(template: string) {
  return template.match(/\{[^{}]*\}/g) ?? ([] as string[])
}

// 저장 검사: 모든 문구가 있어야 하고, 안내 틀은 정해진 자리표시만 쓴다. 문제없으면 null.
export function validateSignupConsentTexts(texts: SignupConsentTexts): string | null {
  for (const key of SIGNUP_CONSENT_TEXT_KEYS) {
    if (!texts[key]) {
      return `${SIGNUP_CONSENT_TEXT_LABELS[key]}을(를) 입력해 주세요.`
    }
    if (texts[key].length > SIGNUP_CONSENT_TEXT_MAX_LENGTH) {
      return `${SIGNUP_CONSENT_TEXT_LABELS[key]}은(는) ${SIGNUP_CONSENT_TEXT_MAX_LENGTH}자 이하로 입력해 주세요.`
    }
  }
  const resultPlaceholders = findPlaceholders(texts.optionalResultTemplate)
  if (RESULT_PLACEHOLDERS.some((placeholder) => !resultPlaceholders.includes(placeholder))
    || resultPlaceholders.some((placeholder) => !(RESULT_PLACEHOLDERS as readonly string[]).includes(placeholder))) {
    return '처리 결과 안내 틀에는 {전송자}·{항목}·{결과}·{처리일자}만, 모두 넣어 주세요.'
  }
  const receiptPlaceholders = findPlaceholders(texts.optionalReceiptTemplate)
  if (RECEIPT_PLACEHOLDERS.some((placeholder) => !receiptPlaceholders.includes(placeholder))
    || receiptPlaceholders.some((placeholder) => !(RECEIPT_PLACEHOLDERS as readonly string[]).includes(placeholder))) {
    return '접수 안내 틀에는 {항목}·{결과}만, 모두 넣어 주세요.'
  }
  return null
}

export function formatConsentDate(value: string | Date) {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

function fillTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{[^{}]*\}/g, (placeholder) => values[placeholder] ?? placeholder)
}

// 정식 처리 결과 안내(실제 기록이 있는 화면에서만 — 동의 화면·선택 동의 관리·카카오 가입 완료).
export function formatOptionalResult(
  template: string,
  input: { sender: string; itemLabel: string; agreed: boolean; processedAt: string }
) {
  return fillTemplate(template, {
    '{전송자}': input.sender,
    '{항목}': input.itemLabel,
    '{결과}': input.agreed ? '동의함' : '동의하지 않음',
    '{처리일자}': formatConsentDate(input.processedAt),
  }).replace(/\s{2,}/g, ' ').trim()
}

// 이메일 가입 접수 안내(새 계정·이미 있는 이메일·미인증 계정 세 경우에 똑같이 참인 문구).
export function formatOptionalReceipt(template: string, input: { itemLabel: string; agreed: boolean }) {
  return fillTemplate(template, {
    '{항목}': input.itemLabel,
    '{결과}': input.agreed ? '동의함' : '동의하지 않음',
  })
}

// 고지 본문의 최소 강조 표기 **…** — 굵게·밑줄·크게 보인다. HTML 은 화면이 글자로만 그리므로 따로 이스케이프할 것이 없다.
export type ConsentTextSegment = { text: string; emphasis: boolean }

export function parseConsentEmphasis(line: string): ConsentTextSegment[] {
  const segments: ConsentTextSegment[] = []
  const pattern = /\*\*(.+?)\*\*/g
  let lastIndex = 0
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > lastIndex) {
      segments.push({ text: line.slice(lastIndex, index), emphasis: false })
    }
    segments.push({ text: match[1], emphasis: true })
    lastIndex = index + match[0].length
  }
  if (lastIndex < line.length) {
    segments.push({ text: line.slice(lastIndex), emphasis: false })
  }
  return segments
}

export function splitConsentLines(content: string) {
  return normalizeConsentText(content).split('\n')
}

// '보기'를 펼치지 않아도 보여야 하는 줄: 필수 항목의 첫 줄, 그리고 강조 표기가 있는 줄.
export function getAlwaysVisibleConsentLines(item: Pick<ConsentItem, 'content' | 'required'>) {
  const lines = splitConsentLines(item.content).filter((line) => line.trim())
  return lines.filter((line, index) => (item.required && index === 0) || /\*\*(.+?)\*\*/.test(line))
}

export function buildConsentSubmission(items: Pick<ConsentItem, 'id' | 'version'>[], checked: Record<string, boolean>): ConsentSubmissionItem[] {
  return items.map((item) => ({ item_id: item.id, version: item.version, agreed: checked[item.id] === true }))
}

export function findMissingRequiredItems<T extends Pick<ConsentItem, 'id' | 'required'>>(items: T[], checked: Record<string, boolean>) {
  return items.filter((item) => item.required && checked[item.id] !== true)
}

// DB 함수 오류 이름 → 화면 문구.
export const CONSENT_ERROR_MESSAGES: Record<string, string> = {
  CONSENT_INPUT_INVALID: '동의 내용을 확인하지 못했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.',
  CONSENT_ITEM_CHANGED: '약관 항목이 바뀌었습니다. 다시 확인해 주세요.',
  CONSENT_REQUIRED_MISSING: '필수 항목에 모두 동의해 주세요.',
  CONSENT_MYPAGE_REQUIRED_ITEM: '필수 항목은 여기서 바꿀 수 없습니다.',
  CONSENT_PROFILE_MISSING: '회원 정보를 찾지 못했습니다. 로그아웃한 뒤 다시 로그인해 주세요.',
  CONSENT_KAKAO_SIGNUP_INCOMPLETE: '카카오 가입을 먼저 마쳐 주세요.',
  CONSENT_POLICY_UNAVAILABLE: '약관을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.',
  CONSENT_LOAD_FAILED: '약관 항목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
}

export function getConsentErrorMessage(code: string | null | undefined) {
  return (code && CONSENT_ERROR_MESSAGES[code]) || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
}

export function extractConsentErrorCode(message: string | null | undefined) {
  const match = (message ?? '').match(/\b(CONSENT_[A-Z_]+)\b/)
  return match ? match[1] : null
}

// 카카오로 넘어가기 전에 가입 선택 화면에서 받은 동의값(같은 탭 sessionStorage). 30분이 지났거나 항목 버전이 다르면 버린다.
export const KAKAO_CONSENT_STORAGE_KEY = 'sst-kakao-signup-consents'
export const KAKAO_CONSENT_MAX_AGE_MS = 30 * 60 * 1000

export function serializeKakaoConsentDraft(submission: ConsentSubmissionItem[], now = Date.now()) {
  return JSON.stringify({ savedAt: now, items: submission })
}

// 동의 화면 진입·카카오 가입 완료·취소·이미 완료로 이동할 때 지운다(브라우저에서만 부른다).
export function clearKakaoConsentDraft() {
  try {
    window.sessionStorage.removeItem(KAKAO_CONSENT_STORAGE_KEY)
  } catch {
    // 저장소를 쓸 수 없으면 지울 것도 없다.
  }
}

export function parseKakaoConsentDraft(
  raw: string | null,
  currentItems: Pick<ConsentItem, 'id' | 'version'>[],
  now = Date.now()
): Record<string, boolean> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { savedAt?: unknown; items?: unknown }
    if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > KAKAO_CONSENT_MAX_AGE_MS || now < parsed.savedAt) {
      return null
    }
    if (!Array.isArray(parsed.items)) return null
    const versions = new Map(currentItems.map((item) => [item.id, item.version]))
    const checked: Record<string, boolean> = {}
    for (const entry of parsed.items as ConsentSubmissionItem[]) {
      if (!entry || versions.get(entry.item_id) !== entry.version) {
        return null
      }
      checked[entry.item_id] = entry.agreed === true
    }
    return checked
  } catch {
    return null
  }
}

// 이메일 가입 오류 판정. 회원별 재발송 간격 제한(이미 있는 미인증 계정에서만 생김)은 성공 안내와 같게 다룬다
// — 계정이 있는지 드러내지 않기 위해서다. 프로젝트 전체 메일 한도('Email rate limit exceeded')는 계정이 만들어지지 않으므로 실패다.
// 같은 오류 코드(over_email_send_rate_limit)를 쓰므로 문구로 가른다. 문구가 바뀌어 맞지 않으면 실패 쪽으로 떨어진다(안전한 쪽).
export function isSignupResendIntervalError(message: string | null | undefined) {
  return /you can only request this after/i.test(message ?? '')
}

export function describeSignupError(message: string | null | undefined) {
  const text = message ?? ''
  if (/rate limit/i.test(text)) {
    return '지금은 가입 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.'
  }
  if (/password/i.test(text)) {
    return '비밀번호 조건을 확인해 주세요(6자 이상).'
  }
  if (/email/i.test(text) && /invalid/i.test(text)) {
    return '이메일 주소를 확인해 주세요.'
  }
  return '회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

export function parseConsentSubmission(raw: unknown): ConsentSubmissionItem[] | null {
  if (typeof raw !== 'string' || raw.length > 10000) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 50) return null
    const items: ConsentSubmissionItem[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') return null
      const { item_id: itemId, version, agreed } = entry as Record<string, unknown>
      if (typeof itemId !== 'string' || typeof version !== 'number' || !Number.isInteger(version) || typeof agreed !== 'boolean') {
        return null
      }
      items.push({ item_id: itemId, version, agreed })
    }
    return items
  } catch {
    return null
  }
}
