import { parseWorkspaceSubjectFromPath, stripWorkspacePrefix, withWorkspacePrefix } from '@/lib/workspace-subject'

export function getWorkspaceHomePath(path: string) {
  const subject = parseWorkspaceSubjectFromPath(path)
  return subject ? withWorkspacePrefix(subject, '/') : '/'
}

// 다음 이동 주소의 기본 검사(로그인 화면·인증 콜백·미들웨어 카카오 분기·카카오 가입 단계·동의 화면이 함께 쓴다).
// 고정 기준 주소로 해석해 출처가 같은지 보고, 해석한 "결과"를 다시 검사한다(예: '/.//evil.com' 은 해석 뒤 '//evil.com').
const NEXT_PATH_BASE = 'http://localhost'

function isUnsafeInternalPath(path: string) {
  return !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')
}

export function normalizeAuthNextPath(path: string | null | undefined) {
  if (!path) {
    return '/'
  }

  const trimmed = path.trim()
  if (isUnsafeInternalPath(trimmed)) {
    return '/'
  }

  try {
    const url = new URL(trimmed, NEXT_PATH_BASE)
    if (url.origin !== NEXT_PATH_BASE) {
      return '/'
    }
    const pathname = url.pathname
    if (isUnsafeInternalPath(pathname) || pathname.includes('\\')) {
      return '/'
    }
    const scopedPath = stripWorkspacePrefix(pathname).scopedPath

    if (pathname === '/login' || pathname === '/signup' || scopedPath === '/login' || scopedPath === '/signup') {
      return getWorkspaceHomePath(pathname)
    }

    // 비밀번호 재설정 화면도 로그인 뒤 돌아갈 곳이 아니다.
    if (pathname === '/forgot-password' || pathname === '/reset-password') {
      return '/'
    }

    return `${pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

// 동의 화면(/consent)에서만 쓰는 추가 검사: 동의 화면 자신·카카오 가입 단계·API·인증 경로로는 돌아가지 않는다.
export function normalizeConsentNextPath(path: string | null | undefined) {
  const next = normalizeAuthNextPath(path)
  const url = new URL(next, NEXT_PATH_BASE)
  const scopedPath = stripWorkspacePrefix(url.pathname).scopedPath
  const isKakaoSignupStep = url.searchParams.get('provider') === 'kakao' && url.searchParams.get('signup') === '1'
  if (
    scopedPath === '/consent'
    || scopedPath.startsWith('/consent/')
    || scopedPath === '/api'
    || scopedPath.startsWith('/api/')
    || scopedPath === '/auth'
    || scopedPath.startsWith('/auth/')
    || isKakaoSignupStep
  ) {
    return '/'
  }
  return next
}

export function buildAuthRedirectPath(nextPath?: string | null, authPath: '/login' | '/signup' = '/login') {
  const next = normalizeAuthNextPath(nextPath)
  return next === '/' ? authPath : `${authPath}?${new URLSearchParams({ next }).toString()}`
}
