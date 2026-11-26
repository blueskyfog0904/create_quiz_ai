import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server.js'
import { load } from './helpers/market-images-harness.mjs'

// 출시 전 작업 순서표 4번 묶음(가입 약관 동의, 2026-11-20) — 계획 docs/plan-bundle4-signup-consent.md 18판
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const workspaceSubject = load('src/lib/workspace-subject.ts')
const consentText = load('src/lib/consent-text.ts')
const authPaths = load('src/lib/auth-paths.ts', { '@/lib/workspace-subject': workspaceSubject })
const gate = load('src/lib/consent-gate.ts', { '@/lib/workspace-subject': workspaceSubject })
const footerContent = load('src/lib/footer-content.ts')
const footerRaw = load('src/lib/footer-policy-raw.ts', { '@/lib/consent-text': consentText, '@/lib/footer-content': footerContent })
const consent = load('src/lib/signup-consent.ts', { '@/lib/consent-text': consentText })
const adminShared = load('src/lib/admin-accounts-shared.ts')
const MIGRATION = read('supabase/migrations/20261120120000_signup_consents.sql')

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

test('공백 규칙: 앞뒤의 공백 문자(탭·줄바꿈·NBSP·전각 공백·BOM)만 지우고 CRLF 는 LF 로 — DB 함수와 같은 문자 목록', () => {
  const { normalizeConsentText, isConsentTextEmpty } = consentText
  assert.equal(normalizeConsentText(' \t\n가\u00a0나\u3000\ufeff\r\n'), '가\u00a0나')
  assert.equal(normalizeConsentText('a\r\nb'), 'a\nb')
  for (const blank of ['\n', '\t', '\u00a0', '\u3000', '\ufeff', ' \n\t ', '']) {
    assert.equal(isConsentTextEmpty(blank), true, JSON.stringify(blank))
  }
  assert.equal(normalizeConsentText('내용\n'), normalizeConsentText('내용'))
  // SQL 함수도 같은 목록을 쓴다.
  for (const token of ['\\t', '\\n', '\\r', '\\v', '\\f', '\\u00a0', '\\u1680', '\\u2000-\\u200a', '\\u2028', '\\u2029', '\\u202f', '\\u205f', '\\u3000', '\\ufeff']) {
    assert.ok(MIGRATION.includes(token), token)
    assert.ok(read('src/lib/consent-text.ts').includes(token.replace(/\\/g, '\\\\')), token)
  }
  assert.match(MIGRATION, /'',\n    'g'\n  \)/)
})

test('다음 이동 주소: 해석한 결과를 다시 검사해 바깥 주소로 나가지 않고, 동의 화면은 자신·API·인증·카카오 단계로 돌아가지 않는다', () => {
  const { normalizeAuthNextPath, normalizeConsentNextPath } = authPaths
  for (const bad of ['/.//evil.com', '/./\\evil.com', '/%2e//evil.com', 'https://evil.com', '//evil.com', '/\\evil.com', '\\\\evil.com']) {
    assert.equal(normalizeAuthNextPath(bad), '/', bad)
    assert.equal(normalizeConsentNextPath(bad), '/', bad)
  }
  assert.equal(normalizeAuthNextPath('/items/1?login=success'), '/items/1?login=success')
  assert.equal(normalizeAuthNextPath('/login'), '/')
  assert.equal(normalizeAuthNextPath('/english/signup'), '/english')
  // 로그인·콜백·카카오 단계는 /consent 를 허용한다(로그인 뒤 동의 화면으로 이어지게).
  assert.equal(normalizeAuthNextPath('/consent?next=%2Fcart'), '/consent?next=%2Fcart')
  for (const loop of ['/consent', '/english/consent', '/consent/', '/api/market/cart', '/auth/callback', '/signup?provider=kakao&signup=1']) {
    assert.equal(normalizeConsentNextPath(loop), '/', loop)
  }
  assert.equal(normalizeConsentNextPath('/cart'), '/cart')
  // 네 벌이던 정규화가 공용 함수 하나로 모였다.
  assert.doesNotMatch(read('src/lib/supabase/middleware.ts'), /const normalizeInternalPath/)
  assert.doesNotMatch(read('src/app/auth/callback/route.ts'), /new URL\(trimmed, 'http:\/\/localhost'\)/)
  assert.doesNotMatch(read('src/app/(auth)/signup/signup-client.tsx'), /const normalizeInternalPath/)
  assert.match(read('src/app/auth/callback/route.ts'), /const normalizeNext = normalizeAuthNextPath/)
})

