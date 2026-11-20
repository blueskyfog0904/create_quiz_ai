import type { NextRequest, NextResponse } from 'next/server'

// 로그인 쿠키를 응답에서 모두 지운다: request 쿠키 중 sb- 로 시작하는 것(분할 쿠키·code-verifier 포함)과 3시간 만료 표시 쿠키.
// signOut 이 실패해도 브라우저에 세션이 남지 않게 한다(가입 취소·동의 거부 로그아웃).
export const AUTH_SESSION_STARTED_COOKIE = 'sst-session-started-at'

export function clearAuthCookies(request: NextRequest, response: NextResponse) {
  request.cookies.getAll().forEach(({ name }) => {
    if (name.startsWith('sb-')) {
      response.cookies.set(name, '', { path: '/', maxAge: 0 })
    }
  })
  response.cookies.set(AUTH_SESSION_STARTED_COOKIE, '', { path: '/', maxAge: 0 })
  return response
}

export function readFormPostOriginInput(request: NextRequest) {
  return {
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    requestUrl: request.url,
    envSiteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
  }
}
