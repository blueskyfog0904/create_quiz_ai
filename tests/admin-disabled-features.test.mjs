import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { load, NextResponse } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const features = load('src/lib/admin-features.ts')
const workspaceSubject = load('src/lib/workspace-subject.ts')
const siteFeatures = load('src/lib/site-features.ts', { '@/lib/workspace-subject': workspaceSubject })

const ALL_OFF = { ok: true, features: features.ADMIN_FEATURES.map((feature) => feature.id) }

test('경로가 속한 기능 묶음을 조각 경계로 판정한다', () => {
  const cases = [
    ['/admin/questions', 'question_bank'],
    ['/admin/questions/upload', 'question_bank'],
    ['/admin/questions/123', 'question_bank'],
    ['/admin/question-bank/backfill', 'question_bank'],
    ['/api/admin/questions/bulk-upload', 'question_bank'],
    ['/admin/problem-types/abc/test', 'ai_generation'],
    ['/admin/ai-question-generation-runs', 'ai_generation'],
    ['/admin/ai-question-generation-runs/run-1', 'ai_generation'],
    ['/api/admin/ai-question-generation-runs/run-1/download', 'ai_generation'],
    ['/api/admin/providers', 'ai_generation'],
    ['/api/admin/problem-type-default-prompts', 'ai_generation'],
    ['/admin/generate/products/p1/edit', 'generate'],
    ['/admin/passages/models', 'passages'],
    ['/dashboard/admin/passages/prompts', 'passages'],
    ['/admin/source-configs', 'source_configs'],
    ['/api/admin/source-configs/1', 'source_configs'],
    ['/admin/labels', 'labels'],
    ['/admin/landing-pages', 'landing_pages'],
    ['/admin/roles', 'signup_roles'],
    ['/admin/roles/', 'signup_roles'],
    ['/admin/menu-management', 'menu_management'],
    // 확장자를 붙이거나 퍼센트 인코딩해도 같은 묶음이다
    ['/admin/ai-question-generation-runs/a.png', 'ai_generation'],
    ['/api/admin/ai-question-generation-runs/a.png', 'ai_generation'],
    ['/admin/%71uestions', 'question_bank'],
    ['/admin/%61i-question-generation-runs', 'ai_generation'],
    ['/admin%2Fquestions', 'question_bank'],
  ]
  for (const [path, expected] of cases) {
    assert.equal(features.resolveAdminFeature(path), expected, path)
  }
})

test('운영 화면과 비슷한 이름의 경로는 어느 묶음에도 속하지 않는다', () => {
  for (const path of [
    '/admin', '/admin/login', '/admin/support', '/admin/refunds', '/admin/users', '/admin/credits', '/admin/pricing',
    '/admin/market/products', '/admin/market/products/new', '/admin/market/images', '/admin/market-categories',
    '/admin/main-ad-settings', '/admin/market-main-settings', '/admin/reviews', '/admin/review-tags',
    '/admin/footer', '/admin/admin-accounts',
    '/api/admin/market/items', '/api/admin/market/file-types', '/api/admin/market/storage-cleanup', '/api/admin/support/tickets/1',
    '/api/admin/refunds', '/api/admin/payments/review', '/api/admin/users/credits', '/api/admin/reviews', '/api/admin/site-logo',
    '/api/admin/session', '/api/admin/stats', '/api/admin/admin-accounts',
    // 접두가 비슷할 뿐 다른 경로
    '/admin/questions-export', '/admin/rolesx', '/admin/labels-new', '/api/admin/providersx',
    '/', '/library', '/mypage/support', '/api/support',
  ]) {
    assert.equal(features.resolveAdminFeature(path), null, path)
    assert.equal(features.isAdminPathDisabled(path, ALL_OFF), false, path)
    assert.equal(features.isAdminPathDisabled(path, { ok: false }), false, path)
  }
})

test('설정에 든 묶음만 막고, 설정을 읽지 못하면 묶음에 속한 경로를 모두 막는다', () => {
  const state = { ok: true, features: ['question_bank', 'labels'] }
  assert.equal(features.isAdminPathDisabled('/admin/questions', state), true)
  assert.equal(features.isAdminPathDisabled('/admin/labels', state), true)
  assert.equal(features.isAdminPathDisabled('/admin/menu-management', state), false)
  assert.equal(features.isAdminPathDisabled('/admin/roles', state), false)
  assert.equal(features.isAdminPathDisabled('/admin/roles', { ok: true, features: [] }), false)
  assert.equal(features.isAdminPathDisabled('/admin/roles', { ok: false }), true)
  assert.equal(features.isAdminPathDisabled('/admin/menu-management', { ok: false }), true)
})

