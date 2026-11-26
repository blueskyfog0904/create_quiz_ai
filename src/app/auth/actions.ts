'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { isAdminAccountEmail } from '@/lib/admin-accounts-shared'
import {
  describeSignupError,
  getConsentErrorMessage,
  isSignupResendIntervalError,
  parseConsentSubmission,
} from '@/lib/signup-consent'
import { recordUserConsents, validateConsentSubmission } from '@/lib/signup-consent-server'
import { ACCOUNT_BLOCKED_LOGIN_ERROR, AUTH_USER_BANNED_CODE, MEMBER_SUSPENSION_FALLBACK_TEXTS } from '@/lib/member-suspension'
import { getMemberSuspensionPolicyCached } from '@/lib/member-suspension-policy-server'

// 12번 5-3: 로그인 차단 안내 문구(정책 texts.loginBlocked, 읽지 못하면 코드 대체 문구). 로그인 화면이 카카오 콜백(?error=account_blocked) 때도 부른다.
export async function getAccountBlockedNotice() {
  const policy = await getMemberSuspensionPolicyCached()
  return policy?.texts.loginBlocked ?? MEMBER_SUSPENSION_FALLBACK_TEXTS.loginBlocked
}

export async function login(formData: FormData) {
  console.log('--------------------------------------------------')
  console.log('[Login Action] Started')

  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // 이메일 등 개인정보는 로그에 남기지 않는다
  console.log('[Login Action] Attempting login')

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error('[Login Action] Supabase Error:', error.message)

    // 12번: 로그인 차단(인증 서버 오류 코드 user_banned). 영어 원문을 비교하거나 보이지 않는다.
    if (error.code === AUTH_USER_BANNED_CODE) {
      return { success: false, code: ACCOUNT_BLOCKED_LOGIN_ERROR, error: await getAccountBlockedNotice() }
    }

    // Check if the error is due to unconfirmed email
    if (error.message === 'Email not confirmed') {
      return {
        success: false,
        error: '이메일 인증이 완료되지 않았습니다. 이메일을 확인하여 인증 링크를 클릭해주세요.',
        needConfirmation: true
      }
    }

    return { success: false, error: error.message }
  }

  if (data.session) {
    console.log('[Login Action] Success - Session created, User ID:', data.user?.id)
    revalidatePath('/', 'layout')
    return { success: true }
  } else {
    console.warn('[Login Action] No session returned')
    return { success: false, error: '세션을 생성할 수 없습니다.' }
  }
}

export async function signup(formData: FormData) {
  console.log('--------------------------------------------------')
  console.log('[Signup Action] Started')

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  // Extract profile fields
  const phone = formData.get('phone') as string

  // 이메일·휴대폰 등 개인정보는 로그에 남기지 않는다
  console.log('[Signup Action] Data received')

  if (!email || !password || !phone) {
    return { success: false as const, error: '이메일, 비밀번호, 휴대폰 번호를 모두 입력해주세요.' }
  }

  // 관리자 ID용 내부 도메인은 일반 회원가입에서 선점할 수 없다
  if (isAdminAccountEmail(email)) {
    return { success: false as const, error: '사용할 수 없는 이메일 주소입니다.' }
  }

  // 약관 동의: 계정을 만들기 전에 DB 와 같은 규칙으로 검사한다(필수 누락·바뀐 항목이면 계정을 만들지 않는다).
  const consents = parseConsentSubmission(formData.get('consents'))
  if (!consents) {
    return { success: false as const, error: getConsentErrorMessage('CONSENT_INPUT_INVALID'), consentCode: 'CONSENT_INPUT_INVALID' }
  }
  const consentError = await validateConsentSubmission(consents)
  if (consentError) {
    return { success: false as const, error: getConsentErrorMessage(consentError), consentCode: consentError }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        phone: phone || null,
        provider: 'email'
      }
    }
  })

  // 새 계정·이미 있는 이메일·미인증 기존 계정 세 경우의 응답 모양을 같게 둔다(계정이 있는지 드러내지 않는다).
  const successResult = {
    success: true as const,
    data: { email, phone },
  }

  if (error) {
    if (isSignupResendIntervalError(error.message)) {
      console.warn('[Signup Action] resend interval limit (treated as success)')
      return successResult
    }
    console.error('[Signup Action] Supabase Error:', error.message)
    return { success: false as const, error: describeSignupError(error.message) }
  }

  // 이미 인증된 이메일이면 identities 가 빈 가짜 사용자가 온다 — 기록하지 않는다.
  // 기록 조건(미인증 이메일 계정, 재가입이면 선택 철회만)은 DB 함수가 다시 판정한다. 기록 실패는 로그만(첫 로그인 동의 화면이 받는다).
  const hasEmailIdentity = (data.user?.identities ?? []).some((identity) => identity.provider === 'email')
  if (data.user && hasEmailIdentity) {
    const recorded = await recordUserConsents(data.user.id, consents, 'email_signup')
    if (!recorded.ok) {
      console.warn('[Signup Action] consent record skipped', { code: recorded.code })
    }
  }

  console.log('[Signup Action] Completed')
  return successResult
}
