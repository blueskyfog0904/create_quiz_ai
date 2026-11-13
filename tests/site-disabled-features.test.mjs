import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load, NextResponse } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const workspaceSubject = load('src/lib/workspace-subject.ts')
const site = load('src/lib/site-features.ts', { '@/lib/workspace-subject': workspaceSubject })
const adminFeatures = load('src/lib/admin-features.ts')

const page = (feature, redirectTo) => ({ feature, kind: 'page', redirectTo })
const api = (feature) => ({ feature, kind: 'api' })

test('옛 페이지는 묶음과 보낼 곳이 정해져 있다(과목 접두가 있든 없든)', () => {
  const cases = [
    ['/generate', page('site_generate', '/')],
    ['/korean/generate', page('site_generate', '/?subject=korean')],
    ['/english/generate/personal', page('site_generate', '/?subject=english')],
    ['/korean/generate/boards/a/posts/b/generate/c', page('site_generate', '/?subject=korean')],
    ['/bank', page('site_question_bank', '/')],
    ['/korean/bank', page('site_question_bank', '/?subject=korean')],
    ['/exam-papers/123', page('site_exam_papers', '/library')],
    ['/korean/exam-papers', page('site_exam_papers', '/library?subject=korean')],
    ['/library/exam-papers', page('site_exam_papers', '/library')],
    ['/passages/create', page('site_passages', '/')],
    ['/library/mypassages', page('site_passages', '/library')],
    ['/library/purchased', page('site_legacy_library', '/library')],
    ['/korean/library/market', page('site_legacy_library', '/library?subject=korean')],
    ['/legacy/korean/library/purchased', page('site_legacy_library', '/library?subject=korean')],
    ['/legacy/english/library/exam-papers/9', page('site_exam_papers', '/library?subject=english')],
    ['/legacy/korean/library/mypassages', page('site_passages', '/library?subject=korean')],
    ['/legacy', page('site_legacy_landing', '/')],
    ['/legacy/', page('site_legacy_landing', '/')],
    ['/korean', page('site_legacy_landing', '/?subject=korean')],
    ['/english/', page('site_legacy_landing', '/?subject=english')],
    ['/legacy/mypage', page('site_legacy_mypage', '/mypage')],
    ['/legacy/mypage/credits', page('site_legacy_mypage', '/mypage/credits')],
    ['/legacy/mypage/withdraw', page('site_legacy_mypage', '/mypage/withdraw')],
    ['/legacy/mypage/unknown', page('site_legacy_mypage', '/mypage')],
    ['/preview/solvook-concept', page('site_preview', '/')],
    ['/preview/design-system', page('site_preview', '/')],
    ['/preview/scholarly-library/x', page('site_preview', '/')],
    ['/legacy/mypage/a.png', page('site_legacy_mypage', '/mypage')],
    // 시안 화면의 예외는 이미지 파일뿐이다(다른 확장자를 붙여도 닫힌다)
    ['/preview/solvook-concept/boards/s/posts/p.x', page('site_preview', '/')],
    ['/preview/solvook-concept/boards/s/posts/v1.2', page('site_preview', '/')],
    // 확장자·인코딩으로 피할 수 없다
    ['/korean/generate/a.png', page('site_generate', '/?subject=korean')],
    ['/%67enerate', page('site_generate', '/')],
    ['/passages%2Fcreate', page('site_passages', '/')],
  ]
  for (const [path, expected] of cases) {
    assert.deepEqual(site.resolveSiteFeatureRoute(path), expected, path)
  }
  // 과목 접두가 없으면 ?subject= 값으로 보낼 과목을 정한다(잘못된 값은 무시)
  assert.deepEqual(site.resolveSiteFeatureRoute('/generate', 'korean'), page('site_generate', '/?subject=korean'))
  assert.deepEqual(site.resolveSiteFeatureRoute('/generate', 'japanese'), page('site_generate', '/'))
})

test('옛 API는 묶음별로 막는다(같은 접두 아래에서도 구체적인 것부터)', () => {
  const cases = [
    ['/api/questions/generate', 'site_generate'],
    ['/api/questions/review', 'site_generate'],
    ['/api/generate/listboard-jobs/1/run', 'site_generate'],
    ['/api/questions/save-from-community', 'site_question_bank'],
    ['/api/question-bank/options', 'site_question_bank'],
    ['/api/exam-papers/random-bank', 'site_question_bank'],
    ['/api/exam-papers', 'site_exam_papers'],
    ['/api/exam-papers/1/print-pdf', 'site_exam_papers'],
    ['/api/questions', 'site_legacy_library'],
    ['/api/questions/123', 'site_legacy_library'],
  ]
  for (const [path, feature] of cases) {
    assert.deepEqual(site.resolveSiteFeatureRoute(path), api(feature), path)
  }
})

