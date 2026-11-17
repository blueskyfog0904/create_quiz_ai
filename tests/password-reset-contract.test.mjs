import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { load } from './helpers/market-images-harness.mjs'

// docs/admin-implementation-workplan.md W3-7a: 회원 비밀번호 재설정
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const adminShared = load('src/lib/admin-accounts-shared.ts')
const reset = load('src/lib/password-reset.ts', { '@/lib/admin-accounts-shared': adminShared })

const loginPage = read('src/app/(auth)/login/page.tsx')
const forgotPage = read('src/app/(auth)/forgot-password/page.tsx')
const forgotForm = read('src/app/(auth)/forgot-password/forgot-password-form.tsx')
const resetPage = read('src/app/(auth)/reset-password/page.tsx')
const resetForm = read('src/app/(auth)/reset-password/reset-password-form.tsx')
const actions = read('src/app/auth/password-reset-actions.ts')
const confirmRoute = read('src/app/auth/confirm/route.ts')
const callbackRoute = read('src/app/auth/callback/route.ts')
const setupDoc = read('docs/password-reset-setup.md')

test('로그인 화면에 비밀번호 찾기 링크와 변경 완료 안내가 있다', () => {
  assert.match(loginPage, /<Link href="\/forgot-password"[^>]*>\s*비밀번호를 잊으셨나요\?\s*<\/Link>/)
  assert.match(loginPage, /searchParams\.get\('reset'\) === 'done'/)
  assert.equal(reset.PASSWORD_RESET_DONE_LOGIN_PATH, '/login?reset=done')
})

test('요청 이메일: 형식이 틀리거나 관리자 내부 도메인이면 받지 않는다', () => {
  assert.equal(reset.normalizeResetEmail('  User@Example.COM '), 'user@example.com')
  assert.equal(reset.normalizeResetEmail(null), '')
  assert.equal(reset.checkResetRequestEmail('user@example.com'), null)
  assert.equal(reset.checkResetRequestEmail(''), reset.PASSWORD_RESET_INVALID_EMAIL_MESSAGE)
  assert.equal(reset.checkResetRequestEmail('no-at-sign'), reset.PASSWORD_RESET_INVALID_EMAIL_MESSAGE)
  assert.equal(reset.checkResetRequestEmail('a b@example.com'), reset.PASSWORD_RESET_INVALID_EMAIL_MESSAGE)
  assert.equal(
    reset.checkResetRequestEmail(`master@${adminShared.ADMIN_ACCOUNT_EMAIL_DOMAIN}`),
    reset.PASSWORD_RESET_BLOCKED_EMAIL_MESSAGE
  )
})

test('카카오 가입 계정과 관리자 계정에는 메일을 보내지 않는다(안내는 같다)', () => {
  assert.equal(reset.shouldSkipResetMail([]), false, '가입되지 않은 주소는 Supabase에 그대로 넘긴다')
  assert.equal(reset.shouldSkipResetMail([{ provider: 'email', is_admin: false }]), false)
  assert.equal(reset.shouldSkipResetMail([{ provider: 'email', is_admin: null }]), false)
  assert.equal(reset.shouldSkipResetMail([{ provider: 'kakao', is_admin: false }]), true)
  assert.equal(reset.shouldSkipResetMail([{ provider: 'email', is_admin: true }]), true)
})

test('요청 결과: 가입 여부가 드러나지 않게 같은 안내, 요청 과다는 한국어 오류', () => {
  const sent = reset.resolveResetRequestOutcome(null)
  assert.deepEqual(sent, { success: true, message: reset.PASSWORD_RESET_REQUEST_NOTICE })
  // 메일 발송 한도는 가입된 주소에서만 나므로 오류로 보이지 않는다
  assert.deepEqual(reset.resolveResetRequestOutcome({ code: 'over_email_send_rate_limit', status: 429 }), sent)
  assert.deepEqual(reset.resolveResetRequestOutcome({ code: 'over_request_rate_limit', status: 429 }), {
    success: false,
    error: reset.PASSWORD_RESET_RATE_LIMIT_MESSAGE,
  })
  assert.deepEqual(reset.resolveResetRequestOutcome({ status: 429 }), {
    success: false,
    error: reset.PASSWORD_RESET_RATE_LIMIT_MESSAGE,
  })
  assert.deepEqual(reset.resolveResetRequestOutcome({ code: 'unexpected_failure', status: 500 }), {
    success: false,
    error: reset.PASSWORD_RESET_TEMPORARY_ERROR_MESSAGE,
  })
  assert.match(reset.PASSWORD_RESET_REQUEST_NOTICE, /가입된 계정이 있으면/)
  assert.match(reset.PASSWORD_RESET_REQUEST_NOTICE, /카카오/)
  assert.match(reset.PASSWORD_RESET_RATE_LIMIT_MESSAGE, /[가-힣]/)
  // Supabase 오류 문구(영문)를 그대로 내보내지 않는다
  assert.doesNotMatch(actions, /error\.message/)
})

