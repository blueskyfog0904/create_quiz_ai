import { MAX_POINT_CHARGE_AMOUNT } from '@/lib/payment-constants'
import type { Json } from '@/types/supabase'

// 충전(크레딧 결제) 정책 문구·환불 기간(계획 docs/plan-bundle9-payment-refund-notice.md). 값은 DB(system_settings
// 'point_charge_policy')에만 둔다. 환불 판정·마감은 DB 함수(get_point_charge_refund_eligibility)가 하고, 코드는 그 값을 보여 주기만 한다.
// 지문(noticeSha256)은 서버만 계산한다(point-charge-policy-server.ts) — DB 함수 record_point_charge_checkout_ack 와 같은 규칙.
// - 사용기한 연수: 충전 지급 함수의 `p_approved_at + interval '1 year'`
//   (supabase/migrations/20261126100000_member_withdrawal.sql)
// - 1회 한도: MAX_POINT_CHARGE_AMOUNT와 DB CHECK
//   (supabase/migrations/20260805100000_create_payment_orders_and_atomic_fulfillment.sql)
export const POINT_CHARGE_VALIDITY_YEARS = 1
export const POINT_CHARGE_MAX_AMOUNT_TEXT = `${MAX_POINT_CHARGE_AMOUNT.toLocaleString('ko-KR')}원`

export const POINT_CHARGE_POLICY_SETTING_KEY = 'point_charge_policy'
export const POINT_CHARGE_REFUND_DAYS_PLACEHOLDER = '{충전환불기간}'
// DB point_charge_refund_days() 와 같은 범위(법정 최소 이상). 관리자 화면은 일수를 바꾸지 않는다.
export const POINT_CHARGE_REFUND_DAYS_MIN = 7
export const POINT_CHARGE_REFUND_DAYS_MAX = 3650

export const POINT_CHARGE_CHECKOUT_ITEM_KEYS = ['product', 'validity', 'refund', 'restriction', 'otherCases'] as const
export type PointChargeCheckoutItemKey = (typeof POINT_CHARGE_CHECKOUT_ITEM_KEYS)[number]
export type PointChargeCheckoutItems = Record<PointChargeCheckoutItemKey, string>

export interface PointChargePolicyTexts {
  checkoutTitle: string
  checkoutItems: PointChargeCheckoutItems
  minorNotice: string
  agreeLabel: string
  creditsGuide: string
  refundRequestConfirm: string[]
  refundRequestAccepted: string
  refundBlockReasons: Record<string, string>
}

export interface PointChargePolicy extends PointChargePolicyTexts {
  version: number
  refundDays: number
}

// 결제 화면에 내려 주는 값: 문구는 모두 채운 문장, 지문은 서버가 계산한 값.
export interface PointChargeCheckoutNotice {
  checkoutTitle: string
  checkoutItems: PointChargeCheckoutItems
  minorNotice: string
  agreeLabel: string
  refundDays: number
  noticeSha256: string
}

export const POINT_CHARGE_CHECKOUT_ITEM_LABELS: Record<PointChargeCheckoutItemKey, string> = {
  product: '상품·결제 내용',
  validity: '유효기간·양도',
  refund: '환불 조건',
  restriction: '환불 제한',
  otherCases: '그 밖의 경우',
}

export const POINT_CHARGE_POLICY_TEXT_LIMIT = 1000

export function isPointChargeRefundDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= POINT_CHARGE_REFUND_DAYS_MIN && value <= POINT_CHARGE_REFUND_DAYS_MAX
}

function hasOnlyPlaceholderBraces(text: string): boolean {
  return !/[{}]/.test(text.split(POINT_CHARGE_REFUND_DAYS_PLACEHOLDER).join(''))
}

