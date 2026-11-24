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

// 지문 = sha256(채운 제목 LF 항목 5개 LF 미성년자 안내 LF 동의 문구). DB 함수 record_point_charge_checkout_ack 와 같은 규칙.
export function computePointChargeNoticeSha256(policy: PointChargePolicy): string {
  return createHash('sha256').update(buildPointChargeNoticeText(policy), 'utf8').digest('hex')
}

export function toPointChargeCheckoutNotice(policy: PointChargePolicy): PointChargeCheckoutNotice {
  return { ...fillPointChargeCheckoutNotice(policy), noticeSha256: computePointChargeNoticeSha256(policy) }
}

async function readPointChargePolicyFromDb(): Promise<PointChargePolicy> {
  const { data, error } = await createAdminClient().from('system_settings')
    .select('value').eq('key', POINT_CHARGE_POLICY_SETTING_KEY).maybeSingle()
  if (error) throw error
  const policy = parsePointChargePolicy(data?.value ?? null)
  if (!policy) throw new Error('POINT_CHARGE_POLICY_INVALID')
  return policy
}

// 캐시 함수 안에서는 실패를 throw 해서 null 이 캐시되지 않게 한다.
const readCachedPointChargePolicy = unstable_cache(
  readPointChargePolicyFromDb,
  [`${POINT_CHARGE_POLICY_SETTING_KEY}:v1`],
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

// 결제 화면용(캐시 없음): 읽지 못하면 경보를 남기고 null — 결제 버튼을 막는다.
export async function getPointChargeCheckoutNotice(userId: string | null): Promise<PointChargeCheckoutNotice | null> {
  const policy = await readPointChargePolicyUncached()
  if (policy) return toPointChargeCheckoutNotice(policy)
  await recordPointChargePolicyUnavailableAlert({ user_id: userId, screen: 'checkout', dedupe_key: 'point_charge_policy:checkout' })
  return null
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

export type RecordCheckoutAckResult =
  | { status: 'ok' }
  | { status: 'notice_changed'; notice: PointChargeCheckoutNotice | null }
  | { status: 'plan_changed'; notice: PointChargeCheckoutNotice | null; plan: { price: number; credits: number } | null }
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
  if (result.ok === true) return { status: 'ok' }
  const notice = parsePointChargeCheckoutNotice(result.details)
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
      return { status: 'unavailable' }
  }
}

// 관리자 저장: 원본 jsonb 위에 문구 키만 덮고 version+1. refundDays 는 DB 값 그대로(일수 변경은 약관과 함께 스크립트로).
// 폼을 연 뒤 다른 곳에서 저장했으면(version 또는 refundDays 가 다르면) 저장하지 않는다. 검사는 부르는 쪽(validatePointChargePolicyTexts)에서 먼저 한다.
export async function savePointChargePolicyTexts(texts: PointChargePolicyTexts, expectedVersion: number): Promise<{
  before: PointChargePolicy
  after: PointChargePolicy
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
  const nextValue = { ...(raw as Record<string, Json>), ...texts, version: nextVersion }
  const { data, error } = await supabase.from('system_settings')
    .update({ value: nextValue as unknown as Json, updated_at: new Date().toISOString() })
    .eq('key', POINT_CHARGE_POLICY_SETTING_KEY)
    .eq('value->>version', String(expectedVersion))
    .eq('value->>refundDays', String(current.refundDays))
    .select('key')
  if (error) throw new Error('충전 정책 문구 저장에 실패했습니다.')
  if (!data || data.length !== 1) throw new Error('다른 곳에서 충전 정책 문구가 바뀌었습니다. 새로고침한 뒤 다시 저장해 주세요.')
  revalidateTag(POINT_CHARGE_POLICY_SETTING_KEY, { expire: 0 })
  return { before: current, after: { ...current, ...texts, version: nextVersion } }
}
