import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { toSessionCookieOptions } from './session-cookies'
import {
  DEFAULT_WORKSPACE_SUBJECT,
  isSubjectFacingPath,
  isWorkspaceSubject,
  parseWorkspaceSubjectFromPath,
  stripWorkspacePrefix,
  withWorkspacePrefix,
} from '@/lib/workspace-subject'
import { isPublicBrowseableSubjectPath } from '@/lib/workspace-public-browse'

const WORKSPACE_SUBJECT_HEADER = 'x-workspace-subject'
const WORKSPACE_HEADER_MODE_HEADER = 'x-workspace-header-mode'
const WORKSPACE_SCOPED_PATH_HEADER = 'x-workspace-scoped-path'
// src/lib/request-auth.ts 의 AUTH_USER_ID_HEADER 와 같은 값이어야 한다.
const AUTH_USER_ID_HEADER = 'x-auth-user-id'

const getWorkspaceHomePath = (path: string) => {
  const subject = parseWorkspaceSubjectFromPath(path)
  return subject ? withWorkspacePrefix(subject, '/') : '/'
}

const normalizeInternalPath = (path: string | null) => {
  if (!path) {
    return '/'
  }

  const trimmed = path.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
    return '/'
  }

  try {
    const url = new URL(trimmed, 'http://localhost')
    const pathname = url.pathname
    const scopedPath = stripWorkspacePrefix(pathname).scopedPath

    if (pathname === '/login' || pathname === '/signup' || scopedPath === '/login' || scopedPath === '/signup') {
      return getWorkspaceHomePath(pathname)
    }

    return `${pathname}${url.search}${url.hash}`
  } catch {
    return '/'
  }
}

const isKakaoCandidateUser = (user: { app_metadata?: Record<string, unknown> }) => {
  const appMetadata = user.app_metadata ?? {}
  const providers = Array.isArray(appMetadata.providers) ? appMetadata.providers : []
  return appMetadata.provider === 'kakao' || providers.includes('kakao')
}

const copyResponseCookies = (from: NextResponse, to: NextResponse) => {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie)
  })
}

function buildRequestHeaders(
  request: NextRequest,
  workspaceSubject?: string | null,
  headerMode: 'root-neutral' | 'subject' = 'subject',
  scopedPath = '/',
  authUserId: string | null = null
) {
  const requestHeaders = new Headers(request.headers)

  if (isWorkspaceSubject(workspaceSubject)) {
    requestHeaders.set(WORKSPACE_SUBJECT_HEADER, workspaceSubject)
  } else {
    requestHeaders.delete(WORKSPACE_SUBJECT_HEADER)
  }

  requestHeaders.set(WORKSPACE_HEADER_MODE_HEADER, headerMode)
  requestHeaders.set(WORKSPACE_SCOPED_PATH_HEADER, scopedPath)

  // 외부에서 위조해 보낸 헤더가 라우트까지 전달되지 않도록 항상 삭제 후,
  // getUser() 검증을 통과한 경우에만 재설정한다.
  requestHeaders.delete(AUTH_USER_ID_HEADER)
  if (authUserId) {
    requestHeaders.set(AUTH_USER_ID_HEADER, authUserId)
  }

  return requestHeaders
}

function buildNextResponse(
  request: NextRequest,
  workspaceSubject?: string | null,
  headerMode: 'root-neutral' | 'subject' = 'subject',
  scopedPath = '/',
  authUserId: string | null = null
) {
  return NextResponse.next({
    request: {
      headers: buildRequestHeaders(request, workspaceSubject, headerMode, scopedPath, authUserId),
    },
  })
}

function resolveWorkspaceRoutingContext(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const pathSubject = parseWorkspaceSubjectFromPath(pathname)
  const stripped = stripWorkspacePrefix(pathname)
  const subjectParam = request.nextUrl.searchParams.get('subject')
  const hasExplicitSubjectParam = isWorkspaceSubject(subjectParam)
  const cookieSubject = request.cookies.get('preferred_workspace')?.value
  const explicitSubject = pathSubject
    ?? (hasExplicitSubjectParam
      ? subjectParam
      : isWorkspaceSubject(cookieSubject)
        ? cookieSubject
        : null)
  const headerMode: 'root-neutral' | 'subject' = pathname === '/' && !pathSubject && !hasExplicitSubjectParam
    ? 'root-neutral'
    : 'subject'

  return {
    pathname,
    pathSubject,
    stripped,
    resolvedSubject: explicitSubject ?? DEFAULT_WORKSPACE_SUBJECT,
    explicitSubject,
    headerMode,
    scopedPath: stripped.scopedPath,
    hasExplicitSubjectParam,
  }
}

