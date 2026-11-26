import 'server-only'

import { createHash } from 'node:crypto'
import { revalidateTag, unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/bypass'
import {
  buildPointChargeNoticeText,
  fillPointChargeCheckoutNotice,
  parsePointChargeCheckoutNotice,
  parsePointChargePolicy,
  POINT_CHARGE_POLICY_SETTING_KEY,
  type PointChargeCheckoutNotice,
  type PointChargePolicy,
  type PointChargePolicyTexts,
} from '@/lib/point-charge-policy'
import type { Json } from '@/types/supabase'
import {
  areCheckoutConsentLinksVisible,
  parseCheckoutConsentBundle,
  readCheckoutConsentFormat,
  type CheckoutConsentBundle,
  type CheckoutConsentFormat,
} from '@/lib/checkout-consent'
import {
  buildCheckoutConsentBundle,
  buildCheckoutConsentBundleIgnoringLinks,
  readRawSiteFooterValue,
  recordCheckoutConsentUnavailableAlert,
} from '@/lib/checkout-consent-server'
import { isCheckoutConsentPreview } from '@/lib/checkout-consent-preview'

// 지문 = sha256(채운 제목 LF 항목 5개 LF 미성년자 안내 LF 동의 문구). DB 함수 record_point_charge_checkout_ack 와 같은 규칙.
export function computePointChargeNoticeSha256(policy: PointChargePolicy): string {
  return createHash('sha256').update(buildPointChargeNoticeText(policy), 'utf8').digest('hex')
}

export function toPointChargeCheckoutNotice(policy: PointChargePolicy): PointChargeCheckoutNotice {
  return { ...fillPointChargeCheckoutNotice(policy), noticeSha256: computePointChargeNoticeSha256(policy) }
}

async function readPointChargePolicyRawFromDb(): Promise<{ policy: PointChargePolicy; raw: Json }> {
  const { data, error } = await createAdminClient().from('system_settings')
    .select('value').eq('key', POINT_CHARGE_POLICY_SETTING_KEY).maybeSingle()
  if (error) throw error
  const raw = data?.value ?? null
  const policy = parsePointChargePolicy(raw)
  if (!policy || raw === null) throw new Error('POINT_CHARGE_POLICY_INVALID')
  return { policy, raw }
}

async function readPointChargePolicyFromDb(): Promise<PointChargePolicy> {
  return (await readPointChargePolicyRawFromDb()).policy
}

// 캐시 함수 안에서는 실패를 throw 해서 null 이 캐시되지 않게 한다.
const readCachedPointChargePolicy = unstable_cache(
  readPointChargePolicyFromDb,
  // 11번: 2판 키·판이 늘어 v2.
  [`${POINT_CHARGE_POLICY_SETTING_KEY}:v2`],
  { revalidate: 60, tags: [POINT_CHARGE_POLICY_SETTING_KEY] }
)

// 화면용(충전·크레딧 화면): 읽지 못하면 null.
export async function getPointChargePolicyCached(): Promise<PointChargePolicy | null> {
  try {
    return await readCachedPointChargePolicy()
  } catch (error) {
    console.error('충전 정책 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 돈이 움직이는 경로(결제 화면·결제 요청)와 관리자 화면용: 캐시 없이 매번 읽는다. 읽지 못하면 null.
export async function readPointChargePolicyUncached(): Promise<PointChargePolicy | null> {
  try {
    return await readPointChargePolicyFromDb()
  } catch (error) {
    console.error('충전 정책 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 11번 4-4: 결제 화면·409 대체 경로용 읽기(캐시 없음). 1판 해석 실패만 throw, 2판 묶음은 따로 성공·실패(실패면 null).
// consentFormat 은 화면에 그릴 판이다(개발 스위치가 켜지면 2). 판 값 자체가 틀리면 null(결제 닫힘).
export interface PointChargeConsentRead {
  policy: PointChargePolicy
  consentFormat: CheckoutConsentFormat | null
  notice: PointChargeCheckoutNotice | null
  consent: CheckoutConsentBundle | null
  preview: { keysMissing: boolean } | null
}

export async function readPointChargeConsentUncached(screen: string): Promise<PointChargeConsentRead> {
  const { policy, raw } = await readPointChargePolicyRawFromDb()
  const preview = isCheckoutConsentPreview()
  const storedFormat = readCheckoutConsentFormat(raw)
  const consentFormat = preview ? 2 : storedFormat
  let consent: CheckoutConsentBundle | null = null
  if (consentFormat === 2) {
    try {
      consent = buildCheckoutConsentBundle('point_charge', raw, policy.refundDays, await readRawSiteFooterValue())
    } catch (footerError) {
      console.error('약관 문서 원본 조회에 실패했습니다.', footerError)
      consent = null
    }
    // 경보는 DB 에 저장된 판이 2 일 때만(스위치가 판을 바꾼 값에서는 남기지 않는다, 10-1).
    if (!consent && !preview && storedFormat === 2) {
      await recordCheckoutConsentUnavailableAlert('point_charge', { screen })
    }
  }
  // 판 값 자체가 틀리면(글자 "2"·3·null 등) 결제가 닫히므로 경보를 남긴다(스위치가 켜진 값에서는 남기지 않음).
  if (!preview && storedFormat === null) {
    await recordCheckoutConsentUnavailableAlert('point_charge', { screen, reason: 'consent_format_invalid' })
  }
  return {
    policy,
    consentFormat,
    notice: consentFormat === 1 ? toPointChargeCheckoutNotice(policy) : null,
    consent,
    preview: preview ? { keysMissing: consent === null } : null,
  }
}

// 결제 화면용(캐시 없음): 1판 고지(checkoutNotice) 또는 2판 묶음(checkoutConsent) 중 하나만 값이 있다(5-2).
// 1판 정책을 읽지 못하면 지금처럼 경보를 남기고 둘 다 null — 결제 버튼을 막는다(판·스위치와 관계없음).
export interface PointChargeCheckoutScreenNotice {
  checkoutNotice: PointChargeCheckoutNotice | null
  checkoutConsent: CheckoutConsentBundle | null
  preview: { keysMissing: boolean } | null
}

export async function getPointChargeCheckoutNotice(userId: string | null): Promise<PointChargeCheckoutScreenNotice> {
  try {
    const read = await readPointChargeConsentUncached('checkout')
    return { checkoutNotice: read.notice, checkoutConsent: read.consent, preview: read.preview }
  } catch (error) {
    console.error('충전 정책 설정 조회에 실패했습니다.', error)
    await recordPointChargePolicyUnavailableAlert({ user_id: userId, screen: 'checkout', dedupe_key: 'point_charge_policy:checkout' })
    return { checkoutNotice: null, checkoutConsent: null, preview: isCheckoutConsentPreview() ? { keysMissing: true } : null }
  }
}

// 409 대체 경로(기록 함수가 고지를 돌려주지 않은 때): 새 해석기로 만든 지금 판의 고지(1판 고지 또는 2판 묶음). 못 만들면 null.
export async function readPointChargeChangedNotice(): Promise<PointChargeCheckoutNotice | CheckoutConsentBundle | null> {
  try {
    const read = await readPointChargeConsentUncached('checkout_changed')
    return read.consent ?? read.notice
  } catch (error) {
    console.error('충전 정책 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 판정이 설정을 못 읽고 동의 일수(없으면 법정 최소)로 대체했거나(policy_fallback) 결제 화면이 문구를 못 읽은 때(최선 노력, 실패해도 응답을 바꾸지 않음).
// 주문별로 쌓이도록 details 에 payment_order_id 를 넣는다(런북 4: 이 경보가 있는 기간의 거절은 다시 판단).
export async function recordPointChargePolicyUnavailableAlert(details: Record<string, Json | undefined>): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc('record_payment_alert', {
      p_code: 'POINT_CHARGE_POLICY_UNAVAILABLE',
      p_severity: 'critical',
      p_message: '충전 정책 설정(point_charge_policy)을 읽지 못했습니다. 환불 판정은 동의 일수(없으면 법정 최소 일수)로 대체되었고 결제는 막혔습니다. 설정을 확인하세요(런북 4).',
      p_details: { ...details, attempted_at: new Date().toISOString() } as Json,
    })
    if (error) console.error('[point-charge-policy] 경보 기록 실패', { code: error.code })
  } catch {
    // 경보 기록 실패는 화면 응답과 무관하다.
  }
}

// 11번: notice 는 새 해석기를 지난 값만(1판 고지 또는 2판 묶음). 둘 다 아니면 null.
export type PointChargeChangedNotice = PointChargeCheckoutNotice | CheckoutConsentBundle

export type RecordCheckoutAckResult =
  | { status: 'ok' }
  | { status: 'notice_changed'; notice: PointChargeChangedNotice | null }
  | { status: 'plan_changed'; notice: PointChargeChangedNotice | null; plan: { price: number; credits: number } | null }
  | { status: 'plan_unavailable' }
  | { status: 'invalid' }
  | { status: 'member_withdrawn' }
  | { status: 'unavailable' }

// 결제 직전 동의 기록(주문 준비 RPC 앞). 실패면 결제하지 않는다(fail closed).
export async function recordPointChargeCheckoutAck(input: {
  userId: string
  checkoutAttemptId: string
  planId: string
  expectedAmount: number
  expectedCredits: number
  noticeSha256: string
}): Promise<RecordCheckoutAckResult> {
  // 10-1 개발 스위치: RPC 를 부르기 전에 닫는다(route 는 503, 기록·주문 준비·페이앱 요청 없음).
  if (isCheckoutConsentPreview()) return { status: 'unavailable' }
  const { data, error } = await createAdminClient().rpc('record_point_charge_checkout_ack', {
    p_user_id: input.userId,
    p_checkout_attempt_id: input.checkoutAttemptId,
    p_plan_id: input.planId,
    p_expected_amount: input.expectedAmount,
    p_expected_credits: input.expectedCredits,
    p_notice_sha256: input.noticeSha256,
  })
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
    if (error) console.error('결제 전 확인 동의 기록에 실패했습니다.', error)
    return { status: 'unavailable' }
  }
  const result = data as Record<string, unknown>
  // 5-2: 11번 함수는 모든 응답에 consentFormat 키를 둔다(값 null 이어도). 없으면 옛 함수 — 닫는다(탈퇴 거절도 11번 함수는 키를 둔다).
  if (!Object.hasOwn(result, 'consentFormat')) return { status: 'unavailable' }
  if (result.ok === true) return { status: 'ok' }
  const notice: PointChargeChangedNotice | null = parseCheckoutConsentBundle(result.details) ?? parsePointChargeCheckoutNotice(result.details)
  switch (result.code) {
    case 'NOTICE_CHANGED':
    case 'NOTICE_KEY_CONFLICT':
      return { status: 'notice_changed', notice }
    case 'PLAN_CHANGED': {
      const plan = (result.details as Record<string, unknown> | null)?.plan as Record<string, unknown> | null | undefined
      return {
        status: 'plan_changed',
        notice,
        plan: plan && typeof plan.price === 'number' && typeof plan.credits === 'number'
          ? { price: plan.price, credits: plan.credits } : null,
      }
    }
    case 'PLAN_UNAVAILABLE':
      return { status: 'plan_unavailable' }
    case 'NOTICE_INPUT_INVALID':
      return { status: 'invalid' }
    // 10번: 탈퇴 회원(남은 JWT)은 오류 대신 code 로 거절된다.
    case 'MEMBER_WITHDRAWN':
      return { status: 'member_withdrawn' }
    default:
      // 판 2 에서 DB 만 닫은 경우(정책 문서 사본 없음처럼 화면 쪽 검사가 보지 않는 이유)도 경보를 남긴다(최선 노력).
      if (result.code === 'NOTICE_POLICY_UNAVAILABLE' && result.consentFormat === 2) {
        await recordCheckoutConsentUnavailableAlert('point_charge', { screen: 'record' })
      }
      return { status: 'unavailable' }
  }
}

// 11번 9절: 관리자 화면용 읽기(캐시 없음). 판·2판 키 원본과 저장된 값으로 서버가 만든 2판 지문(단계 6 대조용)을 함께 준다.
// 읽지 못하면 null(화면은 저장을 막는다). 개발 스위치는 보지 않는다.
export interface PointChargePolicyAdminData {
  policy: PointChargePolicy
  raw: Record<string, Json>
  storedFormat: CheckoutConsentFormat | null
  linksVisible: boolean
  legacyNotice: PointChargeCheckoutNotice
  storedConsent: CheckoutConsentBundle | null
  storedConsentIgnoringLinks: CheckoutConsentBundle | null
}

export async function readPointChargePolicyAdminUncached(): Promise<PointChargePolicyAdminData | null> {
  try {
    const { policy, raw } = await readPointChargePolicyRawFromDb()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
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
      legacyNotice: toPointChargeCheckoutNotice(policy),
      storedConsent: buildCheckoutConsentBundle('point_charge', raw, policy.refundDays, rawFooter),
      storedConsentIgnoringLinks: buildCheckoutConsentBundleIgnoringLinks('point_charge', raw, policy.refundDays),
    }
  } catch (error) {
    console.error('충전 정책 설정 조회에 실패했습니다.', error)
    return null
  }
}

// 관리자 저장: 원본 jsonb 위에 문구 키만 덮고 version+1. refundDays 는 DB 값 그대로(일수 변경은 약관과 함께 스크립트로).
// 폼을 연 뒤 다른 곳에서 저장했으면(version 또는 refundDays 가 다르면) 저장하지 않는다. 검사는 부르는 쪽(validatePointChargePolicyTexts)에서 먼저 한다.
// 11번: 2판 키(consentKeys)도 같이 덮는다(null 이면 건드리지 않음). consentFormat 은 입력으로 받지 않는다(판 바꾸기는 스크립트로만).
export async function savePointChargePolicyTexts(texts: PointChargePolicyTexts, expectedVersion: number,
  consentKeys: { consentTitle: string; consentSummary: Record<string, string>; consentItems: unknown[] } | null = null): Promise<{
  before: PointChargePolicy
  after: PointChargePolicy
  beforeRaw: Record<string, Json>
  afterRaw: Record<string, Json>
}> {
  const supabase = createAdminClient()
  const { data: row, error: readError } = await supabase.from('system_settings')
    .select('value').eq('key', POINT_CHARGE_POLICY_SETTING_KEY).maybeSingle()
  if (readError) throw new Error('충전 정책 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
  const raw = row?.value
  const current = parsePointChargePolicy(raw ?? null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !current) {
    throw new Error('충전 정책 설정을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  if (current.version !== expectedVersion) {
    throw new Error('다른 곳에서 충전 정책 문구가 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.')
  }
  const nextVersion = current.version + 1
  const beforeRaw = raw as Record<string, Json>
  const nextValue: Record<string, Json> = {
    ...beforeRaw,
    ...(texts as unknown as Record<string, Json>),
    ...(consentKeys ? {
      consentTitle: consentKeys.consentTitle,
      consentSummary: consentKeys.consentSummary,
      consentItems: consentKeys.consentItems as Json[],
    } : {}),
    version: nextVersion,
  }
  // 판은 입력으로 받지 않는다: 저장 전 원본 값 그대로(없으면 없음).
  if (Object.hasOwn(beforeRaw, 'consentFormat')) nextValue.consentFormat = beforeRaw.consentFormat
  else delete nextValue.consentFormat
  const { data, error } = await supabase.from('system_settings')
    .update({ value: nextValue as unknown as Json, updated_at: new Date().toISOString() })
    .eq('key', POINT_CHARGE_POLICY_SETTING_KEY)
    .eq('value->>version', String(expectedVersion))
    .eq('value->>refundDays', String(current.refundDays))
    .select('key')
  if (error) throw new Error('충전 정책 문구 저장에 실패했습니다.')
  if (!data || data.length !== 1) throw new Error('다른 곳에서 충전 정책 문구가 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.')
  revalidateTag(POINT_CHARGE_POLICY_SETTING_KEY, { expire: 0 })
  return { before: current, after: { ...current, ...texts, version: nextVersion }, beforeRaw, afterRaw: nextValue }
}
