import {
  CHECKOUT_CONSENT_LINK_KEYS,
  CHECKOUT_CONSENT_SPECS,
  MARKET_CART_TEXT_KEYS,
  type CheckoutConsentFormat,
  type CheckoutConsentKind,
  type CheckoutConsentLinkKey,
  type CheckoutConsentProblem,
  type CheckoutConsentRawItem,
  type MarketCartTextKey,
} from '@/lib/checkout-consent'
import { POINT_CHARGE_CHECKOUT_ITEM_LABELS, POINT_CHARGE_VALIDITY_YEARS } from '@/lib/point-charge-policy'

// 11번 9절: 관리자 문구 편집 화면이 쓰는 순수 도우미(입력 정리·한글 이름·지문에 드는 칸·저장 검사 보조).
// 검사 규칙 자체는 checkout-consent.ts(checkCheckoutConsentKeys·checkMarketCartTexts)가 정한다 — 여기서는 다시 정하지 않는다.

export interface CheckoutConsentKeysInput {
  consentTitle: string
  consentSummary: Record<string, string>
  consentItems: CheckoutConsentRawItem[]
}

export type MarketCartTextsInput = Record<MarketCartTextKey, string>

// 화면에 보이는 한글 이름(관리자 화면 전용)
export const CHECKOUT_CONSENT_ROLE_LABELS: Record<string, string> = {
  refundPeriod: '환불 기간',
  restriction: '환불 제한',
  validity: '유효기간',
  minor: '미성년자 결제 취소',
  note: '덧붙임 줄(선택)',
}

export const CHECKOUT_CONSENT_TARGET_LABELS: Record<CheckoutConsentKind, Record<string, string>> = {
  market: {
    confirmNotice: '자료 환불 안내 본문(구매 확인 고지)',
    usageScopeNotice: '이용 범위',
    downloadPeriodNotice: '이용 기간·다운로드',
  },
  point_charge: {
    'checkoutItems.product': POINT_CHARGE_CHECKOUT_ITEM_LABELS.product,
    'checkoutItems.validity': POINT_CHARGE_CHECKOUT_ITEM_LABELS.validity,
    'checkoutItems.refund': POINT_CHARGE_CHECKOUT_ITEM_LABELS.refund,
    'checkoutItems.restriction': POINT_CHARGE_CHECKOUT_ITEM_LABELS.restriction,
    'checkoutItems.otherCases': POINT_CHARGE_CHECKOUT_ITEM_LABELS.otherCases,
    minorNotice: '미성년자 안내',
  },
}

export const CHECKOUT_CONSENT_LINK_LABELS: Record<CheckoutConsentLinkKey, string> = {
  refundPolicy: '취소·환불정책 문서(새 창 링크)',
  serviceTerms: '서비스 이용약관 문서(새 창 링크)',
}

export const CHECKOUT_CONSENT_FINGERPRINT_HINT = '결제 동의 내용에 들어갑니다. 바꾸면 결제 화면을 열어 둔 회원은 다시 동의해야 합니다.'
export const MARKET_CART_TEXT_HINT = '장바구니 결제 칸에 보이고 결제 때 지문으로 대조됩니다. 바꾸면 장바구니를 열어 둔 회원은 다시 확인해야 합니다.'
export const CHECKOUT_PANEL_OVERFLOW_MESSAGE = '1366×768 노트북 결제 칸에 동의와 결제 버튼이 함께 들어가지 않습니다.'

export function describeCheckoutConsentFormat(format: CheckoutConsentFormat | null): string {
  if (format === 1) return '펼친 고지(예전 방식)'
  if (format === 2) return '접는 동의(새 방식)'
  return '알 수 없음(결제가 막혀 있습니다 — 개발 담당에게 알려 주세요)'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

// 저장 전 정리: CRLF→LF, 앞뒤 공백 제거(한 줄 칸의 줄바꿈은 지우지 않고 검사가 거절한다).
export function normalizeConsentText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\r\n?/g, '\n').trim() : ''
}

// 화면이 보낸 2판 키를 정해진 모양으로만 다시 만든다(모르는 키·consentFormat 은 버림).
export function normalizeCheckoutConsentKeysInput(kind: CheckoutConsentKind, input: unknown): CheckoutConsentKeysInput {
  const record = asRecord(input) ?? {}
  const summaryInput = asRecord(record.consentSummary) ?? {}
  const consentSummary: Record<string, string> = {}
  for (const role of CHECKOUT_CONSENT_SPECS[kind].summaryRoles) {
    if (Object.hasOwn(summaryInput, role.role)) consentSummary[role.role] = normalizeConsentText(summaryInput[role.role])
  }
  const itemsInput = Array.isArray(record.consentItems) ? record.consentItems : []
  const consentItems: CheckoutConsentRawItem[] = itemsInput.map((raw) => {
    const item = asRecord(raw) ?? {}
    const key = typeof item.key === 'string' ? item.key : ''
    const label = normalizeConsentText(item.label)
    if (item.view === 'link') {
      return { key, label, view: 'link', link: (typeof item.link === 'string' ? item.link : '') as CheckoutConsentLinkKey }
    }
    const textKeys = Array.isArray(item.textKeys) ? item.textKeys.filter((target): target is string => typeof target === 'string') : []
    return { key, label, view: 'text', textKeys }
  })
  return { consentTitle: normalizeConsentText(record.consentTitle), consentSummary, consentItems }
}

