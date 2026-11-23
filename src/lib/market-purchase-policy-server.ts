import 'server-only'

import { createHash } from 'node:crypto'
import { revalidateTag, unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  buildMarketPurchaseNoticeText,
  fillMarketPurchasePolicyTexts,
  MARKET_PURCHASE_POLICY_SETTING_KEY,
  parseMarketPurchaseNotice,
  parseMarketPurchasePolicy,
  type MarketPurchaseNotice,
  type MarketPurchasePolicy,
  type MarketPurchasePolicyTexts,
  type MarketPurchasePolicyView,
} from '@/lib/market-purchase-policy'
import type { Json } from '@/types/supabase'

// 지문 = sha256(채운 체크 문구 + "\n" + 채운 고지 본문). DB 함수 record_purchase_notice_ack 와 같은 규칙.
export function computeMarketPurchaseNoticeSha256(checkboxLabel: string, confirmNotice: string): string {
  return createHash('sha256').update(buildMarketPurchaseNoticeText(checkboxLabel, confirmNotice), 'utf8').digest('hex')
}

export function toMarketPurchasePolicyView(policy: MarketPurchasePolicy): MarketPurchasePolicyView {
  const filled = fillMarketPurchasePolicyTexts(policy)
  return {
    ...filled,
    refundDays: policy.refundDays,
    noticeSha256: computeMarketPurchaseNoticeSha256(filled.checkboxLabel, filled.confirmNotice),
  }
}

export function toMarketPurchaseNotice(view: MarketPurchasePolicyView): MarketPurchaseNotice {
  return {
    checkboxLabel: view.checkboxLabel,
    confirmNotice: view.confirmNotice,
    noticeSha256: view.noticeSha256,
    refundDays: view.refundDays,
  }
}

async function readMarketPurchasePolicyFromDb(): Promise<MarketPurchasePolicy> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('system_settings')
    .select('value').eq('key', MARKET_PURCHASE_POLICY_SETTING_KEY).maybeSingle()
  if (error) throw error
  const policy = parseMarketPurchasePolicy(data?.value ?? null)
  if (!policy) throw new Error('MARKET_PURCHASE_POLICY_INVALID')
  return policy
}

// 캐시 함수 안에서는 실패를 throw 해서 null 이 캐시되지 않게 한다.
const readCachedMarketPurchasePolicy = unstable_cache(
  readMarketPurchasePolicyFromDb,
  // 8번: 키가 늘어(partialRefundConfirmNotice) 옛 캐시를 쓰지 않게 버전을 붙인다.
  [`${MARKET_PURCHASE_POLICY_SETTING_KEY}:v2`],
  { revalidate: 60, tags: [MARKET_PURCHASE_POLICY_SETTING_KEY] }
)

