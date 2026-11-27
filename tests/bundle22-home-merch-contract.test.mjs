import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createFakeAdmin, load, loadRoute, marketImages, op } from './helpers/market-images-harness.mjs'
import { LIGHT_FORBIDDEN, buildRehearsalFiles } from '../supabase/scripts/bundle22_rehearsal/generate.mjs'

// 22번 묶음 계약 시험(계획 docs/plan-bundle22-home-merch.md 8절): 회원 부품에 코드 문구 없음, 배너 기간 거르기는 캐시 밖,
// 홈 설정 일시 오류는 캐시 함수 안에서 throw, route 가드 네 곳·작업 기록 순서·409, 검색·미리보기 응답에 회원 정보 없음, 리허설 사본.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const home = load('src/lib/market-home.ts')
const pii = load('src/lib/member-facing-text-pii.ts')
const requestMeta = load('src/lib/admin-request-meta.ts')
const subjects = load('src/lib/workspace-subject.ts')
const audit = load('src/lib/admin-audit-log.ts')

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const STAFF_WITHOUT = { role: 'staff', grants: [{ permission: 'orders.view', limits: null }] }
const STAFF_WITH = { role: 'staff', grants: [{ permission: 'storefront.edit', limits: null }] }

test('회원 부품에 코드 한국어 제목·빈 문구가 없다(인기 빈 문구 포함) — 제목·문구는 DB 값', () => {
  for (const path of [
    'src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx',
    'src/app/preview/solvook-concept/_components/home/home-material-sections.tsx',
    'src/app/preview/solvook-concept/_components/home/featured-materials.tsx',
    'src/app/preview/solvook-concept/_components/home/market-home-sections.tsx',
    'src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx',
    'src/app/(solvook)/_components/solvook-home-view.tsx',
  ]) {
    const source = read(path)
    for (const copy of ['인기 다운로드 자료', '아직 다운로드 집계가 없습니다', '최근 등록된 수업 자료', '최근 등록된 자료가 없습니다', '추천 자료', '광고가 없습니다', '문제마켓 보기']) {
      assert.equal(source.includes(copy), false, `${path}: ${copy}`)
    }
  }
})