test('설정 값 형식이 틀리면 읽기 실패로 취급한다', () => {
  assert.deepEqual(features.parseDisabledAdminFeatures({ features: ['a', 'b'] }), ['a', 'b'])
  assert.deepEqual(features.parseDisabledAdminFeatures({ features: [] }), [])
  for (const value of [null, undefined, 'x', [], { features: 'a' }, { features: [1] }, {}]) {
    assert.equal(features.parseDisabledAdminFeatures(value), null)
  }
})

// 설정 읽기(fetch)를 바꿔 끼워 서버 모듈을 불러온다.
function loadServer(fetchImpl) {
  const calls = []
  const source = readFileSync(new URL('../src/lib/admin-features-server.ts', import.meta.url), 'utf8')
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/)
  const previous = { fetch: globalThis.fetch, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return fetchImpl(calls.length)
  }
  const server = load('src/lib/admin-features-server.ts', { '@/lib/admin-features': features, '@/lib/site-features': siteFeatures })
  const restore = () => {
    globalThis.fetch = previous.fetch
    process.env.NEXT_PUBLIC_SUPABASE_URL = previous.url
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous.key
  }
  return { server, calls, restore }
}
const json = (body, ok = true) => ({ ok, json: async () => body })

test('설정은 service role로 읽고, 성공한 결과만 60초 기억한다', async () => {
  const { server, calls, restore } = loadServer(() => json([{ value: { features: ['labels'] } }]))
  try {
    assert.deepEqual(await server.getDisabledAdminFeatures(1_000), { ok: true, features: ['labels'] })
    assert.deepEqual(await server.getDisabledAdminFeatures(30_000), { ok: true, features: ['labels'] })
    assert.equal(calls.length, 1, '60초 안에는 다시 읽지 않는다')
    await server.getDisabledAdminFeatures(62_000)
    assert.equal(calls.length, 2)
    assert.match(calls[0].url, /\/rest\/v1\/system_settings\?select=value&key=eq\.admin_disabled_features$/)
    assert.equal(calls[0].init.headers.Authorization, 'Bearer service-key')
    assert.equal(calls[0].init.headers.apikey, 'service-key')
  } finally {
    restore()
  }
})

test('행이 없으면 "꺼진 묶음 없음", 읽기 오류·형식 오류는 실패이고 기억하지 않는다', async () => {
  const empty = loadServer(() => json([]))
  try {
    assert.deepEqual(await empty.server.getDisabledAdminFeatures(1_000), { ok: true, features: [] })
  } finally {
    empty.restore()
  }

  // 첫 요청은 오류, 두 번째는 정상 → 오류가 기억되지 않아 바로 정상 값이 나온다
  const flaky = loadServer((call) => (call === 1 ? json({ message: 'boom' }, false) : json([{ value: { features: ['labels'] } }])))
  try {
    assert.deepEqual(await flaky.server.getDisabledAdminFeatures(1_000), { ok: false })
    assert.deepEqual(await flaky.server.getDisabledAdminFeatures(1_001), { ok: true, features: ['labels'] })
  } finally {
    flaky.restore()
  }

  const malformed = loadServer(() => json([{ value: { features: 'labels' } }]))
  try {
    assert.deepEqual(await malformed.server.getDisabledAdminFeatures(1_000), { ok: false })
  } finally {
    malformed.restore()
  }

  const thrown = loadServer(() => { throw new Error('network') })
  try {
    assert.deepEqual(await thrown.server.getDisabledAdminFeatures(1_000), { ok: false })
  } finally {
    thrown.restore()
  }
})

test('꺼진 묶음의 쓰기 액션은 직접 호출해도 실패한다', async () => {
  const off = loadServer(() => json([{ value: { features: ['labels'] } }]))
  try {
    await assert.rejects(() => off.server.assertAdminFeatureEnabled('labels'), /사용하지 않는 기능입니다/)
    await off.server.assertAdminFeatureEnabled('signup_roles')
  } finally {
    off.restore()
  }
  const failed = loadServer(() => json({}, false))
  try {
    await assert.rejects(() => failed.server.assertAdminFeatureEnabled('signup_roles'), /사용하지 않는 기능입니다/)
  } finally {
    failed.restore()
  }
})