// 화면용(상품 상세·장바구니): 읽지 못하면 null — 상세 블록은 숨기고, 구매 버튼은 막는다.
export async function getMarketPurchasePolicyView(): Promise<MarketPurchasePolicyView | null> {
  try {
    return toMarketPurchasePolicyView(await readCachedMarketPurchasePolicy())
  } catch (error) {
    console.error('구매 고지 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 돈이 움직이는 경로(환불 신청·관리자 승인)와 관리자 화면용: 캐시 없이 매번 읽는다. 읽지 못하면 null.
export async function readMarketPurchasePolicyUncached(): Promise<MarketPurchasePolicy | null> {
  try {
    return await readMarketPurchasePolicyFromDb()
  } catch (error) {
    console.error('구매 고지 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 환불 판정에 쓰는 부분(refundExpiredReason 은 채우기 전 문구 — 판정 함수가 채운다).
export interface MarketRefundPolicy {
  refundDays: number
  refundExpiredReason: string
}

function toMarketRefundPolicy(policy: MarketPurchasePolicy): MarketRefundPolicy {
  return { refundDays: policy.refundDays, refundExpiredReason: policy.refundExpiredReason }
}

// 자료 보관함 목록용(요청당 한 번, 캐시 사용). 읽지 못하면 null — 목록·다운로드는 그대로, 환불 칸만 "확인할 수 없음".
export async function getMarketRefundPolicyCached(): Promise<MarketRefundPolicy | null> {
  try {
    return toMarketRefundPolicy(await readCachedMarketPurchasePolicy())
  } catch (error) {
    console.error('환불 기간 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 환불 신청·관리자 승인용(캐시 없음). 읽지 못하면 null — 부르는 쪽이 멈춘다.
export async function readMarketRefundPolicyUncached(): Promise<MarketRefundPolicy | null> {
  const policy = await readMarketPurchasePolicyUncached()
  return policy ? toMarketRefundPolicy(policy) : null
}

export type RecordPurchaseNoticeAckResult =
  | { status: 'ok' }
  | { status: 'changed'; notice: MarketPurchaseNotice | null }
  | { status: 'unavailable' }
  | { status: 'invalid' }

// 구매 고지 동의 기록(구매 API 2개가 결제 RPC 앞에서 부른다). 실패면 결제하지 않는다(fail closed).
export async function recordPurchaseNoticeAck(input: {
  userId: string
  idempotencyKey: string
  noticeSha256: string
}): Promise<RecordPurchaseNoticeAckResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('record_purchase_notice_ack', {
    p_user_id: input.userId,
    p_idempotency_key: input.idempotencyKey,
    p_notice_sha256: input.noticeSha256,
  })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    if (error) console.error('구매 고지 동의 기록에 실패했습니다.', error)
    return { status: 'unavailable' }
  }
  const result = data as Record<string, unknown>
  if (result.ok === true) return { status: 'ok' }
  switch (result.code) {
    case 'NOTICE_CHANGED':
    case 'NOTICE_KEY_CONFLICT':
      return { status: 'changed', notice: parseMarketPurchaseNotice(result.details) }
    case 'NOTICE_INPUT_INVALID':
      return { status: 'invalid' }
    default:
      return { status: 'unavailable' }
  }
}

export interface PurchaseNoticeFailure {
  status: number
  code: string
  message: string
  details?: Record<string, unknown>
}

// 구매 API 공통: 본문 검사 직후 체크 여부를, 판매 중지·itemId 검사 뒤(결제 RPC 바로 앞)에서 동의 기록을 확인한다.
export function checkPurchaseNoticeAcknowledged(acknowledged: boolean): PurchaseNoticeFailure | null {
  if (acknowledged) return null
  return {
    status: 400,
    code: 'PURCHASE_NOTICE_ACK_REQUIRED',
    message: '구매 전 환불 안내를 확인하고 체크해 주세요.',
  }
}

export async function enforcePurchaseNoticeAck(input: {
  userId: string
  idempotencyKey: string
  noticeSha256: string
}): Promise<PurchaseNoticeFailure | null> {
  const result = await recordPurchaseNoticeAck(input)
  switch (result.status) {
    case 'ok':
      return null
    case 'changed':
      return {
        status: 409,
        code: 'PURCHASE_NOTICE_CHANGED',
        message: '구매 안내 문구가 바뀌었습니다. 바뀐 내용을 확인한 뒤 다시 체크해 주세요.',
        details: result.notice ? { ...result.notice } : undefined,
      }
    case 'invalid':
      return { status: 400, code: 'INVALID_INPUT', message: '구매 요청이 올바르지 않습니다.' }
    default:
      return {
        status: 503,
        code: 'PURCHASE_NOTICE_UNAVAILABLE',
        message: '구매 안내를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      }
  }
}

// 관리자 저장: 문구만 바꾸고 refundDays·version 은 DB 값 그대로(기간 변경은 8번 묶음).
// 검사는 부르는 쪽(validateMarketPurchasePolicyTexts)에서 먼저 한다.
export async function saveMarketPurchasePolicyTexts(texts: MarketPurchasePolicyTexts): Promise<MarketPurchasePolicy> {
  const supabase = createAdminClient()
  // 8번: 읽은 원본 jsonb 위에 문구 키만 덮는다(모르는 키 보존). 그사이 기간 값이 바뀌었으면 저장하지 않는다.
  const { data: row, error: readError } = await supabase.from('system_settings')
    .select('value').eq('key', MARKET_PURCHASE_POLICY_SETTING_KEY).maybeSingle()
  if (readError) throw new Error('구매 고지 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
  const raw = row?.value
  const current = parseMarketPurchasePolicy(raw ?? null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !current) {
    throw new Error('구매 고지 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  const nextValue = { ...(raw as Record<string, Json>), ...texts }
  const { data, error } = await supabase.from('system_settings')
    .update({ value: nextValue as unknown as Json, updated_at: new Date().toISOString() })
    .eq('key', MARKET_PURCHASE_POLICY_SETTING_KEY)
    .eq('value->>refundDays', String(current.refundDays))
    .select('key')
  if (error) throw new Error('구매 고지 저장에 실패했습니다.')
  if (!data || data.length !== 1) throw new Error('그사이 구매 고지 설정이 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.')
  revalidateTag(MARKET_PURCHASE_POLICY_SETTING_KEY, { expire: 0 })
  return { ...current, ...texts }
}