test('문제마켓 운영 화면과 공유 API는 어느 묶음에도 속하지 않는다', () => {
  for (const path of [
    '/', '/search', '/categories/1', '/items/1', '/cart', '/library', '/library/', '/mypage', '/mypage/credits', '/mypage/support',
    '/checkout', '/checkout/payapp/result', '/pricing', '/terms/privacy', '/login', '/signup', '/auth/callback',
    '/korean/login', '/english/signup', '/admin', '/admin/support', '/dashboard/admin/passages',
    '/api/credits/balance', '/api/auth/logout', '/api/auth/withdraw', '/api/profile', '/api/support', '/api/support/categories',
    '/api/refunds/request', '/api/market/refunds', '/api/market/items/1/download', '/api/notifications', '/api/payments/payapp/orders',
    '/api/pricing-plans', '/api/cron/market/cleanup-auto-upload-drafts', '/api/internal/payments/reconcile', '/api/admin/questions',
    // 접두가 비슷할 뿐 다른 경로
    '/generated', '/banking', '/librarys/purchased', '/api/questionnaire', '/api/generates', '/legacyx', '/previews', '/preview',
    '/payment-methods/card.svg',
    // public/preview 아래 정적 파일은 화면이 아니므로 닫지 않는다
    '/preview/solvook-concept/brand-mark.svg',
  ]) {
    assert.equal(site.resolveSiteFeatureRoute(path), null, path)
  }
})

test('보내는 곳은 모두 운영 화면이다(이동이 다시 이동을 부르지 않는다)', () => {
  const sources = ['/generate', '/korean/bank', '/exam-papers', '/passages/create', '/library/purchased', '/legacy', '/korean', '/english',
    '/legacy/mypage', '/legacy/mypage/credits', '/legacy/mypage/history', '/legacy/mypage/payments', '/legacy/mypage/profile',
    '/legacy/mypage/support', '/legacy/mypage/withdraw', '/preview/solvook-concept', '/legacy/korean/library/market']
  for (const source of sources) {
    const route = site.resolveSiteFeatureRoute(source)
    const target = new URL(route.redirectTo, 'http://localhost')
    assert.equal(site.resolveSiteFeatureRoute(target.pathname, target.searchParams.get('subject')), null, `${source} → ${route.redirectTo}`)
    assert.equal(adminFeatures.resolveAdminFeature(target.pathname), null, route.redirectTo)
  }
  // 새 마이페이지에 실제로 있는 화면으로만 보낸다
  const root = new URL('../src/app/(solvook)/mypage/', import.meta.url).pathname
  for (const section of ['credits', 'history', 'payments', 'profile', 'support', 'withdraw']) {
    assert.ok(statSync(join(root, section, 'page.tsx')).isFile(), section)
  }
})

function loadMiddleware(siteState) {
  class PassThroughResponse extends NextResponse {
    static next() {
      throw new Error('원래 흐름으로 통과')
    }
    static redirect(url, status) {
      return new NextResponse(null, { status, headers: { location: String(url) } })
    }
  }
  const middleware = load('src/lib/supabase/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => ({}) },
    'next/server': { NextResponse: PassThroughResponse },
    './session-cookies': { toSessionCookieOptions: (options) => options },
    '@/lib/workspace-subject': workspaceSubject,
    '@/lib/workspace-public-browse': {},
    '@/lib/admin-features': adminFeatures,
    '@/lib/site-features': site,
    '@/lib/admin-features-server': {
      getDisabledAdminFeatures: async () => ({ ok: true, features: [] }),
      getDisabledSiteFeatures: async () => siteState,
      isSiteFeatureDisabled: (feature, current) => (current.ok ? current.features.includes(feature) : true),
    },
  })
  const request = (path) => ({ url: `http://localhost${path}`, nextUrl: new URL(`http://localhost${path}`), cookies: { get: () => undefined, getAll: () => [] }, headers: new Headers() })
  return { middleware, request }
}

