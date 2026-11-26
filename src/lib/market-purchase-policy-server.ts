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
import {
  areCheckoutConsentLinksVisible,
  parseCheckoutConsentBundle,
  parseMarketCartTexts,
  readCheckoutConsentFormat,
  type CheckoutConsentBundle,
  type CheckoutConsentFormat,
  type MarketCartTexts,
} from '@/lib/checkout-consent'
import {
  buildCheckoutConsentBundle,
  buildCheckoutConsentBundleIgnoringLinks,
  buildMarketCartTexts,
  readRawSiteFooterValue,
  recordCheckoutConsentUnavailableAlert,
} from '@/lib/checkout-consent-server'
import { isCheckoutConsentPreview } from '@/lib/checkout-consent-preview'

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
  // 8번: 키가 늘어(partialRefundConfirmNotice) 옛 캐시를 쓰지 않게 버전을 붙인다. 11번: 2판 키·판이 늘어 v3.
  [`${MARKET_PURCHASE_POLICY_SETTING_KEY}:v3`],
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

// 11번 4-4: 결제 화면용 읽기(캐시 없음). 1판 해석 실패만 throw 하고, 2판 묶음·장바구니 문구는 따로 성공·실패(실패면 null).
// consentFormat 은 화면에 그릴 판이다(개발 스위치가 켜지면 2). 판 값 자체가 틀리면 null(결제 닫힘).
export interface MarketPurchaseConsentRead {
  policy: MarketPurchasePolicy
  consentFormat: CheckoutConsentFormat | null
  // 판 1 이면 1판 고지, 판 2 면 null
  notice: MarketPurchaseNotice | null
  // 판 2 이고 검사(문구·링크 문서)를 지나면 2판 묶음, 그 밖은 null
  consent: CheckoutConsentBundle | null
  cartTexts: MarketCartTexts | null
  // 개발 스위치(10-1)가 켜져 있을 때만: 2판 키가 없거나 깨졌는지(띠에 보임)
  preview: { keysMissing: boolean } | null
}

export async function readMarketPurchaseConsentUncached(): Promise<MarketPurchaseConsentRead> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from('system_settings')
    .select('value').eq('key', MARKET_PURCHASE_POLICY_SETTING_KEY).maybeSingle()
  if (error) throw error
  const raw = data?.value ?? null
  const policy = parseMarketPurchasePolicy(raw)
  if (!policy) throw new Error('MARKET_PURCHASE_POLICY_INVALID')

  const preview = isCheckoutConsentPreview()
  const storedFormat = readCheckoutConsentFormat(raw)
  const consentFormat = preview ? 2 : storedFormat
  const cartTexts = buildMarketCartTexts(raw)
  let consent: CheckoutConsentBundle | null = null
  if (consentFormat === 2) {
    try {
      consent = buildCheckoutConsentBundle('market', raw, policy.refundDays, await readRawSiteFooterValue())
    } catch (footerError) {
      console.error('약관 문서 원본 조회에 실패했습니다.', footerError)
      consent = null
    }
    // 경보는 DB 에 저장된 판이 2 일 때만(스위치가 판을 바꾼 값에서는 남기지 않는다).
    if (!consent && !preview && storedFormat === 2) {
      await recordCheckoutConsentUnavailableAlert('market', { screen: 'cart' })
    }
  }
  // 판 값 자체가 틀리면(글자 "2"·3·null 등) 결제가 닫히므로 경보를 남긴다(스위치가 켜진 값에서는 남기지 않음).
  if (!preview && storedFormat === null) {
    await recordCheckoutConsentUnavailableAlert('market', { screen: 'cart', reason: 'consent_format_invalid' })
  }
  return {
    policy,
    consentFormat,
    notice: consentFormat === 1 ? toMarketPurchaseNotice(toMarketPurchasePolicyView(policy)) : null,
    consent,
    cartTexts,
    preview: preview ? { keysMissing: consent === null } : null,
  }
}

export type RecordPurchaseNoticeAckResult =
  | { status: 'ok' }
  | { status: 'changed'; notice: MarketPurchaseNotice | null; consent: CheckoutConsentBundle | null; cartTexts: MarketCartTexts | null }
  | { status: 'unavailable' }
  | { status: 'invalid' }