test('요청 액션은 서버에서 resetPasswordForEmail을 부르고 확인 route를 돌아올 곳으로 준다', () => {
  assert.match(actions, /^'use server'/)
  assert.match(actions, /checkResetRequestEmail\(email\)/)
  assert.match(actions, /supabase\.auth\.resetPasswordForEmail\(email, \{\s+redirectTo: `\$\{origin\}\$\{PASSWORD_RESET_CONFIRM_PATH\}`/)
  assert.equal(actions.match(/resetPasswordForEmail\(/g).length, 1, '보내는 경우와 건너뛰는 경우가 같은 호출을 지난다')
  assert.match(actions, /return resolveResetRequestOutcome\(error\)/)
  assert.match(actions, /envSiteUrl: process\.env\.NEXT_PUBLIC_SITE_URL/)
  assert.doesNotMatch(actions, /summersuninst/, '사이트 주소를 코드에 적지 않는다')
  assert.match(forgotForm, /requestPasswordReset\(formData\)/)
  assert.match(forgotPage, /getRequestAuthUserId\(\)/)
})

test('메일에 실리는 사이트 주소는 환경변수가 먼저, 없을 때만 요청 헤더', () => {
  const fallbackOrigin = 'http://localhost:4000'
  assert.equal(
    reset.resolveResetMailOrigin({ forwardedHost: 'evil.example', forwardedProto: 'https', envSiteUrl: 'https://env.example.com/', fallbackOrigin }),
    'https://env.example.com',
    'x-forwarded-host가 달라도 환경변수 주소'
  )
  assert.equal(
    reset.resolveResetMailOrigin({ forwardedHost: 'www.example.com, proxy', forwardedProto: 'HTTPS', envSiteUrl: ' ', fallbackOrigin }),
    'https://www.example.com'
  )
  assert.equal(reset.resolveResetMailOrigin({ forwardedHost: 'www.example.com', forwardedProto: 'javascript', fallbackOrigin }), fallbackOrigin)
  assert.equal(reset.resolveResetMailOrigin({ fallbackOrigin }), fallbackOrigin)
})

test('"계속" POST의 출처 판정: 같은 사이트만 받는다', () => {
  const requestUrl = 'https://www.example.com/auth/confirm'
  const trusted = (input) => reset.isTrustedFormPostOrigin({ requestUrl, ...input })
  // 같은 사이트
  assert.equal(trusted({ origin: 'https://www.example.com' }), true)
  assert.equal(trusted({ origin: 'https://www.example.com', secFetchSite: 'same-origin' }), true)
  // 다른 사이트
  assert.equal(trusted({ origin: 'https://evil.example' }), false)
  assert.equal(trusted({ origin: 'https://evil.example', secFetchSite: 'same-origin' }), false, 'Origin이 있으면 Origin으로 판정')
  assert.equal(trusted({ origin: 'http://www.example.com' }), false, '프로토콜이 다르면 다른 출처')
  assert.equal(trusted({ origin: 'https://www.example.com.evil.example' }), false)
  // www 유무: 요청이 들어온 주소와 환경변수 주소만 받는다
  assert.equal(trusted({ origin: 'https://example.com' }), false)
  assert.equal(trusted({ origin: 'https://example.com', envSiteUrl: 'https://example.com/' }), true)
  assert.equal(
    reset.isTrustedFormPostOrigin({ origin: 'https://example.com', requestUrl: 'https://example.com/auth/confirm', envSiteUrl: 'https://www.example.com' }),
    true,
    '폼의 action이 상대 경로라 www 없는 주소로 들어온 화면의 POST는 같은 주소로 온다'
  )
  // Origin이 없거나 null이면 Sec-Fetch-Site가 same-origin일 때만
  assert.equal(trusted({}), false, '둘 다 없으면 거부')
  assert.equal(trusted({ secFetchSite: 'same-origin' }), true)
  assert.equal(trusted({ secFetchSite: 'same-site' }), false)
  assert.equal(trusted({ secFetchSite: 'cross-site' }), false)
  assert.equal(trusted({ secFetchSite: 'none' }), false)
  assert.equal(trusted({ origin: 'null', secFetchSite: 'cross-site' }), false)
  assert.equal(trusted({ origin: 'null', secFetchSite: 'same-origin' }), true)
  assert.equal(trusted({ origin: 'null' }), false)
  assert.equal(reset.isTrustedFormPostOrigin({ origin: 'https://a.example', requestUrl: 'not a url', envSiteUrl: 'also bad' }), false)
})

test('메일 링크의 token_hash는 type=recovery이고 모양이 맞을 때만 받는다', () => {
  const tokenHash = `pkce_${'a1b2c3d4'.repeat(7)}`
  assert.equal(reset.parseRecoveryTokenHash(tokenHash, 'recovery'), tokenHash)
  assert.equal(reset.parseRecoveryTokenHash(tokenHash, 'signup'), null)
  assert.equal(reset.parseRecoveryTokenHash(tokenHash, undefined), null)
  assert.equal(reset.parseRecoveryTokenHash([tokenHash, tokenHash], 'recovery'), null)
  assert.equal(reset.parseRecoveryTokenHash('short', 'recovery'), null)
  assert.equal(reset.parseRecoveryTokenHash(`${tokenHash}"><script>`, 'recovery'), null)
  assert.equal(reset.parseRecoveryTokenHash(null, 'recovery'), null)
})

test('확인 route는 정해진 경로로만 보낸다(열린 리다이렉트 없음)', () => {
  assert.equal(reset.buildPasswordResetRedirectPath(), '/reset-password')
  assert.equal(reset.buildPasswordResetRedirectPath(null), '/reset-password')
  for (const code of Object.keys(reset.PASSWORD_RESET_ERROR_MESSAGES)) {
    assert.equal(reset.buildPasswordResetRedirectPath(code), `/reset-password?error=${code}`)
  }
  // 주소의 error 값은 아는 것만 쓴다
  assert.equal(reset.resolvePasswordResetError('invalid_link'), 'invalid_link')
  assert.equal(reset.resolvePasswordResetError('other_browser'), 'other_browser')
  assert.equal(reset.resolvePasswordResetError('admin'), 'admin')
  assert.equal(reset.resolvePasswordResetError('kakao'), 'kakao')
  for (const value of ['https://evil.example', '//evil.example', 'toString', '__proto__', '', undefined, ['admin']]) {
    assert.equal(reset.resolvePasswordResetError(value), null)
  }
  // route는 next·redirect_to 같은 값을 읽지 않는다
  assert.doesNotMatch(confirmRoute, /['"`](next|redirect_to|redirectTo|returnTo)['"`]/)
})

// 확인 route를 가짜 Supabase·쿠키로 실제 실행한다.
function loadConfirmRoute({ verifyOtp, exchangeCodeForSession, profile = { is_admin: false }, cookieNames = [] } = {}) {
  const calls = { verifyOtp: [], exchange: [], signOut: [], cookies: [] }
  const profileQueries = []
  const supabase = {
    auth: {
      verifyOtp: async (params) => { calls.verifyOtp.push(params); return verifyOtp(params) },
      exchangeCodeForSession: async (code) => { calls.exchange.push(code); return exchangeCodeForSession(code) },
      signOut: async (options) => { calls.signOut.push(options); return { error: null } },
    },
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => {
          profileQueries.push({ table, columns, column, value })
          return { maybeSingle: async () => ({ data: profile, error: null }) }
        },
      }),
    }),
  }
  const route = load('src/app/auth/confirm/route.ts', {
    'next/headers': {
      cookies: async () => ({
        getAll: () => cookieNames.map((name) => ({ name, value: 'x' })),
        set: (name, value, options) => calls.cookies.push({ name, value, options }),
      }),
    },
    'next/server': { NextResponse: { redirect: (url, status) => ({ location: String(url), status }) } },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/password-reset': reset,
  })
  return { route, calls, profileQueries }
}

const SITE = 'https://www.example.com'
const TOKEN_HASH = `pkce_${'a1b2c3d4'.repeat(7)}`
const postRequest = (fields, query = '', headers = { origin: SITE }) =>
  new Request(`${SITE}/auth/confirm${query}`, { method: 'POST', body: new URLSearchParams(fields), headers })
const user = { id: 'user-1', email: 'user@example.com' }
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
const session = { access_token: jwt({ sub: 'user-1', session_id: 'session-1' }) }

test('확인 route 실행: 어떤 값을 붙여도 같은 사이트의 정해진 경로로만 간다', async () => {
  const ok = { data: { user, session, redirectType: 'PASSWORD_RECOVERY' }, error: null }
  const evil = 'https://evil.example/steal'
  const query = `?next=${encodeURIComponent(evil)}&redirect_to=${encodeURIComponent(evil)}&returnTo=//evil.example`

  const post = loadConfirmRoute({ verifyOtp: async () => ok })
  const posted = await post.route.POST(postRequest({ token_hash: TOKEN_HASH, type: 'recovery', next: evil, redirect_to: evil }, query))
  assert.deepEqual(posted, { location: `${SITE}/reset-password`, status: 303 })
  assert.deepEqual(post.calls.verifyOtp, [{ token_hash: TOKEN_HASH, type: 'recovery' }])
  assert.equal(post.calls.cookies.length, 1)
  assert.equal(post.calls.cookies[0].name, reset.PASSWORD_RECOVERY_COOKIE)
  assert.equal(reset.isRecoveryMarkerValid(post.calls.cookies[0].value, 'session-1'), true, '표시는 지금 세션의 session_id에 묶인다')
  assert.equal(reset.isRecoveryMarkerValid(post.calls.cookies[0].value, 'session-2'), false)
  assert.deepEqual(post.profileQueries, [{ table: 'profiles', columns: 'is_admin, provider', column: 'id', value: 'user-1' }], '프로필은 사용자 id로 읽는다')
  assert.equal(post.calls.cookies[0].options.httpOnly, true)
  assert.equal(post.calls.cookies[0].options.secure, true)

  const get = loadConfirmRoute({ exchangeCodeForSession: async () => ok, cookieNames: ['sb-x-auth-token-code-verifier'] })
  assert.deepEqual(await get.route.GET(new Request(`${SITE}/auth/confirm${query}&code=abc`)), { location: `${SITE}/reset-password`, status: 303 })
  assert.deepEqual(await get.route.GET(new Request(`${SITE}/auth/confirm${query}`)), { location: `${SITE}/forgot-password`, status: 303 })
  assert.deepEqual(
    await get.route.GET(new Request(`${SITE}/auth/confirm${query}&error=access_denied&error_code=otp_expired`)),
    { location: `${SITE}/reset-password?error=invalid_link`, status: 303 }
  )
})

test('확인 route 실행: 잘못된·만료된 링크, 다른 브라우저, 재설정이 아닌 코드', async () => {
  const failed = { data: { user: null, session: null }, error: { code: 'otp_expired' } }

  // 모양이 틀리거나 type이 다르면 Supabase를 부르지 않는다
  const bad = loadConfirmRoute({ verifyOtp: async () => failed })
  for (const fields of [{}, { token_hash: TOKEN_HASH }, { token_hash: TOKEN_HASH, type: 'signup' }, { token_hash: 'x', type: 'recovery' }]) {
    assert.deepEqual(await bad.route.POST(postRequest(fields)), { location: `${SITE}/reset-password?error=invalid_link`, status: 303 })
  }
  assert.equal(bad.calls.verifyOtp.length, 0)

  // 만료·이미 쓴 링크
  assert.deepEqual(
    await bad.route.POST(postRequest({ token_hash: TOKEN_HASH, type: 'recovery' })),
    { location: `${SITE}/reset-password?error=invalid_link`, status: 303 }
  )
  assert.equal(bad.calls.cookies.length, 0)

  // 기본 템플릿 링크를 요청한 브라우저가 아닌 곳에서 연 경우(code verifier 쿠키 없음)
  const other = loadConfirmRoute({ exchangeCodeForSession: async () => failed })
  assert.deepEqual(
    await other.route.GET(new Request(`${SITE}/auth/confirm?code=abc`)),
    { location: `${SITE}/reset-password?error=other_browser`, status: 303 }
  )
  const same = loadConfirmRoute({ exchangeCodeForSession: async () => failed, cookieNames: ['sb-x-auth-token-code-verifier'] })
  assert.deepEqual(
    await same.route.GET(new Request(`${SITE}/auth/confirm?code=abc`)),
    { location: `${SITE}/reset-password?error=invalid_link`, status: 303 }
  )

  // 재설정 요청으로 만든 코드가 아니면 새 비밀번호 화면을 열지 않는다
  const oauth = loadConfirmRoute({
    exchangeCodeForSession: async () => ({ data: { user, session, redirectType: null }, error: null }),
    cookieNames: ['sb-x-auth-token-code-verifier'],
  })
  assert.deepEqual(await oauth.route.GET(new Request(`${SITE}/auth/confirm?code=abc`)), { location: `${SITE}/forgot-password`, status: 303 })
  assert.equal(oauth.calls.cookies.length, 0)
})

test('확인 route 실행: 다른 사이트에서 보낸 POST는 Supabase를 부르지 않고 거부한다', async () => {
  const ok = { data: { user, session }, error: null }
  const fields = { token_hash: TOKEN_HASH, type: 'recovery' }
  const rejected = { location: `${SITE}/reset-password?error=untrusted_origin`, status: 303 }

  const guarded = loadConfirmRoute({ verifyOtp: async () => ok })
  assert.deepEqual(await guarded.route.POST(postRequest(fields, '', { origin: 'https://evil.example' })), rejected)
  assert.deepEqual(await guarded.route.POST(postRequest(fields, '', {})), rejected, 'Origin도 Sec-Fetch-Site도 없으면 거부')
  assert.deepEqual(await guarded.route.POST(postRequest(fields, '', { 'sec-fetch-site': 'cross-site' })), rejected)
  assert.deepEqual(await guarded.route.POST(postRequest(fields, '', { origin: 'null', 'sec-fetch-site': 'cross-site' })), rejected)
  assert.equal(guarded.calls.verifyOtp.length, 0)
  assert.equal(guarded.calls.cookies.length, 0)

  assert.deepEqual(
    await guarded.route.POST(postRequest(fields, '', { 'sec-fetch-site': 'same-origin' })),
    { location: `${SITE}/reset-password`, status: 303 }
  )
  assert.equal(guarded.calls.verifyOtp.length, 1)
})

test('확인 route 실행: 관리자·카카오 가입 계정이면 세션을 끊고 거부한다', async () => {
  const ok = (target) => async () => ({ data: { user: target, session }, error: null })
  const cases = [
    [user, { is_admin: true, provider: 'email' }, 'admin'],
    [{ id: 'admin-1', email: `master@${adminShared.ADMIN_ACCOUNT_EMAIL_DOMAIN}` }, { is_admin: false, provider: 'email' }, 'admin'],
    [user, { is_admin: false, provider: 'kakao' }, 'kakao'],
  ]
  for (const [target, profile, code] of cases) {
    const blocked = loadConfirmRoute({ verifyOtp: ok(target), profile })
    assert.deepEqual(
      await blocked.route.POST(postRequest({ token_hash: TOKEN_HASH, type: 'recovery' })),
      { location: `${SITE}/reset-password?error=${code}`, status: 303 }
    )
    assert.deepEqual(blocked.calls.signOut, [{ scope: 'local' }])
    assert.equal(blocked.calls.cookies.length, 0)
  }

  // 기본 템플릿의 ?code= 경로도 같다
  const viaCode = loadConfirmRoute({
    exchangeCodeForSession: async () => ({ data: { user, session, redirectType: 'PASSWORD_RECOVERY' }, error: null }),
    profile: { is_admin: false, provider: 'kakao' },
    cookieNames: ['sb-x-auth-token-code-verifier'],
  })
  assert.deepEqual(await viaCode.route.GET(new Request(`${SITE}/auth/confirm?code=abc`)), { location: `${SITE}/reset-password?error=kakao`, status: 303 })
  assert.deepEqual(viaCode.calls.signOut, [{ scope: 'local' }])
})

test('확인 route: GET은 토큰을 검증하지 않고, POST에서만 verifyOtp(recovery)를 부른다', () => {
  const post = confirmRoute.slice(confirmRoute.indexOf('export async function POST'), confirmRoute.indexOf('export async function GET'))
  const get = confirmRoute.slice(confirmRoute.indexOf('export async function GET'))
  assert.match(post, /parseRecoveryTokenHash\(formData\?\.get\('token_hash'\), formData\?\.get\('type'\)\)/)
  assert.match(post, /supabase\.auth\.verifyOtp\(\{ token_hash: tokenHash, type: 'recovery' \}\)/)
  assert.doesNotMatch(get, /verifyOtp|token_hash/)
  // 기본 템플릿의 ?code= 는 재설정 요청으로 만든 코드일 때만 복구 세션으로 본다
  assert.match(get, /exchangeCodeForSession\(code\)/)
  assert.match(get, /redirectType !== 'PASSWORD_RECOVERY'/)
  assert.match(get, /hasCodeVerifier \? 'invalid_link' : 'other_browser'/)
  // 기존 콜백과 겹치지 않는다
  assert.doesNotMatch(callbackRoute, /verifyOtp|token_hash|reset-password|auth\/confirm/)
  assert.doesNotMatch(confirmRoute, /signInWithPassword|signInWithOAuth/)
})

test('재설정 화면: 링크로 오면 "계속" 버튼(POST), 복구 세션이 없으면 요청 화면으로', () => {
  assert.match(resetPage, /<form method="post" action=\{PASSWORD_RESET_CONFIRM_PATH\}>/)
  assert.match(resetPage, /<input type="hidden" name="token_hash" value=\{tokenHash\} \/>/)
  assert.doesNotMatch(resetPage, /verifyOtp|exchangeCodeForSession/, '화면을 여는 것만으로는 토큰을 쓰지 않는다')
  assert.match(resetPage, /if \(!user \|\| !isRecoveryMarkerValid\(marker, resolveRecoverySessionKey\(session\?\.access_token, user\.id\)\)\) \{\s+redirect\(PASSWORD_RESET_REQUEST_PATH\)/)
  assert.match(resetPage, /재설정 메일 다시 요청하기/)
  // 다른 사이트로는 주소(token_hash)를 보내지 않되, 같은 사이트로 보내는 POST의 Origin은 유지한다
  assert.match(resetPage, /referrer: 'same-origin'/)
  assert.equal(reset.PASSWORD_RESET_REQUEST_PATH, '/forgot-password')
  assert.equal(reset.PASSWORD_RESET_CONFIRM_PATH, '/auth/confirm')
})

test('복구 표시(화면용, 서명 없음): 표시를 만든 세션에서 30분 동안만 맞는 것으로 본다', () => {
  const now = 1_800_000_000_000
  const marker = reset.buildRecoveryMarker('session-1', now)
  assert.equal(reset.isRecoveryMarkerValid(marker, 'session-1', now), true)
  assert.equal(reset.isRecoveryMarkerValid(marker, 'session-1', now + 30 * 60 * 1000), true)
  assert.equal(reset.isRecoveryMarkerValid(marker, 'session-1', now + 30 * 60 * 1000 + 1), false)
  assert.equal(reset.isRecoveryMarkerValid(marker, 'session-1', now - 1), false)
  assert.equal(reset.isRecoveryMarkerValid(marker, 'session-2', now), false, '같은 계정이라도 다른 세션이면 맞지 않는다')
  assert.equal(reset.isRecoveryMarkerValid(marker, null, now), false)
  assert.equal(reset.isRecoveryMarkerValid(undefined, 'session-1', now), false)
  assert.equal(reset.isRecoveryMarkerValid('session-1', 'session-1', now), false)
  assert.equal(reset.isRecoveryMarkerValid('session-1:abc', 'session-1', now), false)

  // 세션 키: 액세스 토큰의 session_id, 읽을 수 없으면 사용자 id
  assert.equal(reset.resolveRecoverySessionKey(jwt({ session_id: 'session-1' }), 'user-1'), 'session-1')
  assert.equal(reset.resolveRecoverySessionKey(jwt({ sub: 'user-1' }), 'user-1'), 'uid:user-1')
  assert.equal(reset.resolveRecoverySessionKey('not-a-jwt', 'user-1'), 'uid:user-1')
  assert.equal(reset.resolveRecoverySessionKey(undefined, 'user-1'), 'uid:user-1')
  const fallback = reset.buildRecoveryMarker(reset.resolveRecoverySessionKey(null, 'user-1'), now)
  assert.equal(reset.isRecoveryMarkerValid(fallback, 'uid:user-1', now), true)
  // 이 표시가 보안 경계가 아니라는 점을 코드에 적어 둔다
  assert.match(read('src/lib/password-reset.ts'), /서명이 없어[^\n]*보안 경계가 아니다/)
})

test('관리자·카카오 가입 계정 판정', () => {
  const adminEmail = `master@${adminShared.ADMIN_ACCOUNT_EMAIL_DOMAIN}`
  assert.equal(reset.getPasswordResetBlockReason(adminEmail, { is_admin: false }), 'admin')
  assert.equal(reset.getPasswordResetBlockReason(adminEmail, null), 'admin')
  assert.equal(reset.getPasswordResetBlockReason('user@example.com', { is_admin: true, provider: 'email' }), 'admin')
  assert.equal(reset.getPasswordResetBlockReason('user@example.com', { is_admin: true, provider: 'kakao' }), 'admin')
  assert.equal(reset.getPasswordResetBlockReason('user@example.com', { is_admin: false, provider: 'kakao' }), 'kakao')
  assert.equal(reset.getPasswordResetBlockReason('user@example.com', { is_admin: false, provider: 'email' }), null)
  assert.equal(reset.getPasswordResetBlockReason('user@example.com', { is_admin: null, provider: null }), null)
  assert.equal(reset.getPasswordResetBlockReason(undefined, null), null)
  assert.match(reset.PASSWORD_RESET_ERROR_MESSAGES.kakao, /카카오 로그인/)
  assert.equal(reset.PASSWORD_RESET_BLOCK_MESSAGES.kakao, reset.PASSWORD_RESET_ERROR_MESSAGES.kakao)
  assert.equal(reset.PASSWORD_RESET_BLOCK_MESSAGES.admin, reset.PASSWORD_RESET_ERROR_MESSAGES.admin)
})

test('새 비밀번호 규칙은 마이페이지 변경과 같다(일치, 최소 6자)', () => {
  assert.equal(reset.PASSWORD_MIN_LENGTH, 6)
  assert.equal(reset.validateNewPassword('abcdef', 'abcdef'), null)
  assert.equal(reset.validateNewPassword('abcde', 'abcde'), '비밀번호는 최소 6자 이상이어야 합니다.')
  assert.equal(reset.validateNewPassword('abcdef', 'abcdeg'), '새 비밀번호가 일치하지 않습니다.')
  const profileView = read('src/app/(solvook)/mypage/profile/_components/profile-view.tsx')
  assert.match(profileView, /newPassword\.length < 6/)
  assert.match(profileView, /비밀번호는 최소 6자 이상이어야 합니다\./)
  assert.match(reset.describePasswordUpdateError({ code: 'same_password' }), /다른 비밀번호/)
  assert.match(reset.describePasswordUpdateError({ code: 'weak_password' }), /단순/)
  assert.equal(reset.describePasswordUpdateError({ status: 429 }), reset.PASSWORD_RESET_RATE_LIMIT_MESSAGE)
  assert.match(reset.describePasswordUpdateError({ code: 'unexpected_failure' }), /잠시 후 다시/)
})

// 서버 액션을 가짜 Supabase·쿠키로 실제 실행한다. redirect는 예외로 흉내 낸다.
class RedirectSignal extends Error {
  constructor(path) { super(`redirect:${path}`); this.path = path }
}

function loadActions({
  currentUser = user,
  accessToken = session.access_token,
  profile = { is_admin: false, provider: 'email' },
  marker,
  updateError = null,
  emailProfiles = [],
  ssr,
} = {}) {
  const steps = []
  const cookieJar = new Map(marker === undefined ? [] : [[reset.PASSWORD_RECOVERY_COOKIE, marker]])
  const setCookies = []
  const profileQueries = []
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: currentUser }, error: null }),
      getSession: async () => ({ data: { session: currentUser ? { access_token: accessToken } : null }, error: null }),
      updateUser: async (attributes) => { steps.push(['updateUser', attributes]); return { data: {}, error: updateError } },
      signOut: async (options) => { steps.push(['signOut', options]); return { error: null } },
    },
    from: (table) => ({
      select: (columns) => ({
        eq: (column, value) => {
          profileQueries.push({ table, columns, column, value })
          return { maybeSingle: async () => ({ data: profile, error: null }) }
        },
      }),
    }),
  }
  const mocks = {
    'next/headers': {
      cookies: async () => ({
        get: (name) => (cookieJar.has(name) ? { name, value: cookieJar.get(name) } : undefined),
        getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
        set: (name, value, options) => { setCookies.push({ name, value, options }); cookieJar.set(name, value) },
        delete: (name) => { steps.push(['deleteCookie', name]); cookieJar.delete(name) },
      }),
      headers: async () => new Headers({ host: 'localhost:4000', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }),
    },
    'next/navigation': { redirect: (path) => { throw new RedirectSignal(path) } },
    '@/lib/supabase/server': { createClient: async () => supabase },
    '@/lib/supabase/bypass': {
      createAdminClient: () => ({ from: () => ({ select: () => ({ eq: async () => ({ data: emailProfiles, error: null }) }) }) }),
    },
    '@/lib/supabase/session-cookies': load('src/lib/supabase/session-cookies.ts'),
    '@/lib/password-reset': reset,
  }
  if (ssr) mocks['@supabase/ssr'] = ssr
  return { actions: load('src/app/auth/password-reset-actions.ts', mocks), steps, setCookies, profileQueries }
}