export function normalizeMarketCartTextsInput(input: unknown): MarketCartTextsInput {
  const record = asRecord(input) ?? {}
  const texts = {} as MarketCartTextsInput
  for (const key of MARKET_CART_TEXT_KEYS) texts[key] = normalizeConsentText(record[key])
  return texts
}

// 저장된 원본에서 2판 키를 편집 초기값으로 꺼낸다(없으면 null — '새 방식 문구가 아직 없습니다').
export function pickCheckoutConsentKeys(kind: CheckoutConsentKind, raw: unknown): CheckoutConsentKeysInput | null {
  const record = asRecord(raw)
  if (!record || !(Object.hasOwn(record, 'consentTitle') || Object.hasOwn(record, 'consentSummary') || Object.hasOwn(record, 'consentItems'))) {
    return null
  }
  return normalizeCheckoutConsentKeysInput(kind, record)
}

export function pickMarketCartTexts(raw: unknown): MarketCartTextsInput | null {
  const record = asRecord(raw)
  if (!record || !MARKET_CART_TEXT_KEYS.some((key) => Object.hasOwn(record, key))) return null
  return normalizeMarketCartTextsInput(record)
}

// 새 항목의 key 는 코드가 만든다(관리자가 고르지 않음). 기존 key 는 그대로 둔다.
export function nextCheckoutConsentItemKey(existing: readonly string[]): string {
  for (let n = 1; ; n += 1) {
    const key = `item${n}`
    if (!existing.includes(key)) return key
  }
}

// 지문(동의 원문)에 들어가는 칸(그때 판과 consentItems 로 계산, 9절 힌트용). 필드 이름은 정책 키 경로.
export function checkoutConsentFingerprintFields(kind: CheckoutConsentKind, format: CheckoutConsentFormat | null, value: unknown): Set<string> {
  const fields = new Set<string>()
  if (format === 1) {
    if (kind === 'market') {
      fields.add('checkboxLabel')
      fields.add('confirmNotice')
    } else {
      for (const key of ['checkoutTitle', 'checkoutItems.product', 'checkoutItems.validity', 'checkoutItems.refund',
        'checkoutItems.restriction', 'checkoutItems.otherCases', 'minorNotice', 'agreeLabel']) fields.add(key)
    }
    return fields
  }
  if (format !== 2) return fields
  fields.add('consentTitle')
  fields.add('consentSummary')
  fields.add('consentItems')
  const items = asRecord(value)?.consentItems
  if (Array.isArray(items)) {
    for (const raw of items) {
      const textKeys = asRecord(raw)?.textKeys
      if (Array.isArray(textKeys)) for (const target of textKeys) if (typeof target === 'string') fields.add(target)
    }
  }
  return fields
}

// 9절: 충전 checkoutItems.validity 의 '[0-9]+년' 은 POINT_CHARGE_VALIDITY_YEARS 와 같아야 저장(지급 함수 interval 과 묶임).
export function checkPointChargeValidityYears(text: string): string | null {
  for (const match of text.matchAll(/([0-9]+)년/g)) {
    if (Number(match[1]) !== POINT_CHARGE_VALIDITY_YEARS) {
      return `유효기간 문구의 '${match[0]}'이(가) 실제 유효기간(${POINT_CHARGE_VALIDITY_YEARS}년)과 다릅니다.`
    }
  }
  return null
}

// 문제 목록을 한 문장으로(서버 액션 거절 메시지)
export function summarizeCheckoutConsentProblems(problems: CheckoutConsentProblem[]): string | null {
  if (problems.length === 0) return null
  return `새 방식 동의 문구를 확인해 주세요: ${problems[0].message}${problems.length > 1 ? ` 외 ${problems.length - 1}건` : ''}`
}

// 지문에 들지 않는 문구 키는 바뀐 키의 전후 값을 전문 그대로 남긴다(작업 기록, 스크립트 기록과 같은 모양 {key: {before, after}}).
export function diffPolicyTextKeys(before: Record<string, unknown>, after: Record<string, unknown>, keys: readonly string[]): {
  changedKeys: string[]
  changes: Record<string, { before: unknown; after: unknown }>
} {
  const changedKeys = keys.filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
  const changes: Record<string, { before: unknown; after: unknown }> = {}
  for (const key of changedKeys) changes[key] = { before: before[key] ?? null, after: after[key] ?? null }
  return { changedKeys, changes }
}

export const CHECKOUT_CONSENT_KEY_NAMES = ['consentTitle', 'consentSummary', 'consentItems'] as const
export { CHECKOUT_CONSENT_LINK_KEYS }