// 구매 고지 동의 기록(장바구니 결제 API 가 결제 RPC 앞에서 부른다). 실패면 결제하지 않는다(fail closed).
// 11번: 장바구니 문구 지문을 함께 넘기고, 응답에 consentFormat 키가 없으면(11번 전 함수) 닫는다.
export async function recordPurchaseNoticeAck(input: {
  userId: string
  idempotencyKey: string
  noticeSha256: string
  cartTextsSha256: string
}): Promise<RecordPurchaseNoticeAckResult> {
  // 10-1 개발 스위치: RPC 를 부르기 전에 닫는다(미리보기 화면에서 몇 번을 눌러도 기록·차감 없음).
  if (isCheckoutConsentPreview()) return { status: 'unavailable' }
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('record_purchase_notice_ack', {
    p_user_id: input.userId,
    p_idempotency_key: input.idempotencyKey,
    p_notice_sha256: input.noticeSha256,
    p_cart_texts_sha256: input.cartTextsSha256,
  })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    if (error) console.error('구매 고지 동의 기록에 실패했습니다.', error)
    return { status: 'unavailable' }
  }
  const result = data as Record<string, unknown>
  // 5-2: 11번 함수는 모든 응답에 consentFormat 키를 둔다(값 null 이어도). 없으면 옛 함수 — 화면이 판을 오가지 않게 닫는다.
  if (!Object.hasOwn(result, 'consentFormat')) return { status: 'unavailable' }
  if (result.ok === true) return { status: 'ok' }
  switch (result.code) {
    case 'NOTICE_CHANGED':
    case 'NOTICE_KEY_CONFLICT':
      return {
        status: 'changed',
        notice: parseMarketPurchaseNotice(result.details),
        consent: parseCheckoutConsentBundle(result.details),
        cartTexts: parseMarketCartTexts(result.cartTexts),
      }
    case 'NOTICE_INPUT_INVALID':
      return { status: 'invalid' }
    default:
      // 판 2 에서 DB 만 닫은 경우(정책 문서 사본 없음처럼 화면 쪽 검사가 보지 않는 이유)도 경보를 남긴다(최선 노력).
      if (result.code === 'NOTICE_POLICY_UNAVAILABLE' && result.consentFormat === 2) {
        await recordCheckoutConsentUnavailableAlert('market', { screen: 'record' })
      }
      return { status: 'unavailable' }
  }
}

export interface PurchaseNoticeFailure {
  status: number
  code: string
  message: string
  details?: Record<string, unknown>
  // 11번 5-2: 409 의 최상위 장바구니 문구(새 해석기로 검사한 값만)
  cartTexts?: MarketCartTexts | null
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
  cartTextsSha256: string
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
        // 새 해석기를 지난 고지만 넘긴다: 1판이면 1판 고지(+ consentFormat 1), 2판이면 2판 묶음.
        details: result.consent
          ? { ...result.consent }
          : result.notice ? { ...result.notice, consentFormat: 1 } : undefined,
        cartTexts: result.cartTexts,
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

// 11번 9절: 관리자 화면용 읽기(캐시 없음). 판·2판 키·장바구니 문구 원본과, 저장된 값으로 서버가 만든 지문(단계 6 대조용)을 함께 준다.
// 읽지 못하면 null(화면은 저장을 막는다). 개발 스위치는 보지 않는다(관리자 화면은 DB 에 저장된 판을 그대로 보인다).
export interface MarketPurchasePolicyAdminData {
  policy: MarketPurchasePolicy
  raw: Record<string, Json>
  storedFormat: CheckoutConsentFormat | null
  linksVisible: boolean
  legacyNotice: MarketPurchaseNotice
  // 저장된 값의 2판 묶음(링크 문서 검사 포함 — 결제 때와 같은 값). 키가 없거나 깨졌거나 링크가 닫히면 null.
  storedConsent: CheckoutConsentBundle | null
  // 링크 검사 없이 문구만으로 만든 묶음(링크가 닫혀도 문구 지문은 보여 준다)
  storedConsentIgnoringLinks: CheckoutConsentBundle | null
  storedCartTexts: MarketCartTexts | null
}

export async function readMarketPurchasePolicyAdminUncached(): Promise<MarketPurchasePolicyAdminData | null> {
  try {
    const { data, error } = await createAdminClient().from('system_settings')
      .select('value').eq('key', MARKET_PURCHASE_POLICY_SETTING_KEY).maybeSingle()
    if (error) throw error
    const raw = data?.value
    const policy = parseMarketPurchasePolicy(raw ?? null)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !policy) return null
    let rawFooter: unknown = null
    try {
      rawFooter = await readRawSiteFooterValue()
    } catch (footerError) {
      console.error('약관 문서 원본 조회에 실패했습니다.', footerError)
    }
    return {
      policy,
      raw: raw as Record<string, Json>,
      storedFormat: readCheckoutConsentFormat(raw),
      linksVisible: areCheckoutConsentLinksVisible(rawFooter),
      legacyNotice: toMarketPurchaseNotice(toMarketPurchasePolicyView(policy)),
      storedConsent: buildCheckoutConsentBundle('market', raw, policy.refundDays, rawFooter),
      storedConsentIgnoringLinks: buildCheckoutConsentBundleIgnoringLinks('market', raw, policy.refundDays),
      storedCartTexts: buildMarketCartTexts(raw),
    }
  } catch (error) {
    console.error('구매 고지 설정 조회에 실패했습니다.', error)
    return null
  }
}

