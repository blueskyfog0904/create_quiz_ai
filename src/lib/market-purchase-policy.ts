import type { Json } from '@/types/supabase'

// 자료 구매 고지·환불 기간(계획 docs/plan-bundle7-purchase-notice.md). 값은 DB(system_settings)에만 둔다.
// 지문(noticeSha256)은 서버만 계산한다(market-purchase-policy-server.ts) — DB 함수 record_purchase_notice_ack 와 같은 규칙.
export const MARKET_PURCHASE_POLICY_SETTING_KEY = 'market_purchase_policy'
export const MARKET_REFUND_DAYS_PLACEHOLDER = '{자료환불기간}'
export const MARKET_REFUND_DAYS_MAX = 3650

export const MARKET_PURCHASE_POLICY_TEXT_KEYS = [
  'checkboxLabel',
  'confirmNotice',
  'usageScopeNotice',
  'downloadPeriodNotice',
  'detailRefundNotice',
  'refundExpiredReason',
  'purchaseCompleteNotice',
] as const

export type MarketPurchasePolicyTextKey = (typeof MARKET_PURCHASE_POLICY_TEXT_KEYS)[number]
export type MarketPurchasePolicyTexts = Record<MarketPurchasePolicyTextKey, string>

export interface MarketPurchasePolicy extends MarketPurchasePolicyTexts {
  version: number
  refundDays: number
}

// 화면에 내려 주는 값: 문구는 모두 채운 문장, 지문은 서버가 계산한 값.
export interface MarketPurchasePolicyView extends MarketPurchasePolicyTexts {
  refundDays: number
  noticeSha256: string
}

// 409 PURCHASE_NOTICE_CHANGED 의 details 와 같은 모양(구매 확인창이 쓰는 부분).
export interface MarketPurchaseNotice {
  checkboxLabel: string
  confirmNotice: string
  noticeSha256: string
  refundDays: number
}

export const MARKET_PURCHASE_POLICY_TEXT_LIMITS: Record<MarketPurchasePolicyTextKey, number> = {
  checkboxLabel: 300,
  confirmNotice: 1000,
  usageScopeNotice: 500,
  downloadPeriodNotice: 500,
  detailRefundNotice: 1000,
  refundExpiredReason: 200,
  purchaseCompleteNotice: 300,
}

// 환불 기간을 문장에 넣어야 하는 문구(기간을 숫자로 적지 못하게 한다).
export const MARKET_PURCHASE_POLICY_PLACEHOLDER_REQUIRED: readonly MarketPurchasePolicyTextKey[] = [
  'checkboxLabel',
  'detailRefundNotice',
  'refundExpiredReason',
]

export const MARKET_PURCHASE_POLICY_TEXT_LABELS: Record<MarketPurchasePolicyTextKey, string> = {
  checkboxLabel: '구매 확인 체크 문구',
  confirmNotice: '구매 확인창 고지',
  usageScopeNotice: '이용 범위',
  downloadPeriodNotice: '이용 기간·다운로드',
  detailRefundNotice: '상품 상세 환불 안내',
  refundExpiredReason: '환불 기간 지남 안내',
  purchaseCompleteNotice: '구매 뒤 다운로드 안내',
}

export function isPositiveRefundDays(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MARKET_REFUND_DAYS_MAX
}

// DB 값 해석. 하나라도 형식이 틀리면 null(구매는 막고 "잠시 후 다시 시도"). 문구는 고치지 않는다(지문이 DB 와 같아야 함).
export function parseMarketPurchasePolicy(input: Json | null | undefined): MarketPurchasePolicy | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (!isPositiveRefundDays(value.refundDays)) return null
  const texts = {} as MarketPurchasePolicyTexts
  for (const key of MARKET_PURCHASE_POLICY_TEXT_KEYS) {
    const text = value[key]
    if (typeof text !== 'string' || text.trim() === '') return null
    texts[key] = text
  }
  return {
    version: typeof value.version === 'number' ? value.version : 1,
    refundDays: value.refundDays,
    ...texts,
  }
}

// {자료환불기간} 을 모두 바꾼다(DB 함수의 replace 와 같은 결과).
export function fillMarketRefundDays(text: string, refundDays: number): string {
  return text.split(MARKET_REFUND_DAYS_PLACEHOLDER).join(String(refundDays))
}

export function fillMarketPurchasePolicyTexts(policy: MarketPurchasePolicy): MarketPurchasePolicyTexts {
  const filled = {} as MarketPurchasePolicyTexts
  for (const key of MARKET_PURCHASE_POLICY_TEXT_KEYS) {
    filled[key] = fillMarketRefundDays(policy[key], policy.refundDays)
  }
  return filled
}

// 지문 대상 문장(채운 체크 문구 + 줄바꿈 + 채운 고지 본문).
export function buildMarketPurchaseNoticeText(checkboxLabel: string, confirmNotice: string): string {
  return `${checkboxLabel}\n${confirmNotice}`
}

// 저장 전 정리: 줄바꿈 CRLF→LF, 앞뒤 공백 제거.
export function normalizeMarketPurchasePolicyText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim()
}

// 관리자 저장 검사. 문제가 없으면 null.
export function validateMarketPurchasePolicyTexts(texts: MarketPurchasePolicyTexts): string | null {
  for (const key of MARKET_PURCHASE_POLICY_TEXT_KEYS) {
    const label = MARKET_PURCHASE_POLICY_TEXT_LABELS[key]
    const text = texts[key]
    if (!text) return `${label}을(를) 입력해 주세요.`
    if (text.length > MARKET_PURCHASE_POLICY_TEXT_LIMITS[key]) {
      return `${label}은(는) ${MARKET_PURCHASE_POLICY_TEXT_LIMITS[key]}자 이하로 입력해 주세요.`
    }
    if (/[{}]/.test(text.split(MARKET_REFUND_DAYS_PLACEHOLDER).join(''))) {
      return `${label}에는 ${MARKET_REFUND_DAYS_PLACEHOLDER} 외의 중괄호를 쓸 수 없습니다.`
    }
  }
  for (const key of MARKET_PURCHASE_POLICY_PLACEHOLDER_REQUIRED) {
    const label = MARKET_PURCHASE_POLICY_TEXT_LABELS[key]
    if (!texts[key].includes(MARKET_REFUND_DAYS_PLACEHOLDER)) {
      return `${label}에는 환불 기간 자리 ${MARKET_REFUND_DAYS_PLACEHOLDER}을(를) 넣어 주세요.`
    }
    if (/\d\s*일/.test(texts[key])) {
      return `${label}에는 기간을 숫자로 적지 말고 ${MARKET_REFUND_DAYS_PLACEHOLDER}을(를) 써 주세요.`
    }
  }
  return null
}

// 409 details·장바구니 응답 등 바깥에서 받은 고지 값 검사(형식이 틀리면 null → 확인창 닫고 새로고침).
export function parseMarketPurchaseNotice(input: unknown): MarketPurchaseNotice | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  if (typeof value.checkboxLabel !== 'string' || value.checkboxLabel.trim() === '') return null
  if (typeof value.confirmNotice !== 'string' || value.confirmNotice.trim() === '') return null
  if (typeof value.noticeSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.noticeSha256)) return null
  if (!isPositiveRefundDays(value.refundDays)) return null
  return {
    checkboxLabel: value.checkboxLabel,
    confirmNotice: value.confirmNotice,
    noticeSha256: value.noticeSha256,
    refundDays: value.refundDays,
  }
}