const LEGACY_LIBRARY_PATTERN = /^\/library\/(purchased|exam-papers|market|mypassages)(\/|$)/

const buildRoutingResponse = (
  request: NextRequest,
  routingContext = resolveWorkspaceRoutingContext(request),
  authUserId: string | null = null
) => {
  const url = request.nextUrl.clone()
  const {
    pathname,
    pathSubject,
    stripped,
    resolvedSubject,
  } = routingContext

  // 레거시 라이브러리: /library/* 및 /{subject}/library/* → /legacy/{subject}/library/* (단일 홉)
  if (LEGACY_LIBRARY_PATTERN.test(stripped.scopedPath)) {
    const redirectSubject = pathSubject ?? resolvedSubject
    const redirectUrl = url.clone()
    redirectUrl.pathname = `/legacy${withWorkspacePrefix(redirectSubject, stripped.scopedPath)}`
    redirectUrl.searchParams.delete('subject')
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.set('preferred_workspace', redirectSubject)
    return response
  }

  if (pathSubject && stripped.scopedPath === '/') {
    const response = NextResponse.next({
      request: {
        headers: buildRequestHeaders(request, pathSubject, 'subject', '/', authUserId),
      },
    })
    response.cookies.set('preferred_workspace', pathSubject)
    return response
  }

  if (pathSubject && isSubjectFacingPath(stripped.scopedPath)) {
    const response = NextResponse.next({
      request: {
        headers: buildRequestHeaders(request, pathSubject, 'subject', stripped.scopedPath, authUserId),
      },
    })
    response.cookies.set('preferred_workspace', pathSubject)
    return response
  }

  if (pathSubject && !isSubjectFacingPath(stripped.scopedPath)) {
    const redirectUrl = url.clone()
    redirectUrl.pathname = stripped.scopedPath
    redirectUrl.searchParams.delete('subject')
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.set('preferred_workspace', pathSubject)
    return response
  }

  if (!pathSubject && isSubjectFacingPath(pathname)) {
    const redirectUrl = url.clone()
    redirectUrl.pathname = withWorkspacePrefix(resolvedSubject, pathname)
    redirectUrl.searchParams.delete('subject')
    const response = NextResponse.redirect(redirectUrl)
    response.cookies.set('preferred_workspace', resolvedSubject)
    return response
  }

  return null
}

const buildAuthRedirectResponse = (
  request: NextRequest,
  routingContext = resolveWorkspaceRoutingContext(request)
) => {
  const {
    pathname,
    pathSubject,
    stripped,
    resolvedSubject,
  } = routingContext
  const isSubjectFacingProtectedPath = pathSubject
    ? isSubjectFacingPath(stripped.scopedPath)
    : isSubjectFacingPath(pathname)
  const isPublicBrowsePath = pathSubject
    ? isPublicBrowseableSubjectPath(stripped.scopedPath)
    : isPublicBrowseableSubjectPath(pathname)
  // /admin/login은 관리자 전용 로그인 화면이라 보호 대상에서 제외한다
  const isAdminPath = pathname !== '/admin/login' && (pathname === '/admin' || pathname.startsWith('/admin/'))
  const isDashboardPath = pathname.startsWith('/dashboard')
  const isMyPagePath = pathname.startsWith('/mypage') || pathname.startsWith('/legacy/mypage')

  if (!isSubjectFacingProtectedPath && !isAdminPath && !isDashboardPath && !isMyPagePath) {
    return null
  }

  if (isSubjectFacingProtectedPath && isPublicBrowsePath) {
    return null
  }

  let nextPath = `${pathname}${request.nextUrl.search}`

  if (isSubjectFacingProtectedPath) {
    if (pathSubject) {
      nextPath = `${pathname}${request.nextUrl.search}`
    } else {
      const nextSearchParams = new URLSearchParams(request.nextUrl.searchParams)
      nextSearchParams.delete('subject')
      const prefixedPath = withWorkspacePrefix(resolvedSubject, pathname)
      const nextQuery = nextSearchParams.toString()
      nextPath = nextQuery ? `${prefixedPath}?${nextQuery}` : prefixedPath
    }
  }

  const redirectUrl = request.nextUrl.clone()
  redirectUrl.search = ''
  redirectUrl.hash = ''
  if (isAdminPath) {
    // 관리자 경로는 일반 로그인이 아니라 관리자 전용 로그인으로 보낸다
    redirectUrl.pathname = '/admin/login'
  } else {
    redirectUrl.pathname = '/login'
    redirectUrl.searchParams.set('next', nextPath)
  }

  const response = NextResponse.redirect(redirectUrl)
  if (isSubjectFacingProtectedPath) {
    response.cookies.set('preferred_workspace', pathSubject ?? resolvedSubject)
  }

  return response
}

