import { createAdminClient } from '@/lib/supabase/bypass'

// 직원(staff) 크레딧 수동 지급의 기본 한도(system_settings 'admin_credit_grant_limits', 20261118120000).
// 계정별 한도(권한 부여 화면)가 있으면 그 값을 쓰고, 없으면 이 기본 한도를 쓴다. 대표는 한도가 없다. 판정은 지급 함수(DB)가 한다.
// 바꾸는 길은 set_admin_credit_grant_limits(작업 기록을 같은 트랜잭션으로 남김)뿐이다 — 화면 세션으로는 이 행을 고칠 수 없다.

export interface AdminCreditGrantLimits {
  perGrant: number
  perDay: number
}

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0

function parseLimits(value: unknown): AdminCreditGrantLimits | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { per_grant: perGrant, per_day: perDay } = value as { per_grant?: unknown; per_day?: unknown }
  return isPositiveInteger(perGrant) && isPositiveInteger(perDay) ? { perGrant, perDay } : null
}

// 기본 한도. 행이 없거나 값이 올바르지 않거나 읽지 못하면 null(화면은 "설정 없음"으로 보이고, 직원 지급은 DB가 거부한다).
export async function getAdminCreditGrantLimits(): Promise<AdminCreditGrantLimits | null> {
  const { data, error } = await createAdminClient()
    .from('system_settings')
    .select('value')
    .eq('key', 'admin_credit_grant_limits')
    .maybeSingle()
  if (error) {
    console.error('[admin-credit-grant-limits] 기본 한도를 읽지 못했습니다.', { message: error.message })
    return null
  }
  return parseLimits(data?.value)
}

export class AdminCreditGrantLimitsError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

const FUNCTION_ERRORS: ReadonlyArray<readonly [string, number, string]> = [
  ['ADMIN_GRANT_LIMITS_INVALID', 400, '한도는 1 이상의 정수이고, 1회 한도는 하루 한도보다 클 수 없습니다.'],
  ['ADMIN_GRANT_LIMITS_ACTOR_NOT_ALLOWED', 403, '이 작업을 할 권한이 없습니다.'],
  ['ADMIN_GRANT_LIMITS_NOT_FOUND', 500, '기본 한도 설정이 없습니다. 개발 담당자에게 알려 주세요.'],
]

// 기본 한도를 바꾼다. 행위자 확인(대표, 또는 credits.limits.manage를 받은 직원)과 작업 기록은 함수가 한다.
export async function setAdminCreditGrantLimits({
  actorId,
  perGrant,
  perDay,
}: {
  actorId: string
  perGrant: number
  perDay: number
}): Promise<AdminCreditGrantLimits> {
  const rpcClient = createAdminClient() as unknown as {
    rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>
  }
  const { data, error } = await rpcClient.rpc('set_admin_credit_grant_limits', {
    p_actor_id: actorId,
    p_per_grant: perGrant,
    p_per_day: perDay,
  })
  if (error) {
    const known = FUNCTION_ERRORS.find(([code]) => error.message.includes(code))
    if (known) throw new AdminCreditGrantLimitsError(known[1], known[2])
    console.error('[admin-credit-grant-limits] 기본 한도 변경 실패', { message: error.message })
    throw new AdminCreditGrantLimitsError(500, '기본 한도를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  const saved = parseLimits((data as { after?: unknown } | null)?.after)
  if (!saved) {
    throw new AdminCreditGrantLimitsError(500, '기본 한도 저장 응답이 올바르지 않습니다. 새로고침해 확인해 주세요.')
  }
  return saved
}
