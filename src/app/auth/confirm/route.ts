import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RECOVERY_MAX_AGE_SECONDS,
  PASSWORD_RESET_REQUEST_PATH,
  buildPasswordResetRedirectPath,
  buildRecoveryMarker,
  getPasswordResetBlockReason,
  isTrustedFormPostOrigin,
  parseRecoveryTokenHash,
  resolveRecoverySessionKey,
  type PasswordResetErrorCode,
} from '@/lib/password-reset'

// 비밀번호 재설정 메일 링크 확인 전용. 카카오 로그인 등은 /auth/callback이 맡는다.
// 보낼 곳은 항상 정해진 경로다(주소의 next 같은 값은 읽지 않는다).

type ServerClient = Awaited<ReturnType<typeof createClient>>

const redirectTo = (request: Request, path: string) => NextResponse.redirect(new URL(path, request.url), 303)

// 복구 세션이 만들어진 뒤: 관리자·카카오 가입 계정이면 세션을 끊고 거부, 아니면 표시 쿠키를 남기고 새 비밀번호 화면으로.
async function finishRecovery(
  request: Request,
  supabase: ServerClient,
  user: { id: string; email?: string },
  accessToken: string | undefined
) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_admin, provider')
    .eq('id', user.id)
    .maybeSingle()

  const blockReason = getPasswordResetBlockReason(user.email, profile)
  if (profileError || blockReason) {
    await supabase.auth.signOut({ scope: 'local' })
    return redirectTo(request, buildPasswordResetRedirectPath(blockReason ?? 'invalid_link'))
  }

  const cookieStore = await cookies()
  cookieStore.set(PASSWORD_RECOVERY_COOKIE, buildRecoveryMarker(resolveRecoverySessionKey(accessToken, user.id), Date.now()), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(request.url).protocol === 'https:',
    maxAge: PASSWORD_RECOVERY_MAX_AGE_SECONDS,
  })
  return redirectTo(request, buildPasswordResetRedirectPath())
}

// 새 템플릿: 재설정 화면의 "계속" 버튼이 token_hash를 POST로 보낸다(우리 사이트의 화면에서 보낸 것만 받는다).
// 메일 서비스의 링크 미리 열기(GET)로는 토큰이 쓰이지 않게 하려고 GET에서는 검증하지 않는다.
export async function POST(request: Request) {
  const trusted = isTrustedFormPostOrigin({
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    requestUrl: request.url,
    envSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  })
  if (!trusted) {
    // 배포 주소 설정이 어긋나 정상 회원이 모두 막히는 경우를 알아챌 수 있게 남긴다(토큰은 남기지 않는다).
    console.error('[password-reset] 출처 검사에서 거부', {
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site'),
      requestOrigin: new URL(request.url).origin,
    })
    return redirectTo(request, buildPasswordResetRedirectPath('untrusted_origin'))
  }

  const formData = await request.formData().catch(() => null)
  const tokenHash = parseRecoveryTokenHash(formData?.get('token_hash'), formData?.get('type'))
  if (!tokenHash) {
    return redirectTo(request, buildPasswordResetRedirectPath('invalid_link'))
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
  if (error || !data.user) {
    return redirectTo(request, buildPasswordResetRedirectPath('invalid_link'))
  }
  return finishRecovery(request, supabase, data.user, data.session?.access_token)
}

// 기본 템플릿({{ .ConfirmationURL }}): Supabase가 확인한 뒤 ?code= 를 붙여 돌려보낸다(PKCE).
// 재설정을 요청한 브라우저에 저장된 code verifier가 있어야 세션으로 바꿀 수 있다.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    // 만료·사용된 링크는 Supabase가 error 값을 붙여 돌려보낸다. 아무 값도 없으면 요청 화면으로.
    const failed = searchParams.get('error') || searchParams.get('error_code')
    return redirectTo(request, failed ? buildPasswordResetRedirectPath('invalid_link') : PASSWORD_RESET_REQUEST_PATH)
  }

  const cookieStore = await cookies()
  const hasCodeVerifier = cookieStore.getAll().some(({ name }) => name.endsWith('-code-verifier'))
  const failure: PasswordResetErrorCode = hasCodeVerifier ? 'invalid_link' : 'other_browser'

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) {
    return redirectTo(request, buildPasswordResetRedirectPath(failure))
  }
  // 재설정 요청으로 만든 코드가 아니면(예: 카카오 로그인 코드) 복구 세션으로 보지 않는다.
  // (설치된 auth-js는 redirectType을 돌려주지만 타입 선언에는 없다.)
  if ((data as { redirectType?: string | null }).redirectType !== 'PASSWORD_RECOVERY') {
    return redirectTo(request, PASSWORD_RESET_REQUEST_PATH)
  }
  return finishRecovery(request, supabase, data.user, data.session?.access_token)
}
