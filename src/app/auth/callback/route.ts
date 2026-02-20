import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)

  const normalizeNext = (path: string | null) => {
    if (!path || path === '/') {
      return '/'
    }

    if (!path.startsWith('/')) {
      return '/'
    }

    if (path.startsWith('//')) {
      return '/'
    }

    return path
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
