import { createBrowserClient } from '@supabase/ssr'
import { toSessionCookieOptions } from './session-cookies'

// 기본 구현은 쿠키를 400일 만료로 저장해 브라우저를 껐다 켜도 로그인이 유지된다.
// 만료를 제거한 '세션 쿠키'로 저장해 브라우저 완전 종료 시 로그아웃되도록 한다.
// (Supabase 쿠키 값은 base64url이라 인코딩 없이 그대로 읽고 써도 안전하다)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return document.cookie
            .split('; ')
            .filter(Boolean)
            .map((pair) => {
              const separatorIndex = pair.indexOf('=')
              return {
                name: pair.slice(0, separatorIndex),
                value: pair.slice(separatorIndex + 1),
              }
            })
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const sessionOptions = toSessionCookieOptions(options)
            let cookie = `${name}=${value}; Path=${sessionOptions.path ?? '/'}; SameSite=Lax`
            if (sessionOptions.maxAge === 0) {
              cookie += '; Max-Age=0'
            }
            if (window.location.protocol === 'https:') {
              cookie += '; Secure'
            }
            document.cookie = cookie
          })
        },
      },
    }
  )
}
