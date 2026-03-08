import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const normalizeInternalPath = (path: string | null) => {
  if (!path || path === '/signup') {
    return '/'
  }

  if (!path.startsWith('/') || path.startsWith('//')) {
    return '/'
  }

  return path
}

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  })

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

          response = NextResponse.next({
            request,
          })

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
          return response
        }

        if (isKakaoSignupPage) {
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

  return response
}