test('미들웨어 판정 규칙: 화면 GET·HEAD 만(서버 액션·미리 불러오기 제외), 동의하지 않은 회원도 써야 하는 경로는 제외', () => {
  const headers = (entries = {}) => new Headers(entries)
  assert.equal(gate.isConsentGateRequest('GET', headers()), true)
  assert.equal(gate.isConsentGateRequest('HEAD', headers()), true)
  assert.equal(gate.isConsentGateRequest('POST', headers()), false)
  assert.equal(gate.isConsentGateRequest('GET', headers({ 'next-action': 'abc' })), false)
  assert.equal(gate.isConsentGateRequest('GET', headers({ 'next-router-prefetch': '1' })), false)

  const excluded = [
    '/consent', '/login', '/signup', '/forgot-password', '/reset-password', '/auth/callback', '/terms', '/terms/service',
    '/api/market/cart', '/admin', '/admin/users', '/dashboard/admin/passages', '/preview/x', '/checkout/payapp/result',
    '/mypage/withdraw', '/mypage/payments', '/mypage/credits', '/mypage/support', '/mypage/consents', '/library', '/english/library',
    '/_next/static/x.js', '/__nextjs_original-stack-frame', '/.well-known/x', '/sample.csv', '/a.hwpx', '/robots.txt', '/x.pdf',
    '/consent/', '/english/consent',
  ]
  for (const path of excluded) {
    assert.equal(gate.isConsentGateExcludedPath(path), true, path)
  }
  for (const path of ['/', '/cart', '/items/1', '/categories/2', '/mypage', '/mypage/profile', '/pricing', '/checkout', '/english', '/library-x', '/search']) {
    assert.equal(gate.isConsentGateExcludedPath(path), false, path)
  }
  // 동의 뒤 돌아갈 주소: RSC·카카오 표시는 빼고 login=success 는 남긴다(로그인 복귀 담기·구매가 이어지게).
  assert.equal(gate.buildConsentGateNext('/items/1', '?login=success&_rsc=abc&provider=kakao&signup=1&x=2'), '/items/1?login=success&x=2')
  assert.equal(gate.buildConsentPagePath('/cart'), '/consent?next=%2Fcart')
})

function loadMiddleware({ missing = ['item'], rpcError = null, email = 'member@example.com', provider = 'email', profile = null } = {}) {
  const rpcCalls = []
  const supabase = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1', email, app_metadata: { provider, providers: [provider] } } } }),
      getSession: async () => ({ data: { session: null } }),
    },
    rpc: (name) => {
      rpcCalls.push(name)
      // 12번: 미들웨어는 get_my_member_gate 하나로 동의 부족·정지를 함께 읽는다.
      return { abortSignal: async () => ({ data: rpcError ? null : { missingRequired: missing, restriction: null }, error: rpcError }) }
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }) }) }),
  }
  const middleware = load('src/lib/supabase/middleware.ts', {
    '@supabase/ssr': {
      createServerClient: (_url, _key, options) => {
        // 토큰을 새로 고친 것처럼 세션 쿠키를 한 번 쓴다(리다이렉트 응답으로 옮겨지는지 본다).
        options.cookies.setAll([{ name: 'sb-test-auth-token', value: 'refreshed', options: { path: '/' } }])
        return supabase
      },
    },
    './session-cookies': { toSessionCookieOptions: (options) => options },
    '@/lib/workspace-subject': workspaceSubject,
    '@/lib/workspace-public-browse': { isPublicBrowseableSubjectPath: () => true },
    '@/lib/auth-paths': authPaths,
    '@/lib/admin-accounts-shared': adminShared,
    '@/lib/consent-gate': gate,
    '@/lib/member-suspension': load('src/lib/member-suspension.ts', { '@/lib/workspace-subject': workspaceSubject }),
    '@/lib/admin-features': { isAdminPathDisabled: () => false, resolveAdminFeature: () => null },
    '@/lib/site-features': { resolveSiteFeatureRoute: () => null },
    '@/lib/admin-features-server': {
      getDisabledAdminFeatures: async () => ({ ok: true, features: [] }),
      getDisabledSiteFeatures: async () => ({ ok: true, features: [] }),
      isSiteFeatureDisabled: () => false,
    },
  })
  return { middleware, rpcCalls }
}

