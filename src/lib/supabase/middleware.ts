import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  DEFAULT_WORKSPACE_SUBJECT,
  isSubjectFacingPath,
  isWorkspaceSubject,
  parseWorkspaceSubjectFromPath,
  stripWorkspacePrefix,
  withWorkspacePrefix,
} from '@/lib/workspace-subject'

const WORKSPACE_SUBJECT_HEADER = 'x-workspace-subject'
const WORKSPACE_HEADER_MODE_HEADER = 'x-workspace-header-mode'
const WORKSPACE_SCOPED_PATH_HEADER = 'x-workspace-scoped-path'

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

const copyResponseCookies = (from: NextResponse, to: NextResponse) => {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie)
  })
}

function buildRequestHeaders(
  request: NextRequest,
  workspaceSubject?: string | null,
  headerMode: 'root-neutral' | 'subject' = 'subject',
  scopedPath = '/'
) {
  const requestHeaders = new Headers(request.headers)

  if (isWorkspaceSubject(workspaceSubject)) {
    requestHeaders.set(WORKSPACE_SUBJECT_HEADER, workspaceSubject)
  } else {
    requestHeaders.delete(WORKSPACE_SUBJECT_HEADER)
  }

  requestHeaders.set(WORKSPACE_HEADER_MODE_HEADER, headerMode)
  requestHeaders.set(WORKSPACE_SCOPED_PATH_HEADER, scopedPath)

  return requestHeaders
}

function buildNextResponse(
  request: NextRequest,
  workspaceSubject?: string | null,
  headerMode: 'root-neutral' | 'subject' = 'subject',
  scopedPath = '/'
) {
  return NextResponse.next({
    request: {
      headers: buildRequestHeaders(request, workspaceSubject, headerMode, scopedPath),
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
  }
}

const buildRoutingResponse = (
  request: NextRequest,
  routingContext = resolveWorkspaceRoutingContext(request)
) => {
  const url = request.nextUrl.clone()
  const {
    pathname,
    pathSubject,
    stripped,
    resolvedSubject,
  } = routingContext

  if (pathSubject && stripped.scopedPath === '/') {
    const rewriteUrl = url.clone()
    rewriteUrl.pathname = '/'
    rewriteUrl.searchParams.delete('subject')
    rewriteUrl.searchParams.set('subject', pathSubject)
    const response = NextResponse.rewrite(rewriteUrl, {
      request: {
        headers: buildRequestHeaders(request, pathSubject, 'subject', '/'),
      },
    })
    response.cookies.set('preferred_workspace', pathSubject)
    return response
  }

  if (pathSubject && isSubjectFacingPath(stripped.scopedPath)) {
    const rewriteUrl = url.clone()
    rewriteUrl.pathname = stripped.scopedPath
    rewriteUrl.searchParams.set('subject', pathSubject)
    const response = NextResponse.rewrite(rewriteUrl, {
      request: {
        headers: buildRequestHeaders(request, pathSubject, 'subject', stripped.scopedPath),
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
  const isAdminPath = pathname === '/admin' || pathname.startsWith('/admin/')
  const isDashboardPath = pathname.startsWith('/dashboard')
  const isMyPagePath = pathname.startsWith('/mypage')

  if (!isSubjectFacingProtectedPath && !isAdminPath && !isDashboardPath && !isMyPagePath) {
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
  redirectUrl.pathname = '/login'
  redirectUrl.search = ''
  redirectUrl.hash = ''
  redirectUrl.searchParams.set('next', nextPath)

  const response = NextResponse.redirect(redirectUrl)
  if (isSubjectFacingProtectedPath) {
    response.cookies.set('preferred_workspace', pathSubject ?? resolvedSubject)
  }

  return response
}

export async function updateSession(request: NextRequest) {
  const routingContext = resolveWorkspaceRoutingContext(request)
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

          response = buildNextResponse(request, routingContext.explicitSubject, routingContext.headerMode, routingContext.scopedPath)

          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

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

    if (!isBypassPath && user) {
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
          const routingResponse = buildRoutingResponse(request, routingContext)
          if (routingResponse) {
            copyResponseCookies(response, routingResponse)
            return routingResponse
          }
          return response
        }

        if (isKakaoSignupPage) {
          const routingResponse = buildRoutingResponse(request, routingContext)
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
    const supabaseCookies = request.cookies
      .getAll()
      .filter(({ name }) => name.startsWith('sb-'))

    supabaseCookies.forEach(({ name }) => {
      request.cookies.delete(name)
      response.cookies.delete(name)
    })
  }

  const routingResponse = buildRoutingResponse(request, routingContext)
  if (routingResponse) {
    copyResponseCookies(response, routingResponse)
    return routingResponse
  }

  return response
}