// 미들웨어: 꺼진 경로는 세션 처리 전에 404
function loadMiddleware(state, siteState = { ok: true, features: [] }) {
  let supabaseCreated = false
  // 막지 않은 요청은 원래 흐름으로 넘어간다. 원래 흐름의 첫 동작(NextResponse.next)에서 표시용 오류를 낸다.
  class PassThroughResponse extends NextResponse {
    static next() {
      throw new Error('원래 흐름으로 통과')
    }
  }
  const middleware = load('src/lib/supabase/middleware.ts', {
    '@supabase/ssr': { createServerClient: () => { supabaseCreated = true; return {} } },
    'next/server': { NextResponse: PassThroughResponse },
    './session-cookies': { toSessionCookieOptions: (options) => options },
    '@/lib/workspace-subject': workspaceSubject,
    '@/lib/workspace-public-browse': {},
    '@/lib/admin-features': features,
    '@/lib/site-features': siteFeatures,
    '@/lib/admin-features-server': {
      getDisabledAdminFeatures: async () => state,
      getDisabledSiteFeatures: async () => siteState,
      isSiteFeatureDisabled: (feature, current) => (current.ok ? current.features.includes(feature) : true),
    },
  })
  const request = (pathname) => ({ url: `http://localhost${pathname}`, nextUrl: new URL(`http://localhost${pathname}`), cookies: { get: () => undefined, getAll: () => [] }, headers: new Headers() })
  return { middleware, request, wasSupabaseCreated: () => supabaseCreated }
}

test('미들웨어는 꺼진 묶음의 페이지·API를 세션 처리 전에 404로 막는다', async () => {
  const { middleware, request, wasSupabaseCreated } = loadMiddleware({ ok: true, features: ['ai_generation', 'question_bank'] })
  const page = await middleware.updateSession(request('/admin/ai-question-generation-runs'))
  assert.equal(page.status, 404)
  assert.match(page.headers.get('content-type'), /text\/html/)
  assert.match(await page.text(), /사용하지 않는 기능/)

  const api = await middleware.updateSession(request('/api/admin/questions/upload'))
  assert.equal(api.status, 404)
  assert.deepEqual(await api.json(), { success: false, error: { code: 'NOT_FOUND', message: '사용하지 않는 기능입니다.' } })
  assert.equal(wasSupabaseCreated(), false)

  // 켜져 있는 묶음과 운영 경로는 막지 않고 원래 흐름(세션 처리)으로 넘어간다
  for (const path of ['/admin/menu-management', '/admin/support', '/api/admin/market/items']) {
    await assert.rejects(() => middleware.updateSession(request(path)), /원래 흐름으로 통과/, path)
  }
})

test('미들웨어는 설정을 읽지 못하면 묶음에 속한 경로를 막고 운영 경로는 그대로 둔다', async () => {
  const { middleware, request } = loadMiddleware({ ok: false })
  assert.equal((await middleware.updateSession(request('/admin/menu-management'))).status, 404)
  assert.equal((await middleware.updateSession(request('/api/admin/source-configs'))).status, 404)
  await assert.rejects(() => middleware.updateSession(request('/admin/refunds')), /원래 흐름으로 통과/)
})

test('사이드바는 꺼진 묶음의 메뉴를 그리지 않고, 묶음에 남은 메뉴가 없으면 묶음도 없다', () => {
  const sidebar = load('src/lib/admin-sidebar.ts', {
    'lucide-react': new Proxy({}, { get: () => () => null }),
    '@/lib/workspace-subject': load('src/lib/workspace-subject.ts'),
  })
  const state = { ok: true, features: ['question_bank', 'ai_generation', 'generate', 'passages', 'source_configs', 'labels', 'signup_roles'] }
  const config = sidebar.normalizeAdminSidebarNavigationConfig(null)
  const hiddenHrefs = config.items.filter((href) => features.isAdminPathDisabled(href, state))
  const nodes = sidebar.resolveAdminSidebarNavigationNodes('korean', config, hiddenHrefs)
  const hrefs = nodes.flatMap((node) => (node.type === 'group' ? node.items.map((item) => item.href) : [node.item.href]))
  assert.deepEqual(hrefs, [
    '/admin', '/admin/menu-management', '/admin/landing-pages',
    '/admin/main-ad-settings', '/admin/market-main-settings', '/admin/market/products/new', '/admin/market/products', '/admin/market/images', '/admin/market-categories',
    '/admin/users', '/admin/support', '/admin/footer', '/admin/pricing', '/admin/credits', '/admin/refunds', '/admin/reviews', '/admin/review-tags', '/admin/admin-accounts',
  ])
  assert.deepEqual(nodes.filter((node) => node.type === 'group').map((node) => node.id), ['market'])
  // 숨길 것이 없으면 지금과 같다
  assert.equal(sidebar.resolveAdminSidebarNavigationNodes('korean', config).length, sidebar.resolveAdminSidebarNavigationNodes('korean', config, []).length)
})