const passwordForm = (password = 'new-password', confirmPassword = password) => {
  const formData = new FormData()
  formData.set('password', password)
  formData.set('confirmPassword', confirmPassword)
  return formData
}
const validMarker = () => reset.buildRecoveryMarker('session-1', Date.now())
const redirectedTo = async (promise) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof RedirectSignal) return error.path
    throw error
  }
  return null
}

test('새 비밀번호 저장 실행: 복구 표시가 지금 세션과 맞지 않으면 바꾸지 않고 요청 화면으로', async () => {
  const cases = {
    '비로그인': { currentUser: null, marker: validMarker() },
    '표시 없음': {},
    '다른 사용자 id의 표시': { marker: reset.buildRecoveryMarker('uid:user-2', Date.now()) },
    '다른 세션의 표시': { marker: reset.buildRecoveryMarker('session-2', Date.now()) },
    '만료된 표시': { marker: reset.buildRecoveryMarker('session-1', Date.now() - 31 * 60 * 1000) },
    '모양이 틀린 표시': { marker: 'session-1' },
  }
  for (const [name, options] of Object.entries(cases)) {
    const { actions: loaded, steps } = loadActions(options)
    assert.equal(await redirectedTo(loaded.updateRecoveredPassword(passwordForm())), '/forgot-password', name)
    assert.deepEqual(steps, [], `${name}: updateUser를 부르지 않는다`)
  }
})