test('미들웨어: 필수 동의가 부족한 회원의 화면 요청은 절대 주소 /consent 로 보내고 새로 고친 세션 쿠키를 옮긴다', async () => {
  const { middleware } = loadMiddleware()
  const response = await middleware.updateSession(new NextRequest('http://localhost/items/1?login=success&_rsc=1'))
  assert.equal(response.status, 307)
  const location = new URL(response.headers.get('location'))
  assert.equal(location.origin, 'http://localhost')
  assert.equal(location.pathname, '/consent')
  assert.equal(location.searchParams.get('next'), '/items/1?login=success')
  assert.equal(response.cookies.get('sb-test-auth-token')?.value, 'refreshed')
})

test('미들웨어: 판정 오류·관리자 ID·제외 경로·서버 액션은 통과(던지지 않고 로그인 쿠키도 지우지 않는다)', async () => {
  const failing = loadMiddleware({ rpcError: { code: '57014', message: 'canceling statement' } })
  const passed = await failing.middleware.updateSession(new NextRequest('http://localhost/items/1'))
  assert.notEqual(passed.status, 307)
  assert.equal(passed.cookies.get('sb-test-auth-token')?.value, 'refreshed')

  const admin = loadMiddleware({ email: 'owner01@admin.summersun.local' })
  assert.notEqual((await admin.middleware.updateSession(new NextRequest('http://localhost/items/1'))).status, 307)
  assert.deepEqual(admin.rpcCalls, [])

  const library = loadMiddleware()
  assert.notEqual((await library.middleware.updateSession(new NextRequest('http://localhost/mypage/credits'))).status, 307)
  const action = loadMiddleware()
  assert.notEqual((await action.middleware.updateSession(new NextRequest('http://localhost/items/1', { method: 'POST', headers: { 'next-action': 'x' } }))).status, 307)
  assert.deepEqual(action.rpcCalls, [])
})