test('미들웨어: 닫힌 묶음의 페이지는 307로 보내고 API는 404, 열린 묶음과 운영 경로는 통과', async () => {
  const { middleware, request } = loadMiddleware({ ok: true, features: ['site_generate', 'site_passages', 'site_legacy_landing', 'site_legacy_mypage'] })

  const moved = await middleware.updateSession(request('/korean/generate/personal?x=1'))
  assert.equal(moved.status, 307)
  assert.equal(moved.headers.get('location'), 'http://localhost/?subject=korean')

  assert.equal((await middleware.updateSession(request('/passages/create'))).headers.get('location'), 'http://localhost/')
  assert.equal((await middleware.updateSession(request('/korean'))).headers.get('location'), 'http://localhost/?subject=korean')
  assert.equal((await middleware.updateSession(request('/legacy/mypage/credits'))).headers.get('location'), 'http://localhost/mypage/credits')
  assert.equal((await middleware.updateSession(request('/generate?subject=korean'))).headers.get('location'), 'http://localhost/?subject=korean')

  const blocked = await middleware.updateSession(request('/api/questions/generate'))
  assert.equal(blocked.status, 404)
  assert.deepEqual(await blocked.json(), { success: false, error: { code: 'NOT_FOUND', message: '사용하지 않는 기능입니다.' } })

  // 닫지 않은 묶음(문제은행·시험지·옛 보관함)과 운영 경로는 원래 흐름으로
  for (const path of ['/korean/bank', '/api/exam-papers', '/library/purchased', '/', '/library', '/mypage/credits', '/api/market/refunds', '/checkout']) {
    await assert.rejects(() => middleware.updateSession(request(path)), /원래 흐름으로 통과/, path)
  }
})

test('미들웨어: 설정을 읽지 못하면 옛 경로는 닫힌 것으로 처리하고 운영 경로는 그대로 둔다', async () => {
  const { middleware, request } = loadMiddleware({ ok: false })
  assert.equal((await middleware.updateSession(request('/korean/bank'))).status, 307)
  assert.equal((await middleware.updateSession(request('/api/questions'))).status, 404)
  await assert.rejects(() => middleware.updateSession(request('/library')), /원래 흐름으로 통과/)
  await assert.rejects(() => middleware.updateSession(request('/')), /원래 흐름으로 통과/)
})

test('설정 읽기: 관리자·사용자 묶음은 서로 다른 설정 행을 읽고 따로 기억한다', async () => {
  const calls = []
  const previous = { fetch: globalThis.fetch, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  globalThis.fetch = async (url) => {
    calls.push(url)
    const features = url.endsWith('site_disabled_features') ? ['site_passages'] : ['labels']
    return { ok: true, json: async () => [{ value: { features } }] }
  }
  try {
    const server = load('src/lib/admin-features-server.ts', { '@/lib/admin-features': adminFeatures, '@/lib/site-features': site })
    assert.deepEqual(await server.getDisabledSiteFeatures(1_000), { ok: true, features: ['site_passages'] })
    assert.deepEqual(await server.getDisabledAdminFeatures(1_000), { ok: true, features: ['labels'] })
    await server.getDisabledSiteFeatures(2_000)
    assert.equal(calls.length, 2)
    await assert.rejects(() => server.assertSiteFeatureEnabled('site_passages'), /사용하지 않는 기능입니다/)
    await server.assertSiteFeatureEnabled('site_generate')
  } finally {
    globalThis.fetch = previous.fetch
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key
  }
})

function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, name)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('AI를 부르거나 지문을 쓰는 서버 액션은 맨 먼저 묶음 검사를 한다(주소가 없어 미들웨어로 막을 수 없다)', () => {
  const guarded = {
    'src/app/api/ai/generate-passages.ts': ['generatePassages'],
    'src/app/api/ocr/actions.ts': ['extractTextFromFile'],
    'src/app/api/passages/actions.ts': ['enrichPassages', 'enrichPassage', 'createPassage', 'updatePassage', 'deletePassage'],
  }
  for (const [path, names] of Object.entries(guarded)) {
    const source = read(path)
    assert.match(source.split('\n')[0], /^'use server'/, path)
    for (const name of names) {
      const body = functionBody(source, name)
      const firstStatement = body.slice(body.indexOf('{\n') + 2).trimStart().split('\n')[0]
      assert.equal(firstStatement, "await assertSiteFeatureEnabled('site_passages')", `${path}: ${name}`)
    }
  }
})

test('설정 행은 정의된 묶음을 모두 닫는다', () => {
  const migration = read('supabase/migrations/20261113160000_site_disabled_features.sql')
  const value = JSON.parse(migration.match(/'(\{"features": \[[^\]]+\]\})'::jsonb/)[1])
  assert.deepEqual([...value.features].sort(), [...site.SITE_FEATURE_IDS].sort())
  assert.match(migration, /'site_disabled_features',/)
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(read('supabase/rollback/20261113160000_site_disabled_features_down.sql'), /DELETE FROM public\.system_settings WHERE key = 'site_disabled_features';/)

})

// 실제 파일 구조와 대조: 옛 화면 디렉터리의 페이지·API가 모두 어떤 묶음에 들어 있는지
function listRoutes(dir, fileName) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      if (entry.startsWith('_')) continue
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry === fileName) found.push(full)
    }
  }
  walk(dir)
  return found
}

