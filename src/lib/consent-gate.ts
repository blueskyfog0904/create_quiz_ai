import { normalizePathname, stripWorkspacePrefix } from '@/lib/workspace-subject'

// 로그인 회원이 필수 약관에 동의하지 않았을 때 동의 화면(/consent)으로 보내는 미들웨어 판정의 규칙(순수 함수).
// 화면 이동은 최선 노력이다(실패하면 통과). 실제 강제는 돈 API(src/lib/consent-guard-server.ts)가 한다.

// 판정하지 않는 경로: 동의·로그인·가입 화면 자신, 약관 전문, API·인증, 관리자, 결제 결과,
// 그리고 동의하지 않은 회원도 쓸 수 있어야 하는 화면(탈퇴·결제 내역·크레딧 환불·문의·자료 보관함·선택 동의 관리·이용 제한 안내).
const EXCLUDED_PATH_PREFIXES = [
  '/consent',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/auth',
  '/terms',
  '/api',
  '/admin',
  '/dashboard/admin',
  '/preview',
  '/mypage/withdraw',
  '/mypage/payments',
  '/mypage/credits',
  '/mypage/support',
  '/mypage/consents',
  // 12번: 이용 제한 안내 화면(동의하지 않은 회원도 막힌 이유를 볼 수 있어야 한다)
  '/mypage/restriction',
  '/library',
  '/_next',
  '/.well-known',
] as const

const CHECKOUT_RESULT_PATTERN = /^\/checkout\/[^/]+\/result(?:\/|$)/
const NEXT_DEV_PATTERN = /^\/__nextjs/
const PUBLIC_FILE_PATTERN = /\.(?:svg|png|jpe?g|gif|webp|avif|ico|csv|hwpx?|txt|pdf|json|xml|webmanifest|woff2?|ttf|otf|map|js|css)$/i

function matchesPrefix(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function isExcludedScopedPath(path: string) {
  return EXCLUDED_PATH_PREFIXES.some((prefix) => matchesPrefix(path, prefix))
    || CHECKOUT_RESULT_PATTERN.test(path)
    || NEXT_DEV_PATTERN.test(path)
    || PUBLIC_FILE_PATTERN.test(path)
}

export function isConsentGateExcludedPath(pathname: string) {
  const normalized = normalizePathname(pathname)
  const scoped = stripWorkspacePrefix(normalized).scopedPath
  return isExcludedScopedPath(normalized) || isExcludedScopedPath(scoped)
}

// 화면을 가져오는 요청만 본다: GET·HEAD 이고 서버 액션(Next-Action)·미리 불러오기(Next-Router-Prefetch)가 아닌 것.
export function isConsentGateRequest(method: string, headers: Pick<Headers, 'get'>) {
  const upper = method.toUpperCase()
  if (upper !== 'GET' && upper !== 'HEAD') {
    return false
  }
  if (headers.get('next-action')) {
    return false
  }
  if (headers.get('next-router-prefetch')) {
    return false
  }
  return true
}

// 동의 뒤 돌아갈 주소: 지금 주소에서 RSC·카카오 가입 단계 표시만 뺀다(login=success 는 남겨 로그인 복귀 담기·구매가 이어지게).
const STRIPPED_NEXT_PARAMS = ['_rsc', 'provider', 'signup'] as const

export function buildConsentGateNext(pathname: string, search: string) {
  const params = new URLSearchParams(search)
  STRIPPED_NEXT_PARAMS.forEach((key) => params.delete(key))
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function buildConsentPagePath(next: string) {
  return `/consent?${new URLSearchParams({ next }).toString()}`
}