export interface MarketPurchasePolicySaveInput {
  texts: MarketPurchasePolicyTexts
  // 2판 키(제목·요약 줄·항목). null 이면 건드리지 않는다. consentFormat 은 받지 않는다(판 바꾸기는 스크립트로만).
  consentKeys: { consentTitle: string; consentSummary: Record<string, string>; consentItems: unknown[] } | null
  // 장바구니 결제 칸 문구 2개. null 이면 건드리지 않는다.
  cartTexts: { cartCheckoutNotice: string; partialOwnedConfirmLabel: string } | null
  // 폼을 연 때의 편집 번호(낙관적 잠금)
  expectedVersion: number
}

// 관리자 저장: 읽은 원본 jsonb 위에 문구 키만 덮고 version+1(11번: 자료도 낙관적 잠금). refundDays·consentFormat 은 DB 값 그대로.
// 폼을 연 뒤 다른 곳에서 저장했으면(version 또는 refundDays 가 다르면) 저장하지 않는다. 검사는 부르는 쪽에서 먼저 한다.
export async function saveMarketPurchasePolicyTexts(input: MarketPurchasePolicySaveInput): Promise<{
  before: Record<string, Json>
  after: Record<string, Json>
  beforePolicy: MarketPurchasePolicy
  afterPolicy: MarketPurchasePolicy
}> {
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
  const before = raw as Record<string, Json>
  const storedVersion = before.version
  if (current.version !== input.expectedVersion) {
    throw new Error('다른 곳에서 구매 고지 문구가 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.')
  }
  const nextVersion = current.version + 1
  const after: Record<string, Json> = {
    ...before,
    ...input.texts,
    ...(input.consentKeys ? {
      consentTitle: input.consentKeys.consentTitle,
      consentSummary: input.consentKeys.consentSummary,
      consentItems: input.consentKeys.consentItems as Json[],
    } : {}),
    ...(input.cartTexts ? {
      cartCheckoutNotice: input.cartTexts.cartCheckoutNotice,
      partialOwnedConfirmLabel: input.cartTexts.partialOwnedConfirmLabel,
    } : {}),
    version: nextVersion,
  }
  // 판은 입력으로 받지 않는다: 저장 전 원본 값 그대로(없으면 없음).
  if (Object.hasOwn(before, 'consentFormat')) after.consentFormat = before.consentFormat
  else delete after.consentFormat
  let query = supabase.from('system_settings')
    .update({ value: after as unknown as Json, updated_at: new Date().toISOString() })
    .eq('key', MARKET_PURCHASE_POLICY_SETTING_KEY)
    .eq('value->>refundDays', String(current.refundDays))
  query = typeof storedVersion === 'number' ? query.eq('value->>version', String(storedVersion)) : query.is('value->version', null)
  const { data, error } = await query.select('key')
  if (error) throw new Error('구매 고지 저장에 실패했습니다.')
  if (!data || data.length !== 1) throw new Error('다른 곳에서 구매 고지 문구가 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.')
  revalidateTag(MARKET_PURCHASE_POLICY_SETTING_KEY, { expire: 0 })
  return { before, after, beforePolicy: current, afterPolicy: { ...current, ...input.texts, version: nextVersion } }
}