test('새 비밀번호 저장 실행: 관리자·카카오 가입 계정은 거부한다', async () => {
  const cases = [
    [{ profile: { is_admin: true, provider: 'email' } }, reset.PASSWORD_RESET_ADMIN_MESSAGE],
    [{ currentUser: { id: 'user-1', email: `master@${adminShared.ADMIN_ACCOUNT_EMAIL_DOMAIN}` } }, reset.PASSWORD_RESET_ADMIN_MESSAGE],
    [{ profile: { is_admin: false, provider: 'kakao' } }, reset.PASSWORD_RESET_KAKAO_MESSAGE],
  ]
  for (const [options, message] of cases) {
    const { actions: loaded, steps, profileQueries } = loadActions({ marker: validMarker(), ...options })
    assert.deepEqual(await loaded.updateRecoveredPassword(passwordForm()), { success: false, error: message })
    assert.deepEqual(steps, [])
    assert.deepEqual(profileQueries, [{ table: 'profiles', columns: 'is_admin, provider', column: 'id', value: 'user-1' }])
  }
})

test('새 비밀번호 저장 실행: 규칙에 맞지 않거나 Supabase가 거절하면 한국어 오류, 로그아웃하지 않는다', async () => {
  const short = loadActions({ marker: validMarker() })
  assert.deepEqual(await short.actions.updateRecoveredPassword(passwordForm('abcde')), { success: false, error: '비밀번호는 최소 6자 이상이어야 합니다.' })
  assert.deepEqual(await short.actions.updateRecoveredPassword(passwordForm('abcdef', 'abcdeg')), { success: false, error: '새 비밀번호가 일치하지 않습니다.' })
  assert.deepEqual(short.steps, [])

  const same = loadActions({ marker: validMarker(), updateError: { code: 'same_password', status: 422 } })
  assert.deepEqual(await same.actions.updateRecoveredPassword(passwordForm()), { success: false, error: '기존 비밀번호와 다른 비밀번호를 입력해 주세요.' })
  assert.deepEqual(same.steps, [['updateUser', { password: 'new-password' }]])
})

