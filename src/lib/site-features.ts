import { isWorkspaceSubject, stripWorkspacePrefix, type WorkspaceSubject } from '@/lib/workspace-subject'

// 사용자 쪽 "옛 기능 묶음". 문제마켓만 운영하는 동안 묶음 단위로 닫아 둔다(코드·데이터는 그대로, 다시 켜면 이어서 쓸 수 있다).
// 어느 경로가 어느 묶음인지는 여기(규칙), 어떤 묶음이 닫혀 있는지는 DB(system_settings.site_disabled_features)에 둔다.
// 닫힌 묶음의 페이지는 문제마켓의 대응 화면으로 보내고(307), API는 404로 막는다.
// 미들웨어에서도 쓰므로 순수 함수만 둔다.

export const SITE_FEATURE_IDS = [
  'site_generate',
  'site_question_bank',
  'site_exam_papers',
  'site_passages',
  'site_legacy_library',
  'site_legacy_mypage',
  'site_legacy_landing',
  'site_preview',
] as const

export type SiteFeatureId = (typeof SITE_FEATURE_IDS)[number]

export const SITE_DISABLED_FEATURES_SETTING_KEY = 'site_disabled_features'

export type SiteFeatureRoute =
  | { feature: SiteFeatureId; kind: 'api' }
  | { feature: SiteFeatureId; kind: 'page'; redirectTo: string }

// API 접두 → 묶음. 같은 접두 아래 묶음이 갈리는 곳이 있어 구체적인 것부터 둔다.
const API_RULES: ReadonlyArray<readonly [string, SiteFeatureId]> = [
  ['/api/questions/generate', 'site_generate'],
  ['/api/questions/review', 'site_generate'],
  ['/api/generate', 'site_generate'],
  ['/api/questions/save-from-community', 'site_question_bank'],
  ['/api/question-bank', 'site_question_bank'],
  ['/api/exam-papers/random-bank', 'site_question_bank'],
  ['/api/exam-papers', 'site_exam_papers'],
  ['/api/questions', 'site_legacy_library'],
]

type PageTarget = 'home' | 'library'

// 과목 접두(/korean, /english)를 뗀 경로 접두 → 묶음과 보낼 곳. '/library' 자체(새 보관함)는 운영 화면이라 넣지 않는다.
const PAGE_RULES: ReadonlyArray<readonly [string, SiteFeatureId, PageTarget]> = [
  ['/generate', 'site_generate', 'home'],
  ['/bank', 'site_question_bank', 'home'],
  ['/exam-papers', 'site_exam_papers', 'library'],
  ['/library/exam-papers', 'site_exam_papers', 'library'],
  ['/passages', 'site_passages', 'home'],
  ['/library/mypassages', 'site_passages', 'library'],
  ['/library/purchased', 'site_legacy_library', 'library'],
  ['/library/market', 'site_legacy_library', 'library'],
]

// 과목과 무관한 시안 화면
const PREVIEW_PREFIXES = ['/preview/solvook-concept', '/preview/design-system', '/preview/scholarly-library'] as const

// 옛 마이페이지 하위 화면 중 새 마이페이지에 같은 이름으로 있는 것
const MYPAGE_SECTIONS = ['credits', 'history', 'payments', 'profile', 'support', 'withdraw'] as const

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function withSubject(pathname: string, subject: WorkspaceSubject | null) {
  return subject ? `${pathname}?subject=${subject}` : pathname
}

function resolveScopedPage(scopedPath: string, subject: WorkspaceSubject | null): SiteFeatureRoute | null {
  for (const [prefix, feature, target] of PAGE_RULES) {
    if (matchesPrefix(scopedPath, prefix)) {
      return { feature, kind: 'page', redirectTo: withSubject(target === 'library' ? '/library' : '/', subject) }
    }
  }
  return null
}

// 경로가 옛 기능 묶음에 속하면 그 묶음과 처리 방법을 돌려준다. 운영 화면이면 null.
// subjectParam: 주소의 ?subject= 값(과목 접두가 없는 경로에서 보낼 과목을 정할 때만 쓴다).
export function resolveSiteFeatureRoute(pathname: string, subjectParam?: string | null): SiteFeatureRoute | null {
  // 퍼센트 인코딩으로 접두 비교를 피하지 못하게 풀어서 본다. 풀 수 없는 값은 그대로 본다.
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    decoded = pathname
  }
  const normalized = decoded.length > 1 ? decoded.replace(/\/+$/, '') : decoded
  const fallbackSubject = isWorkspaceSubject(subjectParam) ? subjectParam : null

  if (matchesPrefix(normalized, '/api')) {
    for (const [prefix, feature] of API_RULES) {
      if (matchesPrefix(normalized, prefix)) {
        return { feature, kind: 'api' }
      }
    }
    return null
  }

  if (normalized === '/legacy') {
    return { feature: 'site_legacy_landing', kind: 'page', redirectTo: '/' }
  }

  if (matchesPrefix(normalized, '/legacy/mypage')) {
    const section = normalized.split('/')[3]
    const known = (MYPAGE_SECTIONS as readonly string[]).includes(section ?? '')
    return { feature: 'site_legacy_mypage', kind: 'page', redirectTo: known ? `/mypage/${section}` : '/mypage' }
  }

  if (matchesPrefix(normalized, '/legacy')) {
    // /legacy/{과목}/library/{탭}
    const { subject, scopedPath } = stripWorkspacePrefix(normalized.slice('/legacy'.length))
    return resolveScopedPage(scopedPath, subject ?? fallbackSubject)
  }

  if (PREVIEW_PREFIXES.some((prefix) => matchesPrefix(normalized, prefix))) {
    return { feature: 'site_preview', kind: 'page', redirectTo: '/' }
  }

  const { subject, scopedPath } = stripWorkspacePrefix(normalized)
  // 옛 과목별 첫 화면(/korean, /english). 문제마켓 홈의 과목 전환은 /?subject= 이다.
  if (subject && scopedPath === '/') {
    return { feature: 'site_legacy_landing', kind: 'page', redirectTo: withSubject('/', subject) }
  }

  return resolveScopedPage(scopedPath, subject ?? fallbackSubject)
}
