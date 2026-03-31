import { createClient } from '@/lib/supabase/server'
import { parseWorkspaceSubjectFromPath, stripWorkspacePrefix, withWorkspacePrefix } from '@/lib/workspace-subject'
import { NextResponse } from 'next/server'

const getRequestOrigin = (request: Request) => {
  const requestUrl = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const envSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim()

  if (forwardedHost && forwardedProto && /^(http|https)$/i.test(forwardedProto)) {
    return `${forwardedProto.toLowerCase()}://${forwardedHost}`
  }

  if (envSiteUrl) {
    return envSiteUrl.replace(/\/$/, '')
  }

  return requestUrl.origin
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const origin = getRequestOrigin(request)

  const getWorkspaceHomePath = (path: string) => {
    const subject = parseWorkspaceSubjectFromPath(path)
    return subject ? withWorkspacePrefix(subject, '/') : '/'
  }

  const normalizeNext = (path: string | null) => {
    if (!path) {
      return '/'
    }

    const trimmed = path.trim()
    if (!trimmed.startsWith('/')) {
      return '/'
    }

    if (trimmed.startsWith('//')) {
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

  const code = searchParams.get('code')
  const next = normalizeNext(searchParams.get('next') ?? '/')
  const error = searchParams.get('error')
  const errorCode = searchParams.get('error_code')
  const errorDescription = searchParams.get('error_description')
  const provider = searchParams.get('provider')
  const signupMode = searchParams.get('signup') === '1' || searchParams.get('signup_mode') === '1'

  if (error || !code) {
    const failParams = new URLSearchParams()
    failParams.set('next', next)
    if (provider) {
      failParams.set('provider', provider)
    }
    if (signupMode) {
      failParams.set('signup', '1')
    }
    failParams.set('error', error || 'callback_error')
    failParams.set(
      'error_description',
      errorDescription || errorCode || 'Could not authenticate user',
    )

    return NextResponse.redirect(`${origin}/login?${failParams.toString()}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const nextUrl = new URL(`${origin}${next}`)
      if (provider) {
        nextUrl.searchParams.set('provider', provider)
      }
      if (signupMode) {
        nextUrl.searchParams.set('signup', '1')
      }
      return NextResponse.redirect(nextUrl.toString())
    }

    const failParams = new URLSearchParams()
    failParams.set('next', next)
    if (provider) {
      failParams.set('provider', provider)
    }
    if (signupMode) {
      failParams.set('signup', '1')
    }
    failParams.set('error', 'exchange_failed')
    failParams.set(
      'error_description',
      error.message || '인증 코드 처리 중 오류가 발생했습니다.',
    )

    return NextResponse.redirect(`${origin}/login?${failParams.toString()}`)
  }

  const failParams = new URLSearchParams()
  failParams.set('next', next)
  if (provider) {
    failParams.set('provider', provider)
  }
  if (signupMode) {
    failParams.set('signup', '1')
  }
  failParams.set('error', 'callback_error')
    failParams.set('error_description', 'Could not authenticate user')

  return NextResponse.redirect(`${origin}/login?${failParams.toString()}`)
}