test('설정 행은 정의된 묶음만 담고, 메뉴관리·랜딩페이지 관리는 아직 끄지 않는다', () => {
  const migration = read('supabase/migrations/20261113140000_admin_disabled_features.sql')
  const value = JSON.parse(migration.match(/'(\{"features": \[[^\]]+\]\})'::jsonb/)[1])
  assert.deepEqual(value.features, ['question_bank', 'ai_generation', 'generate', 'passages', 'source_configs', 'labels', 'signup_roles'])
  const known = features.ADMIN_FEATURES.map((feature) => feature.id)
  for (const feature of value.features) assert.ok(known.includes(feature), feature)
  // 메뉴관리(로고·결제 화면 헤더가 아직 기댐)와 랜딩페이지 관리(옛 첫 화면이 아직 공개)는 아직 끄지 않는다
  assert.equal(value.features.includes('menu_management'), false)
  assert.equal(value.features.includes('landing_pages'), false)
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING;/)
  assert.match(read('supabase/rollback/20261113140000_admin_disabled_features_down.sql'), /DELETE FROM public\.system_settings WHERE key = 'admin_disabled_features';/)
})

// 꺼진 묶음의 쓰기 액션: 파일 → [묶음, 검사해야 하는 export]
const GUARDED_ACTIONS = {
  'src/app/(admin)/admin/problem-types/actions.ts': ['ai_generation', ['createProblemType', 'updateProblemType', 'deleteProblemType', 'updateProblemTypeSortOrder', 'updateProblemTypeDefaultPrompts']],
  'src/app/api/admin/labels/actions.ts': ['labels', ['updateDisplayLabel', 'addDisplayLabel', 'deleteDisplayLabel']],
  'src/app/(admin)/admin/landing-pages/actions.ts': ['landing_pages', ['saveMainLandingConfigAction', 'saveWorkspaceLandingConfigAction']],
  'src/app/(admin)/admin/roles/actions.ts': ['signup_roles', ['createRole', 'updateRole', 'deleteRole']],
  'src/app/api/admin/prompts/actions.ts': ['passages', ['updateSystemPrompt']],
  'src/app/api/admin/settings/actions.ts': ['passages', ['updateSystemSettings', 'updateAIModelSettings', 'saveAvailableAIModels']],
}

function functionBody(source, name) {
  const start = source.indexOf(`export async function ${name}(`)
  assert.ok(start >= 0, name)
  const next = source.indexOf('\nexport ', start + 1)
  return source.slice(start, next === -1 ? undefined : next)
}