function isNoticePart(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && hasOnlyPlaceholderBraces(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

// DB 값 해석. 결제 전 확인에 들어가는 문구(지문 대상)가 하나라도 틀리면 null(결제는 막고 "잠시 후 다시 시도").
// 크레딧 화면 문구(creditsGuide 등)는 빠져도 해석은 성공하고 빈 값으로 둔다(화면이 키별로 대체).
// 문구는 고치지 않는다(지문이 DB 와 같아야 함).
export function parsePointChargePolicy(input: Json | null | undefined): PointChargePolicy | null {
  const value = asRecord(input)
  if (!value) return null
  if (!isPointChargeRefundDays(value.refundDays)) return null
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 1) return null
  const items = asRecord(value.checkoutItems)
  if (!items) return null
  const checkoutItems = {} as PointChargeCheckoutItems
  for (const key of POINT_CHARGE_CHECKOUT_ITEM_KEYS) {
    const text = items[key]
    if (!isNoticePart(text)) return null
    checkoutItems[key] = text
  }
  if (!checkoutItems.refund.includes(POINT_CHARGE_REFUND_DAYS_PLACEHOLDER)) return null
  if (!isNoticePart(value.checkoutTitle) || !isNoticePart(value.minorNotice) || !isNoticePart(value.agreeLabel)) return null

  const reasons = asRecord(value.refundBlockReasons) ?? {}
  const refundBlockReasons: Record<string, string> = {}
  for (const [code, text] of Object.entries(reasons)) {
    if (typeof text === 'string' && text.trim() !== '') refundBlockReasons[code] = text
  }
  return {
    version: value.version,
    refundDays: value.refundDays,
    checkoutTitle: value.checkoutTitle,
    checkoutItems,
    minorNotice: value.minorNotice,
    agreeLabel: value.agreeLabel,
    creditsGuide: typeof value.creditsGuide === 'string' ? value.creditsGuide : '',
    refundRequestConfirm: Array.isArray(value.refundRequestConfirm)
      ? value.refundRequestConfirm.filter((line): line is string => typeof line === 'string' && line.trim() !== '')
      : [],
    refundRequestAccepted: typeof value.refundRequestAccepted === 'string' ? value.refundRequestAccepted : '',
    refundBlockReasons,
  }
}

// {충전환불기간} 을 모두 바꾼다(DB 함수의 replace 와 같은 결과).
export function fillPointChargeRefundDays(text: string, refundDays: number): string {
  return text.split(POINT_CHARGE_REFUND_DAYS_PLACEHOLDER).join(String(refundDays))
}

// 지문 대상 문장: 채운 제목·항목 5개·미성년자 안내·동의 문구를 줄바꿈(LF)으로 잇는다(DB 와 같은 순서).
export function buildPointChargeNoticeText(policy: Pick<PointChargePolicy,
  'checkoutTitle' | 'checkoutItems' | 'minorNotice' | 'agreeLabel' | 'refundDays'>): string {
  const parts = [
    policy.checkoutTitle,
    ...POINT_CHARGE_CHECKOUT_ITEM_KEYS.map((key) => policy.checkoutItems[key]),
    policy.minorNotice,
    policy.agreeLabel,
  ]
  return parts.map((part) => fillPointChargeRefundDays(part, policy.refundDays)).join('\n')
}

export function fillPointChargeCheckoutNotice(policy: PointChargePolicy): Omit<PointChargeCheckoutNotice, 'noticeSha256'> {
  const fill = (text: string) => fillPointChargeRefundDays(text, policy.refundDays)
  const checkoutItems = {} as PointChargeCheckoutItems
  for (const key of POINT_CHARGE_CHECKOUT_ITEM_KEYS) checkoutItems[key] = fill(policy.checkoutItems[key])
  return {
    checkoutTitle: fill(policy.checkoutTitle),
    checkoutItems,
    minorNotice: fill(policy.minorNotice),
    agreeLabel: fill(policy.agreeLabel),
    refundDays: policy.refundDays,
  }
}

// 409 CHECKOUT_NOTICE_CHANGED 의 details(DB record_point_charge_checkout_ack 가 돌려준 채운 문구) 해석.
export function parsePointChargeCheckoutNotice(input: unknown): PointChargeCheckoutNotice | null {
  const value = asRecord(input)
  const items = asRecord(value?.checkoutItems)
  if (!value || !items) return null
  if (typeof value.noticeSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.noticeSha256)) return null
  if (!isPointChargeRefundDays(value.refundDays)) return null
  const checkoutItems = {} as PointChargeCheckoutItems
  for (const key of POINT_CHARGE_CHECKOUT_ITEM_KEYS) {
    if (typeof items[key] !== 'string') return null
    checkoutItems[key] = items[key] as string
  }
  if (typeof value.checkoutTitle !== 'string' || typeof value.minorNotice !== 'string' || typeof value.agreeLabel !== 'string') return null
  return {
    checkoutTitle: value.checkoutTitle,
    checkoutItems,
    minorNotice: value.minorNotice,
    agreeLabel: value.agreeLabel,
    refundDays: value.refundDays,
    noticeSha256: value.noticeSha256,
  }
}

