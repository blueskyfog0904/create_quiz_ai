'use server'

import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/bypass'
import { toSessionCookieOptions } from '@/lib/supabase/session-cookies'
import {
  PASSWORD_RECOVERY_COOKIE,
  PASSWORD_RESET_BLOCK_MESSAGES,
  PASSWORD_RESET_CONFIRM_PATH,
  PASSWORD_RESET_DONE_LOGIN_PATH,
  PASSWORD_RESET_REQUEST_PATH,
  PASSWORD_RESET_TEMPORARY_ERROR_MESSAGE,
  checkResetRequestEmail,
  describePasswordUpdateError,
  getPasswordResetBlockReason,
  isRecoveryMarkerValid,
  normalizeResetEmail,
  resolveRecoverySessionKey,
  resolveResetMailOrigin,
  resolveResetRequestOutcome,
  shouldSkipResetMail,
  validateNewPassword,
} from '@/lib/password-reset'

// 재설정 요청용 Supabase 클라이언트(쿠키 처리는 lib/supabase/server.ts와 같다).
// sendMail이 false면 Supabase로 나가는 요청만 막는다: 메일을 보내지 않는 계정(카카오·관리자)에서도
// 보내는 경우와 같은 코드 경로로 PKCE code verifier 쿠키가 남아, 응답의 쿠키로 계정 종류가 드러나지 않는다.
async function createResetRequestClient(sendMail: boolean) {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, toSessionCookieOptions(options))
          )
        },
      },
      ...(sendMail
        ? {}
        : { global: { fetch: async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }) } }),
    }
  )
}

// 재설정 메일 요청. 가입 여부와 무관하게 같은 안내로 답한다.
export async function requestPasswordReset(formData: FormData) {
  const email = normalizeResetEmail(formData.get('email'))
  const emailError = checkResetRequestEmail(email)
  if (emailError) {
    return { success: false as const, error: emailError }
  }

  // 카카오 가입 계정·관리자 계정에는 보내지 않는다. 조회 실패는 계정과 무관한 오류로 답한다.
  const { data: profiles, error: profileError } = await createAdminClient()
    .from('profiles')
    .select('provider, is_admin')
    .eq('email', email)
  if (profileError) {
    console.error('[Password Reset] profile lookup failed:', profileError.code)
    return { success: false as const, error: PASSWORD_RESET_TEMPORARY_ERROR_MESSAGE }
  }
  const sendMail = !shouldSkipResetMail(profiles ?? [])

  const headerStore = await headers()
  const host = headerStore.get('host')
  const origin = resolveResetMailOrigin({
    envSiteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    forwardedHost: headerStore.get('x-forwarded-host'),
    forwardedProto: headerStore.get('x-forwarded-proto'),
    fallbackOrigin: headerStore.get('origin') ?? (host ? `http://${host}` : ''),
  })

  if (!sendMail) {
    // Supabase를 다녀오지 않아 응답이 눈에 띄게 빨라지지 않도록 조금 기다린다(시간 차이를 없애지는 못한다).
    await new Promise((resolve) => setTimeout(resolve, 200 + Math.random() * 400))
  }

  const supabase = await createResetRequestClient(sendMail)
  // redirectTo는 기본 메일 템플릿({{ .ConfirmationURL }})일 때만 쓰인다. 바꾼 템플릿은 {{ .SiteURL }}로 바로 온다.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}${PASSWORD_RESET_CONFIRM_PATH}`,
  })
  if (error) {
    console.error('[Password Reset] request failed:', error.code ?? error.status)
  }
  return resolveResetRequestOutcome(error)
}

// 복구 세션에서 새 비밀번호 저장. 성공하면 모든 기기에서 로그아웃시키고 로그인 화면으로 보낸다.
export async function updateRecoveredPassword(formData: FormData) {
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  const supabase = await createClient()
  const cookieStore = await cookies()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(PASSWORD_RESET_REQUEST_PATH)
  }
  // 복구 표시는 화면용 표시다(서명 없음, src/lib/password-reset.ts 주석 참고). 지금 세션에서 만든 표시인지만 본다.
  const { data: { session } } = await supabase.auth.getSession()
  const sessionKey = resolveRecoverySessionKey(session?.access_token, user.id)
  if (!isRecoveryMarkerValid(cookieStore.get(PASSWORD_RECOVERY_COOKIE)?.value, sessionKey)) {
    redirect(PASSWORD_RESET_REQUEST_PATH)
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('is_admin, provider')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) {
    return { success: false as const, error: PASSWORD_RESET_TEMPORARY_ERROR_MESSAGE }
  }
  const blockReason = getPasswordResetBlockReason(user.email, profile)
  if (blockReason) {
    return { success: false as const, error: PASSWORD_RESET_BLOCK_MESSAGES[blockReason] }
  }

  const passwordError = validateNewPassword(password, confirmPassword)
  if (passwordError) {
    return { success: false as const, error: passwordError }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.error('[Password Reset] update failed:', error.code ?? error.status)
    return { success: false as const, error: describePasswordUpdateError(error) }
  }

  cookieStore.delete(PASSWORD_RECOVERY_COOKIE)
  const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' })
  if (signOutError) {
    console.error('[Password Reset] sign out failed:', signOutError.code ?? signOutError.status)
  }
  redirect(PASSWORD_RESET_DONE_LOGIN_PATH)
}