test('꺼진 묶음의 쓰기 액션은 맨 먼저 기능 검사를 하고, 읽기 액션은 그대로 둔다', () => {
  for (const [path, [feature, names]] of Object.entries(GUARDED_ACTIONS)) {
    const source = read(path)
    assert.match(source.split('\n')[0], /^'use server'/, path)
    for (const name of names) {
      const body = functionBody(source, name)
      const firstStatement = body.slice(body.indexOf('{\n') + 2).trimStart().split('\n')[0]
      assert.equal(firstStatement, `await assertAdminFeatureEnabled('${feature}')`, `${path}: ${name}`)
    }
    // 이 파일의 쓰기 export(이름이 create·update·delete·save·add로 시작)는 빠짐없이 검사 대상이다
    const writeExports = [...source.matchAll(/^export async function ((?:create|update|delete|save|add)\w*)\(/gm)].map((match) => match[1])
    assert.deepEqual(writeExports.sort(), [...names].sort(), path)
  }
  // 예전 사용자 기능이 쓰는 읽기 액션은 막지 않는다
  const settings = read('src/app/api/admin/settings/actions.ts')
  for (const name of ['getSystemSettings', 'getAIModelSettings', 'getAvailableAIModels']) {
    assert.doesNotMatch(functionBody(settings, name), /assertAdminFeatureEnabled/, name)
  }
})

test('메뉴관리 액션: 문제생성 쓰기는 generate 묶음, 헤더·순서 저장은 menu_management 묶음, 메뉴 이름 바꾸기는 운영 기능이라 막지 않는다', () => {
  const source = read('src/app/(admin)/admin/menu-management/actions.ts')
  const generateWrites = [...source.matchAll(/^export async function ((?:create|update|archive|reorder|backfill)Generate\w*)\(/gm)].map((match) => match[1])
  assert.equal(generateWrites.length, 12)
  for (const name of generateWrites) {
    assert.match(functionBody(source, name), /\{\n  await assertAdminFeatureEnabled\('generate'\)\n/, name)
  }
  for (const name of ['saveAdminSidebarNavigationConfigAction', 'saveMenuManagementConfig', 'backfillMarketMenuEntriesAction']) {
    assert.match(functionBody(source, name), /\{\n  await assertAdminFeatureEnabled\('menu_management'\)\n/, name)
  }
  assert.doesNotMatch(functionBody(source, 'renameAdminSidebarMenuAction'), /assertAdminFeatureEnabled/)
})

// 묶음에 속한 관리자 페이지·API가 실제 파일 구조와 맞는지(새 화면이 묶음 밖에 생기면 여기서 드러난다)
function listRoutes(dir, fileName) {
  const found = []
  const walk = (current) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (entry === fileName) found.push(full)
    }
  }
  walk(dir)
  return found
}

test('관리자 페이지와 API 경로는 "운영 화면" 또는 "기능 묶음" 중 하나로 분류돼 있다', () => {
  const root = new URL('../src/app/', import.meta.url).pathname
  const toRoute = (file, suffix) => `/${file.slice(root.length, -suffix.length)}`.replace(/\/\([^)]+\)/g, '').replace(/\/$/, '')
  const pages = [
    ...listRoutes(join(root, '(admin)/admin'), 'page.tsx'),
    ...listRoutes(join(root, 'dashboard/admin'), 'page.tsx'),
  ].map((file) => toRoute(file, '/page.tsx'))
  const apis = listRoutes(join(root, 'api/admin'), 'route.ts').map((file) => toRoute(file, '/route.ts'))

  const OPERATIONAL_PREFIXES = [
    '/admin/support', '/admin/refunds', '/admin/users', '/admin/credits', '/admin/pricing', '/admin/market', '/admin/market-categories',
    '/admin/main-ad-settings', '/admin/market-main-settings', '/admin/reviews', '/admin/review-tags', '/admin/footer', '/admin/admin-accounts',
    '/api/admin/support', '/api/admin/refunds', '/api/admin/payments', '/api/admin/users', '/api/admin/market', '/api/admin/market-categories',
    '/api/admin/main-ad-settings', '/api/admin/market-main-settings', '/api/admin/reviews', '/api/admin/review-tags', '/api/admin/site-logo',
    '/api/admin/admin-accounts', '/api/admin/session', '/api/admin/stats',
  ]
  const isOperational = (route) => route === '/admin' || OPERATIONAL_PREFIXES.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))

  for (const route of [...pages, ...apis]) {
    const feature = features.resolveAdminFeature(route)
    assert.ok(Boolean(feature) !== isOperational(route), `${route}: 운영 화면과 기능 묶음 중 정확히 하나여야 한다(현재 묶음=${feature})`)
  }
  assert.ok(pages.length >= 39 && apis.length >= 78)
})

test('미들웨어 matcher는 확장자로 끝나는 관리자 경로도 덮는다', () => {
  const source = read('src/middleware.ts')
  for (const pattern of ["'/admin/:path*'", "'/api/admin/:path*'", "'/dashboard/admin/:path*'"]) {
    assert.ok(source.includes(pattern), pattern)
  }
  // 기존 규칙만으로는 확장자 경로가 빠진다는 사실을 고정해 둔다(그래서 위 세 줄이 필요하다)
  const general = new RegExp('^/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)$')
  assert.equal(general.test('/admin/ai-question-generation-runs/a.png'), false)
  assert.equal(general.test('/admin/ai-question-generation-runs/run-1'), true)
})

test('풀 수 없는 퍼센트 인코딩은 오류 없이 그대로 판정한다', () => {
  assert.equal(features.resolveAdminFeature('/admin/%E0%A4%A'), null)
  assert.equal(features.resolveAdminFeature('/admin/questions/%E0%A4%A'), 'question_bank')
})

test('만료 로그 정리는 AI 묶음이 꺼져 있으면 실행하지 않는다(어떤 경로로 불려도)', async () => {
  const source = read('src/lib/ai/question-generation-run-logs.ts')
  const body = functionBody(source, 'pruneExpiredAiQuestionGenerationRuns')
  assert.match(body, /\{\n  \/\/[^\n]+\n  await assertAdminFeatureEnabled\('ai_generation'\)\n/)

  let updated = false
  const logs = load('src/lib/ai/question-generation-run-logs.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => ({ from: () => ({ update: () => { updated = true; return { lt: async () => ({ error: null }) } } }) }) },
    '@/lib/admin-features-server': { assertAdminFeatureEnabled: async () => { throw new Error('사용하지 않는 기능입니다.') } },
  })
  await assert.rejects(() => logs.pruneExpiredAiQuestionGenerationRuns(), /사용하지 않는 기능입니다/)
  assert.equal(updated, false)
})