test('배너 기간 거르기는 unstable_cache 로 감싼 함수 안에 없고, page 두 곳이 요청마다 거른다', () => {
  const cache = read('src/lib/preview-home-cache.ts')
  const server = read('src/lib/main-ad-carousel-server.ts')
  const publicReader = server.slice(server.indexOf('export async function getPublicMainAdCarouselItems'), server.indexOf('export async function saveMainAdCarouselConfig'))
  assert.match(cache, /unstable_cache\(getPublicMainAdCarouselItems/)
  assert.doesNotMatch(cache, /isMainAdVisibleAt|filterVisibleMainAdItems|new Date|Date\.now/)
  assert.doesNotMatch(publicReader, /isMainAdVisibleAt|filterVisibleMainAdItems/)
  assert.match(publicReader, /getActiveMainAdCarouselItems\(config, subject\)/)
  assert.match(publicReader, /startsAt: item\.startsAt,\s*endsAt: item\.endsAt/)
  const memberPage = read('src/app/(solvook)/page.tsx')
  assert.match(memberPage, /const now = new Date\(\)/)
  assert.match(memberPage, /adItems: filterVisibleMainAdItems\(englishAds, now\)/)
  assert.match(memberPage, /adItems: filterVisibleMainAdItems\(koreanAds, now\)/)
  assert.match(read('src/app/preview/solvook-concept/page.tsx'), /filterVisibleMainAdItems\(cachedAdItems, new Date\(\)\)/)
})

test('홈 설정 일시 오류는 캐시 함수 안에서 throw — 캐시 키는 v3(17절에서 값 모양이 바뀜), 홈 진열 저장 태그로 바로 비운다', () => {
  const cache = read('src/lib/preview-home-cache.ts')
  const server = read('src/lib/market-home-server.ts')
  assert.match(cache, /unstable_cache\(getMarketHomeData, \['preview-market-home-v3'\]/)
  assert.match(cache, /tags: \[MARKET_PUBLIC_LIST_CACHE_TAG, MARKET_HOME_CACHE_TAG\]/)
  const loader = server.slice(server.indexOf('async function loadConfigRow'), server.indexOf('async function loadRecent'))
  assert.match(loader, /if \(error\) throw new Error\(error\.message\)/)
  const reader = server.slice(server.indexOf('export async function getMarketHomeData'), server.indexOf('export async function getMarketHomeFeaturedPreview'))
  assert.doesNotMatch(reader, /catch|allSettled/)
})

test('권한 다섯 곳(화면·저장·검색·추천 미리보기·인기 순위 미리보기)이 storefront.edit, 작업 기록 종류 세 개', () => {
  assert.match(read('src/app/(admin)/admin/market-main-settings/page.tsx'), /await requireAdminPagePermission\('storefront\.edit'\)/)
  for (const path of [
    'src/app/api/admin/market-main-settings/route.ts',
    'src/app/api/admin/market-main-settings/item-search/route.ts',
    'src/app/api/admin/market-main-settings/preview-items/route.ts',
    'src/app/api/admin/market-main-settings/preview-popular/route.ts',
  ]) {
    assert.match(read(path), /async function requireAdminUser\(permission: AdminPermissionRequirement = 'storefront\.edit'\)/, path)
  }
  for (const action of ['market_home_sections_save', 'market_home_sections_seed', 'main_ad_carousel_save']) {
    assert.ok(audit.ADMIN_AUDIT_ACTIONS[action], action)
  }
})

class Conflict extends Error {
  constructor() {
    super('다른 관리자가 먼저 저장했습니다. 다시 불러오세요.')
    this.name = 'MarketHomeRevisionConflictError'
  }
}

function loadRouteWith(path, session, serverMock) {
  const events = []
  const { route } = loadRoute(path, {
    ...session,
    mocks: {
      'next/cache': {
        revalidateTag: (...args) => events.push(['revalidateTag', ...args]),
        revalidatePath: (path) => events.push(['revalidatePath', path]),
      },
      '@/lib/admin-audit-log-server': { recordAdminAudit: async (entry) => { events.push(['audit', entry]); return true } },
      '@/lib/admin-request-meta': requestMeta,
      '@/lib/market-home': home,
      '@/lib/market-home-server': { MarketHomeRevisionConflictError: Conflict, ...serverMock(events) },
      '@/lib/member-facing-text-pii': pii,
      '@/lib/site-board-server': { readPiiAllowedContacts: async () => ({ customerCenter: '1588-0000', orderEmail: 'help@example.com' }) },
      '@/lib/workspace-subject': subjects,
    },
  })
  return { route, events }
}

const draft = {
  sections: [{ id: uuid(1), kind: 'popular', isActive: true, title: ' 인기 ', emptyText: null, limit: 12, rankingWindowDays: 30 }],
  emptyHomeLink: null,
}
const saveRequest = (body, subject = 'korean') => new Request(`https://example.com/api/admin/market-main-settings?subject=${subject}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': 'rh', 'x-forwarded-for': '203.0.113.1' },
  body: JSON.stringify(body),
})

test('저장 route: 권한 없으면 403(저장 안 함), 저장 성공 뒤에만 작업 기록(원문 없음) → 캐시 비움, 409·개인정보·형식 오류는 기록 없음', async () => {
  const save = (events, result = 'ok') => ({
    saveMarketHomeConfig: async (input) => {
      events.push(['save', input])
      if (result === 'conflict') throw new Conflict()
      return { config: { version: 2, revision: input.expectedRevision + 1, ...input.draft }, previousRevision: input.expectedRevision, previousSections: [] }
    },
  })

  const denied = loadRouteWith('src/app/api/admin/market-main-settings/route.ts', STAFF_WITHOUT, (events) => save(events))
  const deniedResponse = await denied.route.POST(saveRequest({ expectedRevision: 1, config: draft }))
  assert.equal(deniedResponse.status, 403)
  assert.deepEqual(denied.events, [])

  const ok = loadRouteWith('src/app/api/admin/market-main-settings/route.ts', STAFF_WITH, (events) => save(events))
  const response = await ok.route.POST(saveRequest({ expectedRevision: 3, config: draft }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).data.config.revision, 4)
  assert.deepEqual(ok.events.map(([kind]) => kind), ['save', 'audit', 'revalidateTag', 'revalidatePath', 'revalidatePath', 'revalidatePath'])
  assert.equal(ok.events[0][1].draft.sections[0].title, '인기')
  const entry = ok.events[1][1]
  assert.equal(entry.action, 'market_home_sections_save')
  assert.equal(entry.details.previousRevision, 3)
  assert.equal(entry.details.revision, 4)
  assert.deepEqual(entry.details.request, { ip: '203.0.113.1', user_agent: 'rh' })
  assert.equal(JSON.stringify(entry).includes('인기'), false)
  assert.deepEqual(ok.events[2].slice(1), ['market-home-config', { expire: 0 }])

  const conflict = loadRouteWith('src/app/api/admin/market-main-settings/route.ts', STAFF_WITH, (events) => save(events, 'conflict'))
  const conflictResponse = await conflict.route.POST(saveRequest({ expectedRevision: 1, config: draft }))
  assert.equal(conflictResponse.status, 409)
  assert.equal((await conflictResponse.json()).error.code, 'REVISION_CONFLICT')
  assert.deepEqual(conflict.events.map(([kind]) => kind), ['save'])

  for (const [body, code] of [
    [{ expectedRevision: 1, config: { ...draft, emptyHomeLink: '문의 010-1234-5678' } }, 'MEMBER_FACING_PII'],
    [{ expectedRevision: 1, config: { ...draft, sections: [{ ...draft.sections[0], title: 'me@mail.com 으로' }] } }, 'MEMBER_FACING_PII'],
    [{ expectedRevision: -1, config: draft }, 'INVALID_INPUT'],
    [{ expectedRevision: 1, config: { ...draft, sections: [] } }, 'INVALID_INPUT'],
    [{ expectedRevision: 1, config: { version: 2, revision: 1, ...draft } }, 'INVALID_INPUT'],
  ]) {
    const loaded = loadRouteWith('src/app/api/admin/market-main-settings/route.ts', STAFF_WITH, (events) => save(events))
    const result = await loaded.route.POST(saveRequest(body))
    assert.equal(result.status, 400)
    assert.equal((await result.json()).error.code, code)
    assert.deepEqual(loaded.events, [])
  }
  // 회사 고객센터 연락처(하단 정보 값)는 개인정보로 보지 않는다
  const allowed = loadRouteWith('src/app/api/admin/market-main-settings/route.ts', STAFF_WITH, (events) => save(events))
  assert.equal((await allowed.route.POST(saveRequest({ expectedRevision: 1, config: { ...draft, emptyHomeLink: '고객센터 1588-0000' } }))).status, 200)
})

test('검색·미리보기 route: 권한 없으면 403, 응답에 회원 정보 없음, 입력 검사', async () => {
  const searchRow = { id: uuid(5), title: '자료', status: 'published', isActive: true, deleted: false, thumbnailUrl: null }
  const mock = () => ({
    searchMarketHomeItems: async () => [searchRow],
    getMarketHomeFeaturedPreview: async () => ({ items: [], excluded: [{ id: uuid(6), reason: 'deleted', title: '지운 자료' }] }),
  })
  const searchUrl = 'https://example.com/api/admin/market-main-settings/item-search?subject=korean&q=%EC%9E%90%EB%A3%8C'
  const deniedSearch = loadRouteWith('src/app/api/admin/market-main-settings/item-search/route.ts', STAFF_WITHOUT, mock)
  assert.equal((await deniedSearch.route.GET(new Request(searchUrl))).status, 403)
  const search = loadRouteWith('src/app/api/admin/market-main-settings/item-search/route.ts', STAFF_WITH, mock)
  const searchBody = await (await search.route.GET(new Request(searchUrl))).json()
  assert.deepEqual(searchBody.data.items, [searchRow])
  assert.equal((await search.route.GET(new Request('https://example.com/x?subject=math'))).status, 400)

  const previewRequest = (body) => new Request('https://example.com/api/admin/market-main-settings/preview-items', { method: 'POST', body: JSON.stringify(body) })
  const deniedPreview = loadRouteWith('src/app/api/admin/market-main-settings/preview-items/route.ts', STAFF_WITHOUT, mock)
  assert.equal((await deniedPreview.route.POST(previewRequest({ subject: 'korean', itemIds: [] }))).status, 403)
  const preview = loadRouteWith('src/app/api/admin/market-main-settings/preview-items/route.ts', STAFF_WITH, mock)
  const previewBody = await (await preview.route.POST(previewRequest({ subject: 'korean', itemIds: [uuid(6)] }))).json()
  assert.deepEqual(Object.keys(previewBody.data).sort(), ['excluded', 'items'])
  for (const body of [{ subject: 'korean', itemIds: ['x'] }, { subject: 'math', itemIds: [] }, { subject: 'korean', itemIds: Array.from({ length: 25 }, (_, index) => uuid(index)) }]) {
    assert.equal((await preview.route.POST(previewRequest(body))).status, 400)
  }
})

test('17절 인기 순위 미리보기 route: 권한 없으면 403(읽지 않음), 일수 범위 검사, 응답은 일수와 공개 카드 목록만', async () => {
  const calls = []
  const mock = () => ({
    getMarketHomePopularPreview: async (subject, days) => {
      calls.push([subject, days])
      return [{ id: uuid(5), title: '자료', downloadUserCount: 3 }]
    },
  })
  const path = 'src/app/api/admin/market-main-settings/preview-popular/route.ts'
  const request = (body) => new Request('https://example.com/api/admin/market-main-settings/preview-popular', { method: 'POST', body: JSON.stringify(body) })
  const denied = loadRouteWith(path, STAFF_WITHOUT, mock)
  assert.equal((await denied.route.POST(request({ subject: 'korean', days: 7 }))).status, 403)
  assert.deepEqual(calls, [])

  const allowed = loadRouteWith(path, STAFF_WITH, mock)
  const body = await (await allowed.route.POST(request({ subject: 'korean', days: 7 }))).json()
  assert.deepEqual(body, { success: true, data: { days: 7, items: [{ id: uuid(5), title: '자료', downloadUserCount: 3 }] } })
  assert.deepEqual(calls, [['korean', 7]])
  for (const bad of [{ subject: 'math', days: 7 }, { subject: 'korean', days: 0 }, { subject: 'korean', days: 91 }, { subject: 'korean', days: 1.5 }, { subject: 'korean', days: '7' }, { subject: 'korean' }, []]) {
    assert.equal((await allowed.route.POST(request(bad))).status, 400, JSON.stringify(bad))
  }
  assert.equal(calls.length, 1)
  // 저장하지 않는 읽기 route 다(작업 기록·캐시 비움 없음)
  assert.deepEqual(allowed.events, [])
})

test('17절 저장 route: 기간 버튼 이름·펼치기·접기 글자도 개인정보 모양 검사를 하고, 검사를 통과한 값(첫 버튼 일수로 맞춘 집계 기간)을 저장한다', async () => {
  const save = (events) => ({
    saveMarketHomeConfig: async (input) => {
      events.push(['save', input])
      return { config: { version: 2, revision: input.expectedRevision + 1, ...input.draft }, previousRevision: input.expectedRevision, previousSections: [] }
    },
  })
  const withTabs = {
    sections: [{ ...draft.sections[0], limit: 20, collapsedLimit: 5, periodTabs: [{ label: ' 주간 ', days: 7 }, { label: '월간', days: 30 }] }],
    emptyHomeLink: null,
    expandLabel: ' 펼쳐보기 ',
    collapseLabel: '접기',
  }
  const ok = loadRouteWith('src/app/api/admin/market-main-settings/route.ts', STAFF_WITH, (events) => save(events))
  assert.equal((await ok.route.POST(saveRequest({ expectedRevision: 2, config: withTabs }))).status, 200)
  const saved = ok.events[0][1].draft
  assert.deepEqual(saved.sections[0].periodTabs, [{ label: '주간', days: 7 }, { label: '월간', days: 30 }])
  assert.equal(saved.sections[0].rankingWindowDays, 7)
  assert.equal(saved.sections[0].collapsedLimit, 5)
  assert.deepEqual([saved.expandLabel, saved.collapseLabel], ['펼쳐보기', '접기'])
  // 작업 기록에는 버튼 이름·버튼 글자 원문이 없다
  for (const raw of ['주간', '월간', '펼쳐보기', '접기']) assert.equal(JSON.stringify(ok.events[1][1]).includes(raw), false, raw)

  for (const [config, code] of [
    [{ ...withTabs, sections: [{ ...withTabs.sections[0], periodTabs: [{ label: '0212345678', days: 7 }] }] }, 'MEMBER_FACING_PII'],
    [{ ...withTabs, expandLabel: 'a@b.com' }, 'MEMBER_FACING_PII'],
    [{ ...withTabs, collapseLabel: null }, 'INVALID_INPUT'],
    [{ sections: withTabs.sections, emptyHomeLink: null }, 'INVALID_INPUT'],
  ]) {
    const loaded = loadRouteWith('src/app/api/admin/market-main-settings/route.ts', STAFF_WITH, (events) => save(events))
    const result = await loaded.route.POST(saveRequest({ expectedRevision: 1, config }))
    assert.equal(result.status, 400, JSON.stringify(config).slice(0, 80))
    assert.equal((await result.json()).error.code, code)
    assert.deepEqual(loaded.events, [])
  }
})

test('17절 회원 부품: 버튼 글자는 DB 값만 쓰고, 기간 버튼은 aria-pressed·펼치기는 aria-expanded, 기간을 바꾸면 접힌 채로', () => {
  const popular = read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx')
  const recent = read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx')
  const toggle = read('src/app/preview/solvook-concept/_components/home/expand-toggle.tsx')
  const sections = read('src/app/preview/solvook-concept/_components/home/market-home-sections.tsx')
  for (const source of [popular, recent, toggle, sections]) {
    for (const copy of ['월간', '주간', '일간', '펼쳐보기', '더보기', '접기']) assert.equal(source.includes(`'${copy}'`) || source.includes(`>${copy}<`), false, copy)
  }
  assert.match(popular, /visibleMarketHomePeriods\(\{ periods, emptyText \}\)/)
  assert.match(popular, /aria-pressed=\{tab === selected\}/)
  assert.match(popular, /onClick=\{\(\) => \{ setSelectedDays\(tab\.days\); setExpanded\(false\) \}\}/)
  for (const source of [popular, recent]) {
    assert.match(source, /collapseMarketHomeItems\((?:periodItems|items), \{ collapsedLimit, expandLabel, collapseLabel \}, expanded\)/)
    assert.match(source, /\{toggleLabel \? \(\n\s+<ExpandToggle label=\{toggleLabel\} expanded=\{expanded\} controls=\{listId\}/)
  }
  assert.match(toggle, /aria-expanded=\{expanded\}/)
  assert.match(toggle, /aria-controls=\{controls\}/)
  // 버튼 글자는 홈 설정(homeData)에서, 처음 보이는 개수·기간은 섹션에서 온다. 추천 섹션에는 넘기지 않는다.
  assert.equal((sections.match(/expandLabel=\{homeData\.expandLabel\}/g) ?? []).length, 2)
  assert.equal((sections.match(/collapsedLimit=\{section\.collapsedLimit\}/g) ?? []).length, 2)
  assert.match(sections, /periods=\{section\.periods\}/)
  const featured = sections.slice(sections.indexOf('<FeaturedMaterials'))
  assert.doesNotMatch(featured, /collapsedLimit|expandLabel|periods/)
})

test('17절 관리 화면: 미리보기는 저장 전 기간 버튼의 일수로 읽은 실제 순위와 회원 홈 부품을 쓴다', () => {
  const client = read('src/app/(admin)/admin/market-main-settings/market-main-settings-client.tsx')
  assert.match(client, /fetch\('\/api\/admin\/market-main-settings\/preview-popular', \{/)
  assert.match(client, /items: \(fetchedPopular\[tab\.days\] \?\? pool\.popularByDays\[tab\.days\] \?\? \[\]\)\.slice\(0, section\.limit\)/)
  assert.match(client, /expandLabel: payload\.expandLabel \?\? null,\n\s+collapseLabel: payload\.collapseLabel \?\? null,/)
  assert.match(client, /<MarketHomeSections subject=\{workspaceSubject\} homeData=\{previewData\}/)
  // 기간 버튼이 있으면 '집계 기간' 칸을 숨기고 '저장 뒤 반영' 안내도 하지 않는다
  assert.match(client, /editing\.kind === 'popular' && !editing\.periodTabs\?\.length \? \(/)
  assert.match(client, /popularDraft\.isActive && !popularDraft\.periodTabs\?\.length/)
})

test('검색·미리보기 서버: 상품 상태·공개 카드 칸만 읽고 돌려준다(회원·주문 표를 읽지 않음)', async (t) => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  t.after(() => {
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  const row = {
    id: uuid(7), title: '자료', status: 'hidden', is_active: true, deleted_at: null, workspace_subject: 'korean', thumbnail_image: null, category_item: null,
    summary: null, question_count: 3, source_type: null, source_1: null, source_2: null, source_3: null, source_4: null, pdf_price: 0, hwp_price: 0, zip_price: 0,
    published_at: null, created_at: '2026-11-01',
  }
  const admin = createFakeAdmin(() => ({ data: [row], error: null }))
  const server = load('src/lib/market-home-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/market-item-list-enrichment': { loadMarketItemListEnrichment: async () => ({ sampleCounts: new Map(), startingPrices: new Map(), ratingSummaries: new Map() }) },
    '@/lib/market-home': home,
    '@/lib/market-images': marketImages,
  })
  const found = await server.searchMarketHomeItems('korean', '자료%_')
  assert.deepEqual(Object.keys(found[0]).sort(), ['deleted', 'id', 'isActive', 'status', 'thumbnailUrl', 'title'])
  const searchCall = admin.calls[0]
  assert.equal(searchCall.table, 'market_items')
  assert.deepEqual(op(searchCall.ops, 'ilike').slice(1), ['title', '%자료\\%\\_%'])
  // PostgREST 가 * 를 % 로 바꾸므로 * 는 검색어에서 뺀다(전체 매칭 방지)
  await server.searchMarketHomeItems('korean', '*자*료*')
  assert.deepEqual(op(admin.calls.at(-1).ops, 'ilike').slice(1), ['title', '%자료%'])
  assert.ok(searchCall.ops.some(([name, column, value]) => name === 'eq' && column === 'workspace_subject' && value === 'korean'))
  const preview = await server.getMarketHomeFeaturedPreview('korean', [uuid(7)])
  assert.deepEqual(preview, { items: [], excluded: [{ id: uuid(7), reason: 'not_published', title: '자료' }] })
  assert.deepEqual([...new Set(admin.calls.map((call) => call.table))], ['market_items'])
})

test('리허설 사본: 생성기 결과와 같고, COMMIT·표 잠금 DDL 없음, 시험 계정 행위자', () => {
  const files = buildRehearsalFiles()
  assert.deepEqual(Object.keys(files), ['a_light.sql'])
  const light = read('supabase/scripts/bundle22_rehearsal/a_light.sql')
  assert.equal(light, files['a_light.sql'])
  assert.ok(light.trimEnd().endsWith('ROLLBACK;'))
  const body = light.replace(/--[^\n]*/g, '')
  for (const word of LIGHT_FORBIDDEN) assert.equal(body.includes(word), false, word)
  assert.match(light, /u\.email LIKE '%@test\.com'/)
  assert.match(light, /set_config\('bundle22\.rehearsal_actor'/)
  for (const testName of ['H1', 'H2', 'H4', 'H6', 'R']) assert.match(light, new RegExp(`-- ===== ${testName} =====`))
})

test('시드·되돌림 스크립트: 행만(ON CONFLICT DO NOTHING·판 1 만 UPDATE), gen_random_uuid, 실행 확인, 작업 기록, revision 1 만 지움', () => {
  const seed = read('supabase/scripts/20261224_bundle22_home_sections_seed.sql')
  const revert = read('supabase/scripts/20261224_bundle22_home_sections_seed_revert.sql')
  for (const script of [seed, revert]) {
    assert.match(script, /SET LOCAL lock_timeout = '3s';/)
    assert.match(script, /IF NULL::text IS DISTINCT FROM 'apply' THEN/)
    assert.doesNotMatch(script.replace(/--[^\n]*/g, ''), /ALTER TABLE|LOCK TABLE|CREATE INDEX|TRUNCATE/)
    assert.match(script, /'market_home_sections_seed'/)
  }
  assert.match(seed, /ON CONFLICT \(workspace_subject, setting_key\) DO NOTHING/)
  assert.match(seed, /value ->> 'version' IS DISTINCT FROM '2'/)
  assert.equal((seed.match(/gen_random_uuid\(\)::text/g) ?? []).length, 3)
  for (const copy of ['인기 다운로드 자료', '아직 다운로드 집계가 없습니다.', '최근 등록된 수업 자료', '최근 등록된 자료가 없습니다.', '국어 문제마켓 보기', '영어 문제마켓 보기']) {
    assert.ok(seed.includes(`'${copy}'`), copy)
  }
  assert.match(revert, /value ->> 'version' = '2' AND value ->> 'revision' = '1'/)
  assert.match(revert, /코드를 되돌린\(revert·배포\) 뒤에만/)
})