test('새 비밀번호 저장 실행: 정상이면 updateUser → 표시 삭제 → 전체 로그아웃 → 로그인 화면', async () => {
  const { actions: loaded, steps } = loadActions({ marker: validMarker() })
  assert.equal(await redirectedTo(loaded.updateRecoveredPassword(passwordForm())), '/login?reset=done')
  assert.deepEqual(steps, [
    ['updateUser', { password: 'new-password' }],
    ['deleteCookie', reset.PASSWORD_RECOVERY_COOKIE],
    ['signOut', { scope: 'global' }],
  ])
  assert.doesNotMatch(actions, /signInWithPassword/)
  assert.match(resetForm, /updateRecoveredPassword\(formData\)/)
  assert.match(resetForm, /validateNewPassword\(password, confirmPassword\)/)
})

// 요청 액션을 진짜 @supabase/ssr로 실행한다. 밖으로 나가는 요청은 전역 fetch를 바꿔 잡는다(실제 전송 없음).
async function runResetRequest(email, emailProfiles) {
  const saved = {
    fetch: globalThis.fetch,
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    site: process.env.NEXT_PUBLIC_SITE_URL,
  }
  const sent = []
  globalThis.fetch = async (input, init) => {
    sent.push({ url: String(input instanceof Request ? input.url : input), body: init?.body ? JSON.parse(init.body) : null })
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.example.com'
  try {
    const { actions: loaded, setCookies } = loadActions({ emailProfiles })
    const formData = new FormData()
    formData.set('email', email)
    const result = await loaded.requestPasswordReset(formData)
    return { result, sent, setCookies }
  } finally {
    globalThis.fetch = saved.fetch
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', saved.url], ['NEXT_PUBLIC_SUPABASE_ANON_KEY', saved.key], ['NEXT_PUBLIC_SITE_URL', saved.site]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('요청 액션 실행: 보내는 경우와 건너뛰는 경우의 응답·쿠키 모양이 같고, 건너뛸 때는 Supabase로 아무것도 보내지 않는다', async () => {
  const normal = await runResetRequest(' User@Example.com ', [{ provider: 'email', is_admin: false }])
  const unknown = await runResetRequest('nobody@example.com', [])
  const kakao = await runResetRequest('kakao@example.com', [{ provider: 'kakao', is_admin: false }])
  const admin = await runResetRequest('owner@example.com', [{ provider: 'email', is_admin: true }])

  const notice = { success: true, message: reset.PASSWORD_RESET_REQUEST_NOTICE }
  for (const run of [normal, unknown, kakao, admin]) {
    assert.deepEqual(run.result, notice)
    assert.deepEqual(run.setCookies.map(({ name }) => name), ['sb-project-auth-token-code-verifier'])
    assert.deepEqual(Object.keys(run.setCookies[0].options).sort(), Object.keys(normal.setCookies[0].options).sort())
    assert.equal(run.setCookies[0].value.length, normal.setCookies[0].value.length)
  }

  // 보내는 경우: recover 요청 1건. 메일에 실리는 주소는 x-forwarded-host(evil.example)가 아니라 환경변수 주소
  for (const [run, email] of [[normal, 'user@example.com'], [unknown, 'nobody@example.com']]) {
    assert.equal(run.sent.length, 1)
    const url = new URL(run.sent[0].url)
    assert.equal(url.pathname, '/auth/v1/recover')
    assert.equal(url.searchParams.get('redirect_to'), 'https://www.example.com/auth/confirm')
    assert.equal(run.sent[0].body.email, email)
  }
  // 건너뛰는 경우: 밖으로 나간 요청이 없다
  assert.deepEqual(kakao.sent, [])
  assert.deepEqual(admin.sent, [])
})

test('요청 액션 실행: 형식이 틀리거나 관리자 내부 도메인이면 쿠키도 요청도 없이 거절한다', async () => {
  for (const [email, message] of [
    ['not-an-email', reset.PASSWORD_RESET_INVALID_EMAIL_MESSAGE],
    [`master@${adminShared.ADMIN_ACCOUNT_EMAIL_DOMAIN}`, reset.PASSWORD_RESET_BLOCKED_EMAIL_MESSAGE],
  ]) {
    const run = await runResetRequest(email, [])
    assert.deepEqual(run.result, { success: false, error: message })
    assert.deepEqual(run.sent, [])
    assert.deepEqual(run.setCookies, [])
  }
})

test('설정 문서의 메일 링크는 재설정 화면으로 token_hash와 type=recovery를 보낸다', () => {
  assert.match(setupDoc, /\{\{ \.SiteURL \}\}\/reset-password\?token_hash=\{\{ \.TokenHash \}\}&(amp;)?type=recovery/)
  const workplan = read('docs/admin-implementation-workplan.md')
  assert.match(workplan, /\{\{ \.SiteURL \}\}\/reset-password\?token_hash=\{\{ \.TokenHash \}\}&type=recovery/)
})