test('옛 화면 디렉터리의 페이지와 옛 API route는 빠짐없이 묶음에 속한다', () => {
  const root = new URL('../src/app/', import.meta.url).pathname
  const toRoute = (file, suffix) => `/${file.slice(root.length, -suffix.length)}`
    .replace(/\/\([^)]+\)/g, '')
    .replace(/\[workspaceSubject\]/g, 'korean')
    .replace(/\[[^\]]+\]/g, 'x')
    .replace(/\/$/, '') || '/'

  const legacyPageDirs = ['(dashboard)', '[workspaceSubject]', 'legacy', 'preview']
  for (const dir of legacyPageDirs) {
    for (const file of listRoutes(join(root, dir), 'page.tsx')) {
      const route = toRoute(file, '/page.tsx')
      assert.ok(site.resolveSiteFeatureRoute(route), `${route} (${dir})`)
    }
  }
  const legacyApiDirs = ['api/questions', 'api/generate', 'api/question-bank', 'api/exam-papers']
  for (const dir of legacyApiDirs) {
    for (const file of listRoutes(join(root, dir), 'route.ts')) {
      const route = toRoute(file, '/route.ts')
      assert.equal(site.resolveSiteFeatureRoute(route)?.kind, 'api', route)
    }
  }
  // 운영 화면 디렉터리의 페이지는 어느 묶음에도 속하지 않는다
  for (const dir of ['(solvook)', 'checkout', '(auth)']) {
    for (const file of listRoutes(join(root, dir), 'page.tsx')) {
      const route = toRoute(file, '/page.tsx')
      assert.equal(site.resolveSiteFeatureRoute(route), null, route)
    }
  }
})

test('정적 파일 모양의 주소는 세션 작업 없이 통과시키되, 외부에서 넣은 사용자 ID 헤더는 지운다', async () => {
  let supabaseCreated = false
  let forwarded = null
  class CapturingResponse extends NextResponse {
    static next(init) {
      forwarded = init?.request?.headers ?? null
      return new NextResponse(null, { status: 200 })
    }
    static redirect(url, status) {
      return new NextResponse(null, { status, headers: { location: String(url) } })
    }
  }
  const middleware = load('src/lib/supabase/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => { supabaseCreated = true; return {} } },
    'next/server': { NextResponse: CapturingResponse },
    './session-cookies': { toSessionCookieOptions: (options) => options },
    '@/lib/workspace-subject': workspaceSubject,
    '@/lib/workspace-public-browse': {},
    '@/lib/admin-features': adminFeatures,
    '@/lib/site-features': site,
    '@/lib/admin-features-server': {
      getDisabledAdminFeatures: async () => ({ ok: true, features: ['ai_generation'] }),
      getDisabledSiteFeatures: async () => ({ ok: true, features: ['site_generate'] }),
      isSiteFeatureDisabled: (feature, current) => current.features.includes(feature),
    },
  })
  const request = (path) => ({
    url: `http://localhost${path}`,
    nextUrl: new URL(`http://localhost${path}`),
    cookies: { get: () => undefined, getAll: () => [] },
    headers: new Headers({ 'x-auth-user-id': '11111111-1111-4111-8111-111111111111', accept: 'text/html' }),
  })

  // 동적 페이지에 닿을 수 있는 주소: 통과는 하지만 위조 헤더는 없다
  for (const path of ['/items/a.png', '/payment-methods/card.svg', '/preview/solvook-concept/brand-mark.svg']) {
    forwarded = null
    const response = await middleware.updateSession(request(path))
    assert.equal(response.status, 200, path)
    assert.equal(forwarded.get('x-auth-user-id'), null, path)
    assert.equal(forwarded.get('accept'), 'text/html', path)
  }
  assert.equal(supabaseCreated, false, '정적 파일 요청에는 세션 작업을 하지 않는다')

  // 닫힌 기능은 확장자를 붙여도 정적 파일 처리보다 먼저 막힌다
  assert.equal((await middleware.updateSession(request('/admin/ai-question-generation-runs/a.png'))).status, 404)
  assert.equal((await middleware.updateSession(request('/korean/generate/a.png'))).status, 307)
})

test('사용자 ID 헤더를 믿는 전제(미들웨어가 모든 페이지 요청을 거친다)가 코드에 적혀 있다', () => {
  assert.match(read('src/lib/request-auth.ts'), /확장자로 끝나는 경로도 거치게 되어 있다/)
  assert.match(read('src/lib/supabase/middleware.ts'), /requestHeaders\.delete\(AUTH_USER_ID_HEADER\)\n    return NextResponse\.next\(\{ request: \{ headers: requestHeaders \} \}\)/)
})