// 저장 전 정리: 줄바꿈 CRLF→LF, 앞뒤 공백 제거.
export function normalizePointChargePolicyText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

// 관리자 저장 검사(결제 전 확인 문구 — DB 가 받는 규칙과 같다). 문제가 없으면 null.
export function validatePointChargePolicyTexts(texts: PointChargePolicyTexts): string | null {
  const required: Array<[string, string]> = [
    ['결제 전 확인 제목', texts.checkoutTitle],
    ...POINT_CHARGE_CHECKOUT_ITEM_KEYS.map((key): [string, string] => [POINT_CHARGE_CHECKOUT_ITEM_LABELS[key], texts.checkoutItems[key]]),
    ['미성년자 안내', texts.minorNotice],
    ['결제 동의 문구', texts.agreeLabel],
  ]
  const optional: Array<[string, string]> = [
    ['크레딧 화면 안내', texts.creditsGuide],
    ['환불 신청 접수 안내', texts.refundRequestAccepted],
    ...texts.refundRequestConfirm.map((line, index): [string, string] => [`환불 신청 확인 ${index + 1}번째 줄`, line]),
    ...Object.entries(texts.refundBlockReasons).map(([code, text]): [string, string] => [`환불 불가 사유(${code})`, text]),
  ]
  for (const [label, text] of required) {
    if (!text || text.trim() === '') return `${label}을(를) 입력해 주세요.`
  }
  for (const [label, text] of [...required, ...optional]) {
    if (text.length > POINT_CHARGE_POLICY_TEXT_LIMIT) return `${label}은(는) ${POINT_CHARGE_POLICY_TEXT_LIMIT}자 이하로 입력해 주세요.`
    if (!hasOnlyPlaceholderBraces(text)) {
      return `${label}에는 ${POINT_CHARGE_REFUND_DAYS_PLACEHOLDER} 외의 중괄호를 쓸 수 없습니다.`
    }
  }
  if (texts.agreeLabel.includes('(필수)')) return "결제 동의 문구에는 '(필수)'를 넣지 마세요. 결제 화면이 붙입니다."
  if (!texts.checkoutItems.refund.includes(POINT_CHARGE_REFUND_DAYS_PLACEHOLDER)) {
    return `${POINT_CHARGE_CHECKOUT_ITEM_LABELS.refund}에는 환불 기간 자리 ${POINT_CHARGE_REFUND_DAYS_PLACEHOLDER}을(를) 넣어 주세요.`
  }
  if (/\d\s*일/.test(texts.checkoutItems.refund)) {
    return `${POINT_CHARGE_CHECKOUT_ITEM_LABELS.refund}에는 기간을 숫자로 적지 말고 ${POINT_CHARGE_REFUND_DAYS_PLACEHOLDER}을(를) 써 주세요.`
  }
  return null
}
