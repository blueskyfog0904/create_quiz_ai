// 관리자 영역의 "기능 묶음". 운영하지 않는 기능은 묶음 단위로 끈다.
// 어느 경로가 어느 묶음인지는 여기(규칙), 어떤 묶음이 꺼져 있는지는 DB(system_settings.admin_disabled_features)에 둔다.
// 이 파일은 미들웨어에서도 쓰므로 순수 함수만 둔다.

export interface AdminFeatureDefinition {
  id: string
  // 이 접두로 시작하는 페이지·API 경로가 묶음에 속한다(경로 조각 경계로 비교).
  pathPrefixes: readonly string[]
}

export const ADMIN_FEATURES = [
  {
    id: 'question_bank',
    pathPrefixes: ['/admin/questions', '/admin/question-bank', '/api/admin/questions', '/api/admin/question-bank'],
  },
  {
    id: 'ai_generation',
    pathPrefixes: [
      '/admin/problem-types',
      '/admin/ai-connections',
      '/admin/ai-question-generation-runs',
      '/api/admin/problem-types',
      '/api/admin/problem-type-default-prompts',
      '/api/admin/ai-connections',
      '/api/admin/ai-models',
      '/api/admin/ai-question-generation-runs',
      '/api/admin/providers',
    ],
  },
  { id: 'generate', pathPrefixes: ['/admin/generate'] },
  { id: 'passages', pathPrefixes: ['/admin/passages', '/dashboard/admin/passages'] },
  { id: 'source_configs', pathPrefixes: ['/admin/source-configs', '/api/admin/source-configs'] },
  { id: 'labels', pathPrefixes: ['/admin/labels'] },
  { id: 'landing_pages', pathPrefixes: ['/admin/landing-pages'] },
  { id: 'signup_roles', pathPrefixes: ['/admin/roles'] },
  { id: 'menu_management', pathPrefixes: ['/admin/menu-management'] },
] as const satisfies readonly AdminFeatureDefinition[]

export type AdminFeatureId = (typeof ADMIN_FEATURES)[number]['id']

export const ADMIN_DISABLED_FEATURES_SETTING_KEY = 'admin_disabled_features'

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

// 경로가 속한 기능 묶음. 어느 묶음에도 속하지 않으면(운영 화면) null.
export function resolveAdminFeature(pathname: string): AdminFeatureId | null {
  // 퍼센트 인코딩으로 접두 비교를 피하지 못하게 풀어서 본다(예: /admin/%71uestions). 풀 수 없는 값은 그대로 본다.
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    decoded = pathname
  }
  const normalized = decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded
  for (const feature of ADMIN_FEATURES) {
    if (feature.pathPrefixes.some((prefix) => matchesPrefix(normalized, prefix))) {
      return feature.id
    }
  }
  return null
}

// 설정 값({ "features": ["question_bank", ...] })을 읽는다. 형식이 틀리면 null(= 읽기 실패로 취급).
export function parseDisabledAdminFeatures(value: unknown): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const features = (value as { features?: unknown }).features
  if (!Array.isArray(features) || features.some((feature) => typeof feature !== 'string')) {
    return null
  }
  return features as string[]
}

export type DisabledAdminFeaturesState =
  | { ok: true; features: readonly string[] }
  // 설정을 읽지 못했다. 이때는 묶음에 속한 경로를 모두 막는다(운영 화면 경로는 묶음에 속하지 않아 영향 없음).
  | { ok: false }

export function isAdminFeatureDisabled(feature: AdminFeatureId, state: DisabledAdminFeaturesState) {
  return state.ok ? state.features.includes(feature) : true
}

export function isAdminPathDisabled(pathname: string, state: DisabledAdminFeaturesState) {
  const feature = resolveAdminFeature(pathname)
  return feature ? isAdminFeatureDisabled(feature, state) : false
}
