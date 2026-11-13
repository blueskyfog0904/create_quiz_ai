import {
  ADMIN_DISABLED_FEATURES_SETTING_KEY,
  isAdminFeatureDisabled,
  parseDisabledAdminFeatures,
  type AdminFeatureId,
  type DisabledAdminFeaturesState,
} from '@/lib/admin-features'
import { SITE_DISABLED_FEATURES_SETTING_KEY, type SiteFeatureId } from '@/lib/site-features'

// 꺼진 기능 묶음 목록을 DB에서 읽는다. 미들웨어(Edge)와 서버 양쪽에서 쓰므로 fetch만 쓴다.
// 관리자 묶음(admin_disabled_features)과 사용자 쪽 옛 기능 묶음(site_disabled_features)이 같은 방식을 쓴다.
// service role로 읽는다: system_settings 조회 정책이 로그인 사용자 전용이라, 요청자 세션으로 읽으면
// 비로그인 요청에서 오류가 아닌 빈 결과가 와서 "꺼진 묶음 없음"으로 잘못 판단한다.

const CACHE_TTL_MS = 60 * 1000
// 설정 읽기가 느려도 화면 전체가 기다리지 않게 한다(넘기면 읽기 실패로 취급).
const READ_TIMEOUT_MS = 3000

const cachedBySettingKey = new Map<string, { features: readonly string[]; expiresAt: number }>()

async function readDisabledFeatures(settingKey: string, now: number): Promise<DisabledAdminFeaturesState> {
  const cached = cachedBySettingKey.get(settingKey)
  if (cached && cached.expiresAt > now) {
    return { ok: true, features: cached.features }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    return { ok: false }
  }

  try {
    const response = await fetch(
      `${url}/rest/v1/system_settings?select=value&key=eq.${settingKey}`,
      {
        headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      }
    )
    if (!response.ok) {
      return { ok: false }
    }

    const rows = (await response.json()) as Array<{ value: unknown }>
    // 행이 없으면 꺼진 묶음이 없는 것이다(오류와 구분한다).
    const features = rows.length === 0 ? [] : parseDisabledAdminFeatures(rows[0].value)
    if (!features) {
      return { ok: false }
    }

    // 성공한 결과만 잠깐 기억한다. 오류는 기억하지 않는다.
    cachedBySettingKey.set(settingKey, { features, expiresAt: now + CACHE_TTL_MS })
    return { ok: true, features }
  } catch {
    return { ok: false }
  }
}

export async function getDisabledAdminFeatures(now = Date.now()): Promise<DisabledAdminFeaturesState> {
  return readDisabledFeatures(ADMIN_DISABLED_FEATURES_SETTING_KEY, now)
}

export async function getDisabledSiteFeatures(now = Date.now()): Promise<DisabledAdminFeaturesState> {
  return readDisabledFeatures(SITE_DISABLED_FEATURES_SETTING_KEY, now)
}

// 설정을 읽지 못하면 닫힌 것으로 본다(옛 기능은 닫혀 있는 쪽이 안전하다).
export function isSiteFeatureDisabled(feature: SiteFeatureId, state: DisabledAdminFeaturesState) {
  return state.ok ? state.features.includes(feature) : true
}

export class AdminFeatureDisabledError extends Error {
  constructor() {
    super('사용하지 않는 기능입니다.')
    this.name = 'AdminFeatureDisabledError'
  }
}

// 서버 액션용. 페이지를 막아도 액션은 직접 호출할 수 있으므로, 꺼진 묶음의 쓰기 액션은 여기서 막는다.
export async function assertAdminFeatureEnabled(feature: AdminFeatureId) {
  if (isAdminFeatureDisabled(feature, await getDisabledAdminFeatures())) {
    throw new AdminFeatureDisabledError()
  }
}

// 사용자 쪽 옛 기능의 서버 액션용(주소가 없어 미들웨어로 막을 수 없다).
export async function assertSiteFeatureEnabled(feature: SiteFeatureId) {
  if (isSiteFeatureDisabled(feature, await getDisabledSiteFeatures())) {
    throw new AdminFeatureDisabledError()
  }
}