test('미들웨어: 가입을 마친 카카오 회원도 판정하고, 마치지 않은 카카오 회원은 카카오 가입 단계가 먼저(약관 전문은 통과)', async () => {
  const done = loadMiddleware({ provider: 'kakao', profile: { provider: 'kakao', signup_completed: true } })
  const doneResponse = await done.middleware.updateSession(new NextRequest('http://localhost/cart'))
  assert.equal(new URL(doneResponse.headers.get('location')).pathname, '/consent')

  const incomplete = loadMiddleware({ provider: 'kakao', profile: { provider: 'kakao', signup_completed: false } })
  const step = await incomplete.middleware.updateSession(new NextRequest('http://localhost/cart?_rsc=1'))
  const stepUrl = new URL(step.headers.get('location'))
  assert.equal(stepUrl.pathname, '/signup')
  assert.equal(stepUrl.searchParams.get('next'), '/cart')
  assert.equal(step.cookies.get('sb-test-auth-token')?.value, 'refreshed')
  assert.deepEqual(incomplete.rpcCalls, [])
  const terms = await incomplete.middleware.updateSession(new NextRequest('http://localhost/terms/service'))
  assert.notEqual(terms.status, 307)

  const source = read('src/lib/supabase/middleware.ts')
  assert.equal(source.match(/await applyMemberGate\(/g).length, 2)
  assert.match(source, /abortSignal\(AbortSignal\.timeout\(MEMBER_GATE_TIMEOUT_MS\)\)/)
})

test('돈 API: 크레딧 차감·자료 구매·충전 주문을 부르는 회원 핸들러는 모두 인증 직후 동의를 확인한다(7개 — 카카오페이 주문은 9번에서 503, 상세 바로 구매는 11번에서 410 으로 막음)', () => {
  const files = walk('src/app/api').filter((path) => !path.includes('/api/admin/') && /\.ts$/.test(path))
  const guarded = []
  for (const path of files) {
    const source = readFileSync(path, 'utf8')
    if (!/deductCredits\(|runMarketCheckout\(|'prepare_payment_order'/.test(source)) continue
    for (const handler of source.split(/\nexport async function /).slice(1)) {
      const name = handler.match(/^(\w+)/)[1]
      if (!/deductCredits\(|runMarketCheckout\(|'prepare_payment_order'/.test(handler)) continue
      const consentAt = handler.indexOf('checkMemberConsentForApi(')
      assert.ok(consentAt > 0, `${path} ${name}`)
      for (const money of ['deductCredits(', 'runMarketCheckout(', "'prepare_payment_order'"]) {
        const at = handler.indexOf(money)
        if (at >= 0) assert.ok(consentAt < at, `${path} ${name}: 동의 확인이 ${money} 보다 앞`)
      }
      guarded.push(`${path.replace(/^src\/app\/api\//, '')} ${name}`)
    }
  }
  assert.deepEqual(guarded.sort(), [
    'generate/listboard-jobs/[jobId]/retry/route.ts POST',
    'generate/listboard-jobs/[jobId]/run/route.ts POST',
    'market/cart/checkout/route.ts POST',
    'payments/payapp/orders/route.ts POST',
    'questions/generate/route.ts POST',
    'questions/save-from-community/route.ts POST',
    'questions/save-from-community/route.ts PUT',
  ])
  const guard = read('src/lib/consent-guard-server.ts')
  assert.match(guard, /isAdminAccountEmail\(sessionUser\.email \?\? ''\)[\s\S]*?'ADMIN_ACCOUNT_NOT_MEMBER'[\s\S]*?rpc\('get_my_missing_required_consents'\)/)
  assert.match(guard, /block\(503, 'CONSENT_CHECK_FAILED'\)/)
  // 화면은 403 CONSENT_REQUIRED 를 받으면 동의 화면으로 보낸다(두 응답 모양 모두).
  const client = load('src/lib/consent-client.ts', { '@/lib/consent-gate': gate })
  assert.equal(client.readConsentBlockCode(403, { code: 'CONSENT_REQUIRED' }), 'CONSENT_REQUIRED')
  assert.equal(client.readConsentBlockCode(403, { error: { code: 'CONSENT_REQUIRED' } }), 'CONSENT_REQUIRED')
  assert.equal(client.readConsentBlockCode(400, { code: 'CONSENT_REQUIRED' }), null)
  // 11번: 상품 상세는 구매하지 않으므로(담기만) 결제하는 두 화면만 본다.
  for (const path of ['src/app/checkout/checkout-client.tsx', 'src/app/(solvook)/cart/_components/cart-view.tsx']) {
    assert.match(read(path), /redirectToConsentIfRequired\(response\.status, /, path)
  }
})

test('이메일 가입: 검사 → signUp → 이메일 identity 가 있을 때만 기록, 응답 모양은 세 경우 같고 처리 결과 틀은 쓰지 않는다', () => {
  const action = read('src/app/auth/actions.ts')
  const signup = action.slice(action.indexOf('export async function signup('))
  const order = ['parseConsentSubmission(', 'validateConsentSubmission(', 'auth.signUp(', "identity.provider === 'email'", "recordUserConsents(data.user.id, consents, 'email_signup')"]
  let last = -1
  for (const step of order) {
    const at = signup.indexOf(step)
    assert.ok(at > last, step)
    last = at
  }
  assert.match(signup, /isSignupResendIntervalError\(error\.message\)\) \{[\s\S]*?return successResult/)
  assert.doesNotMatch(signup, /return \{ success: false as const, error: error\.message/)
  const client = read('src/app/(auth)/signup/signup-client.tsx')
  assert.match(client, /setEmailReceipts\([\s\S]*?formatOptionalReceipt\(consentForm\.texts\.optionalReceiptTemplate/)
  assert.doesNotMatch(client.slice(client.indexOf('async function handleSignup'), client.indexOf('async function handleKakaoSignup')), /formatOptionalResult/)

  assert.equal(consent.isSignupResendIntervalError('For security purposes, you can only request this after 52 seconds.'), true)
  assert.equal(consent.isSignupResendIntervalError('Email rate limit exceeded'), false)
  assert.equal(consent.isSignupResendIntervalError('Please wait before requesting again'), false)
  assert.equal(consent.describeSignupError('Email rate limit exceeded'), '지금은 가입 메일을 보낼 수 없습니다. 잠시 후 다시 시도해 주세요.')
})

test('카카오 가입: 필수 미체크면 OAuth 로 넘어가지 않고, 완료는 동의 기록과 한 트랜잭션, 결과 안내는 DB 기록으로', () => {
  const client = read('src/app/(auth)/signup/signup-client.tsx')
  const kakao = client.slice(client.indexOf('async function handleKakaoSignup'), client.indexOf('async function handleKakaoProfileSubmit'))
  assert.ok(kakao.indexOf('ensureRequiredConsents()') < kakao.indexOf('writeKakaoConsentDraft('))
  assert.ok(kakao.indexOf('writeKakaoConsentDraft(') < kakao.indexOf('signInWithOAuth('))
  assert.match(client, /consents: buildConsentSubmission\(consentItems, consentChecked\)/)
  assert.match(client, /result\.consentResults[\s\S]*?formatOptionalResult\(consentForm\.texts\.optionalResultTemplate/)
  const route = read('src/app/api/profile/route.ts')
  assert.match(route, /consents: z\.array\([\s\S]*?\.min\(1\)/)
  assert.match(route, /rpc\('complete_kakao_signup_with_consents'/)
  assert.doesNotMatch(route, /signup_completed: true/)
  assert.match(route, /\(await getRequestAuthUserId\(\)\) !== user\.id/)

  const { parseKakaoConsentDraft, serializeKakaoConsentDraft } = consent
  const items = [{ id: 'a', version: 1 }, { id: 'b', version: 2 }]
  const draft = serializeKakaoConsentDraft([{ item_id: 'a', version: 1, agreed: true }, { item_id: 'b', version: 2, agreed: false }], 1000)
  assert.deepEqual(parseKakaoConsentDraft(draft, items, 1000 + 60_000), { a: true, b: false })
  assert.equal(parseKakaoConsentDraft(draft, items, 1000 + 31 * 60_000), null)
  assert.equal(parseKakaoConsentDraft(draft, [{ id: 'a', version: 2 }, { id: 'b', version: 2 }], 2000), null)
})

test('가입 취소·동의 거부 로그아웃 route: 출처 검사, 서버 판정 뒤에만 삭제, 결과와 상관없이 로그인 쿠키를 지운다', () => {
  const cancel = read('src/app/api/auth/cancel-signup/route.ts')
  assert.match(cancel, /isTrustedFormPostOrigin\(readFormPostOriginInput\(request\)\)/)
  assert.match(cancel, /requestUserId !== user\.id/)
  assert.ok(cancel.indexOf("rpc('cancel_incomplete_kakao_signup'") < cancel.indexOf('deleteUser('))
  assert.equal(cancel.match(/rpc\('cancel_incomplete_kakao_signup'/g).length, 2)
  const logout = read('src/app/api/auth/consent-logout/route.ts')
  assert.match(logout, /isTrustedFormPostOrigin/)
  assert.match(logout, /signOut\(\{ scope: 'local' \}\)/)
  assert.match(logout, /return clearAuthCookies\(request, NextResponse\.json\(\{ success: true \}\)\)/)
  const clear = read('src/lib/auth-cookie-clear.ts')
  assert.match(clear, /name\.startsWith\('sb-'\)/)
  assert.match(clear, /sst-session-started-at/)
})

test('동의 화면: login=success 는 그리기 전에 next 로 옮기고, 판정 오류면 이동하지 않으며, 기록 액션은 세션 쿠키를 건드리지 않는다', () => {
  const page = read('src/app/(auth)/consent/page.tsx')
  assert.ok(page.indexOf("firstParam(params.login) === 'success'") < page.indexOf('getRequestAuthUserId()'))
  assert.match(page, /if \(error\) \{\n\s+return extractConsentErrorCode/)
  assert.match(page, /if \(missing\.length === 0\) \{\n\s+redirect\(next\)/)
  assert.match(page, /redirect\(`\/login\?\$\{new URLSearchParams\(\{ next: buildConsentPagePath\(next\) \}\)/)
  const action = read('src/app/(auth)/consent/actions.ts')
  assert.match(action, /getRequestAuthUserId\(\)/)
  const actionCode = action.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(actionCode, /createClient|revalidatePath|cookies\(/)
  assert.match(action, /recordUserConsents\(userId, items, 'consent_gate'\)/)
  const client = read('src/app/(auth)/consent/consent-client.tsx')
  assert.match(client, /clearKakaoConsentDraft\(\)/)
  assert.match(client, /fetch\('\/api\/auth\/consent-logout', \{ method: 'POST' \}\)/)
  for (const href of ['/mypage/consents', '/library', '/mypage/credits', '/mypage/payments', '/mypage/support', '/mypage/withdraw']) {
    assert.ok(client.includes(`href: '${href}'`), href)
    assert.equal(gate.isConsentGateExcludedPath(href), true, href)
  }
})

test('약관 원본 판정: 정규화와 같은 규칙(enabled 없음=켜짐), 꺼짐·빈 본문·행 없음은 멈춤, 개인정보처리방침은 늘 보호', () => {
  const { inspectRawFooterPolicyDocument, findProtectedFooterPolicyViolation } = footerRaw
  const raw = (documents) => ({ policyDocuments: documents })
  assert.equal(inspectRawFooterPolicyDocument(raw({ serviceTerms: { content: '본문' } }), 'service').ok, true)
  assert.deepEqual(inspectRawFooterPolicyDocument(raw({ serviceTerms: { content: '본문', enabled: false } }), 'service'), { ok: false, reason: 'disabled' })
  assert.deepEqual(inspectRawFooterPolicyDocument(raw({ serviceTerms: { content: '\n\u3000' } }), 'service'), { ok: false, reason: 'empty' })
  assert.deepEqual(inspectRawFooterPolicyDocument(null, 'privacy'), { ok: false, reason: 'missing' })
  assert.deepEqual(inspectRawFooterPolicyDocument(raw({}), 'unknown'), { ok: false, reason: 'unknown_slug' })
  const ok = raw({ serviceTerms: { content: 'a' }, privacyPolicy: { content: 'b' }, refundPolicy: { content: '', enabled: false } })
  assert.equal(findProtectedFooterPolicyViolation(ok, ['service']), null)
  assert.match(findProtectedFooterPolicyViolation(raw({ serviceTerms: { content: 'a' }, privacyPolicy: { content: ' ' } }), []), /개인정보처리방침 본문을 비울 수 없습니다/)
  assert.match(findProtectedFooterPolicyViolation(raw({ serviceTerms: { content: 'a', enabled: false }, privacyPolicy: { content: 'b' } }), ['service']), /끌 수 없습니다/)
  // 화면은 정규화하지 않은 원본을 보낸다(정규화는 빈 본문을 기본 약관으로 바꿔 검사를 지나친다).
  const footerClient = read('src/app/(admin)/admin/footer/footer-client.tsx')
  assert.match(footerClient, /await saveFooterContentAction\(footerContent\)/)
  assert.doesNotMatch(footerClient, /normalizeFooterContent/)
  const actions = read('src/app/(admin)/admin/footer/actions.ts')
  assert.ok(actions.indexOf('findProtectedFooterPolicyViolation(input, protectedSlugs)') < actions.indexOf('saveSiteFooterContent(input)'))
})

test('안내 문구 검사·강조 표기·처리 결과 틀', () => {
  const texts = Object.fromEntries(consent.SIGNUP_CONSENT_TEXT_KEYS.map((key) => [key, '문구']))
  texts.optionalResultTemplate = '{전송자} {항목} 처리 결과: {결과} · {처리일자}'
  texts.optionalReceiptTemplate = '{항목}: {결과}'
  assert.equal(consent.validateSignupConsentTexts(texts), null)
  assert.match(consent.validateSignupConsentTexts({ ...texts, optionalResultTemplate: '{항목} {결과} {처리일자}' }), /전송자/)
  assert.match(consent.validateSignupConsentTexts({ ...texts, optionalResultTemplate: `${texts.optionalResultTemplate} {이름}` }), /전송자/)
  assert.match(consent.validateSignupConsentTexts({ ...texts, consentTitle: '' }), /동의 화면 제목/)
  assert.deepEqual(consent.parseConsentEmphasis('앞 **보유 기간** 뒤'), [
    { text: '앞 ', emphasis: false }, { text: '보유 기간', emphasis: true }, { text: ' 뒤', emphasis: false },
  ])
  assert.deepEqual(consent.getAlwaysVisibleConsentLines({ required: true, content: '첫 줄\n둘째\n**강조**' }), ['첫 줄', '**강조**'])
  assert.equal(
    consent.formatOptionalResult('{전송자} {항목} 처리 결과: {결과} · {처리일자}', { sender: '써머썬', itemLabel: '마케팅', agreed: false, processedAt: '2026-11-20T03:00:00Z' }),
    '써머썬 마케팅 처리 결과: 동의하지 않음 · 2026년 11월 20일'
  )
  // 강조는 글자로만 그린다(HTML 해석 없음).
  assert.doesNotMatch(read('src/components/auth/consent-checklist.tsx'), /dangerouslySetInnerHTML/)
})

test('마이그레이션: 권한·추가 전용·12인자 저장 함수·관리자 판정 도메인·VERIFY, 관리자 판정은 profiles.email 을 쓰지 않는다', () => {
  assert.match(MIGRATION, /REVOKE ALL ON TABLE public\.user_consents FROM PUBLIC, anon, authenticated, service_role;\n/)
  assert.match(MIGRATION, /GRANT SELECT ON TABLE public\.user_consents TO service_role;/)
  assert.match(MIGRATION, /REVOKE ALL ON SEQUENCE public\.user_consents_seq_seq/)
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.get_my_missing_required_consents\(\) TO authenticated;/)
  assert.match(MIGRATION, /pronargs INTO v_count[\s\S]*?IF v_count <> 12 THEN/)
  assert.match(MIGRATION, /AS RESTRICTIVE\n  FOR UPDATE\n  USING \(key <> 'signup_consent_texts'\)/)
  assert.match(MIGRATION, /AS RESTRICTIVE\n  FOR UPDATE\n  USING \(key <> 'site_footer_content'\)/)
  assert.match(MIGRATION, /DEFERRABLE INITIALLY DEFERRED/)
  assert.match(MIGRATION, /created_at timestamptz NOT NULL DEFAULT clock_timestamp\(\),\n  CONSTRAINT user_consents_item_version_fkey/)
  // 관리자 ID 도메인은 코드 상수와 같다.
  assert.ok(MIGRATION.includes(`'@${adminShared.ADMIN_ACCOUNT_EMAIL_DOMAIN}'`))
  assert.match(MIGRATION, /SELECT u\.email INTO v_email FROM auth\.users u WHERE u\.id = v_user_id;/)
  assert.doesNotMatch(MIGRATION, /is_internal_admin_account\(p\.email\)/)
  // 카카오가 넘긴 값(identity_data)은 허용 목록 키만.
  assert.match(MIGRATION, /k NOT IN \('email', 'email_verified', 'iss', 'phone_verified', 'provider_id', 'sub'\)/)
  const rollback = read('supabase/rollback/20261120120000_signup_consents_down.sql')
  assert.match(rollback, /코드 배포 뒤에는 되돌리지 말 것/)
  assert.match(rollback, /DROP POLICY IF EXISTS system_settings_signup_consent_texts_no_client_write/)
  // 저장 함수에 넘기는 updated_at 은 받은 문자열 그대로(Date 로 바꾸면 밀리초로 잘려 늘 충돌).
  const server = read('src/lib/signup-consent-server.ts')
  assert.match(server, /p_expected_updated_at: input\.expectedUpdatedAt,/)
  assert.doesNotMatch(read('src/app/(admin)/admin/footer/signup-consent-admin.tsx'), /new Date\([^)]*updated_at/)
})

test('관리자: 가입 동의 카드는 대표 전용, 미리보기는 회원 화면과 같은 렌더러, 회원 상세에 동의 내역', () => {
  const page = read('src/app/(admin)/admin/footer/page.tsx')
  assert.match(page, /access\.role === 'owner' \? getSignupConsentAdminData\(\) : Promise\.resolve\(null\)/)
  const admin = read('src/app/(admin)/admin/footer/signup-consent-admin.tsx')
  assert.match(admin, /import \{ ConsentChecklist \} from '@\/components\/auth\/consent-checklist'/)
  assert.ok((admin.match(/<ConsentChecklist/g) ?? []).length >= 2)
  assert.match(admin, /saveSignupConsentItemAction\(target, true\)[\s\S]*?preview\.result\.reconsent/)
  const actions = read('src/app/(admin)/admin/footer/consent-actions.ts')
  assert.equal(actions.match(/assertAdminActionPermission\('owner'\)/g).length, 4)
  assert.match(read('src/lib/admin-member-detail-server.ts'), /readSection\(access, 'members\.view', '약관 동의'/)
})

test('후기 작성자 프로필 이미지는 읽지도 보이지도 않는다(수집 안 함 고지)', () => {
  const reviews = read('src/lib/market-reviews-server.ts')
  assert.doesNotMatch(reviews, /avatar_url/)
  assert.match(reviews, /avatarUrl: null,/)
})

test('항목이 바뀌었다는 응답(ITEM_CHANGED·REQUIRED_MISSING)을 받으면 체크를 비우고 최신 항목을 다시 보여 준다', () => {
  const signup = read('src/app/(auth)/signup/signup-client.tsx')
  assert.match(signup, /const resetConsentsAfterChange = \(\) => \{\n\s+clearKakaoConsentDraft\(\)\n\s+setConsentChecked\(\{\}\)/)
  assert.match(signup, /'CONSENT_REQUIRED_MISSING'\) \{[\s\S]{0,300}resetConsentsAfterChange\(\)\n\s+setIsEmailSignupMode\(false\)/)
  assert.match(signup, /result\.code === 'CONSENT_REQUIRED_MISSING'\) \{\n\s+resetConsentsAfterChange\(\)/)
  assert.match(read('src/app/(auth)/consent/consent-client.tsx'), /'CONSENT_REQUIRED_MISSING'\) \{[\s\S]{0,200}setChecked\(\{\}\)/)
  // 이메일 가입 접수 문구는 세 경우 모두 참이어야 한다(기록되지 않은 기존 계정에도 거짓이 아니게 '새 계정').
  assert.match(MIGRATION, /이메일 인증을 마친 새 계정에 반영됩니다/)
  // 재동의 확인 창은 열 때마다 확인 체크가 꺼진 채로 시작한다.
  const admin = read('src/app/(admin)/admin/footer/signup-consent-admin.tsx')
  assert.match(admin, /<ReconsentDialog\n\s+key=\{dialogKey\}/)
  assert.equal((admin.match(/openConfirm\(\{ kind:/g) ?? []).length, 2)
  // 관리자 계정은 가입 취소로 지우지 않는다.
  assert.match(MIGRATION, /p\.id = p_user_id AND p\.is_admin IS TRUE\) THEN\n    RETURN false;/)
})