export async function updateSession(request: NextRequest) {
  const routingContext = resolveWorkspaceRoutingContext(request)
  let verifiedUserId: string | null = null
  let response = buildNextResponse(request, routingContext.explicitSubject, routingContext.headerMode, routingContext.scopedPath)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )

          response = buildNextResponse(request, routingContext.explicitSubject, routingContext.headerMode, routingContext.scopedPath, verifiedUserId)

          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, toSessionCookieOptions(options))
          )
        },
      },
    }
  )

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (user) {
      verifiedUserId = user.id
      const authedResponse = buildNextResponse(request, routingContext.explicitSubject, routingContext.headerMode, routingContext.scopedPath, verifiedUserId)
      copyResponseCookies(response, authedResponse)
      response = authedResponse
    }

    const pathname = request.nextUrl.pathname
    const isBypassPath = (
      pathname.startsWith('/api')
      || pathname.startsWith('/auth/callback')
      || pathname.startsWith('/login')
    )

    if (!isBypassPath && !user) {
      const authRedirectResponse = buildAuthRedirectResponse(request, routingContext)
      if (authRedirectResponse) {
        copyResponseCookies(response, authRedirectResponse)
        return authRedirectResponse
      }
    }

    // 아래 profiles 조회는 카카오 가입 미완료자 리다이렉트 전용이다.
    // profiles.provider 는 가입 트리거가 JWT app_metadata 의 provider 에서 복사한 값이므로,
    // JWT 에 kakao 가 없는 유저는 조회 결과가 항상 non-kakao → 왕복을 건너뛴다.
    if (!isBypassPath && user && isKakaoCandidateUser(user)) {
      const isKakaoSignupPage = (
        pathname.startsWith('/signup')
        && request.nextUrl.searchParams.get('provider') === 'kakao'
        && request.nextUrl.searchParams.get('signup') === '1'
      )

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('provider, signup_completed')
        .eq('id', user.id)
        .maybeSingle()

      if (!profileError && profile?.provider === 'kakao') {
        if (profile.signup_completed && isKakaoSignupPage) {
          const nextPath = normalizeInternalPath(request.nextUrl.searchParams.get('next'))
          const redirectUrl = request.nextUrl.clone()
          const nextUrl = new URL(nextPath, redirectUrl.origin)

          redirectUrl.pathname = nextUrl.pathname
          redirectUrl.search = nextUrl.search
          redirectUrl.hash = nextUrl.hash

          return NextResponse.redirect(redirectUrl)
        }

        if (profile.signup_completed) {
          const routingResponse = buildRoutingResponse(request, routingContext, verifiedUserId)
          if (routingResponse) {
            copyResponseCookies(response, routingResponse)
            return routingResponse
          }
          return response
        }

        if (isKakaoSignupPage) {
          const routingResponse = buildRoutingResponse(request, routingContext, verifiedUserId)
          if (routingResponse) {
            copyResponseCookies(response, routingResponse)
            return routingResponse
          }
          return response
        }

        const redirectUrl = request.nextUrl.clone()
        redirectUrl.pathname = '/signup'
        redirectUrl.searchParams.set('provider', 'kakao')
        redirectUrl.searchParams.set('signup', '1')
        redirectUrl.searchParams.set(
          'next',
          `${request.nextUrl.pathname}${request.nextUrl.search}`
        )

        return NextResponse.redirect(redirectUrl)
      }
    }
  } catch {
    // 세션을 깨진 것으로 간주하는 경로이므로 인증 헤더도 함께 비운다.
    verifiedUserId = null
    response = buildNextResponse(request, routingContext.explicitSubject, routingContext.headerMode, routingContext.scopedPath)

    const supabaseCookies = request.cookies
      .getAll()
      .filter(({ name }) => name.startsWith('sb-'))

    supabaseCookies.forEach(({ name }) => {
      request.cookies.delete(name)
      response.cookies.delete(name)
    })
  }

  const routingResponse = buildRoutingResponse(request, routingContext, verifiedUserId)
  if (routingResponse) {
    copyResponseCookies(response, routingResponse)
    return routingResponse
  }

  return response
}
