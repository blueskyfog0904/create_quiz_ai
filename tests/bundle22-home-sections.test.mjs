import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createFakeAdmin, load, marketImages, op } from './helpers/market-images-harness.mjs'

// 22번 묶음 순수 시험(계획 docs/plan-bundle22-home-merch.md 8절): 판 2 검사, 판 1·행 없음 → 설정 없음, H3·H5,
// 시드 값으로 그린 국어·영어 홈이 지금과 같음, 섹션 이동·추가, 추천 거르기, 3-4 저장 경로별 조건.
const home = load('src/lib/market-home.ts')
const seed = JSON.parse(readFileSync(new URL('./fixtures/bundle22-seed-values.json', import.meta.url), 'utf8'))
// 22번 전 판 1 파일 사본(H3)
const homeV1 = load('tests/fixtures/bundle22-market-home-v1.ts')

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const popular = (extra = {}) => ({ id: uuid(1), kind: 'popular', isActive: true, title: '인기', emptyText: '없음', limit: 12, rankingWindowDays: 30, ...extra })
const recent = (extra = {}) => ({ id: uuid(2), kind: 'recent', isActive: true, title: '최근', emptyText: null, limit: 8, ...extra })
const featured = (extra = {}) => ({ id: uuid(3), kind: 'featured', isActive: true, title: '추천', emptyText: null, itemIds: [uuid(101)], ...extra })
const config = (sections, extra = {}) => ({ version: 2, revision: 1, sections, emptyHomeLink: null, ...extra })

test('H5: 리허설이 넣은 두 value 는 새 판 2 검사를 통과하고 그대로 돌아온다', () => {
  for (const subject of ['korean', 'english']) {
    assert.deepEqual(home.validateMarketHomeConfig(seed[subject]), seed[subject])
    assert.equal(home.readMarketHomeConfig(seed[subject]).state, 'ok')
  }
  assert.equal(seed.korean.emptyHomeLink, '국어 문제마켓 보기')
  assert.equal(seed.english.emptyHomeLink, '영어 문제마켓 보기')
})

test('H3: 옛 코드(판 1)는 판 2 값을 기본값(인기 켜짐 12개·30일, 최근 켜짐 8개)으로 읽는다 — 시드~배포 사이 회원 홈 그대로', () => {
  for (const subject of ['korean', 'english']) {
    assert.deepEqual(homeV1.normalizeMarketHomeConfig(seed[subject]), {
      version: 1,
      popular: { isActive: true, limit: 12, rankingWindowDays: 30 },
      recent: { isActive: true, limit: 8 },
    })
  }
})

test('판 2 검사: 종류·개수·길이·중복·모르는 칸을 거절한다', () => {
  assert.deepEqual(home.validateMarketHomeConfig(config([popular(), recent(), featured()])).sections.length, 3)
  const bad = [
    config([]),
    config(Array.from({ length: 9 }, (_, index) => featured({ id: uuid(10 + index) }))),
    config([popular(), popular({ id: uuid(9) })]),
    config([recent(), recent({ id: uuid(9) })]),
    config([popular(), recent({ id: uuid(1) })]),
    config([popular({ title: '' })]),
    config([popular({ title: '가'.repeat(41) })]),
    config([popular({ title: '줄\n바꿈' })]),
    config([popular({ emptyText: '' })]),
    config([popular({ emptyText: '가'.repeat(81) })]),
    config([popular({ limit: 25 })]),
    config([popular({ rankingWindowDays: 0 })]),
    config([recent({ limit: 0 })]),
    config([featured({ itemIds: Array.from({ length: 25 }, (_, index) => uuid(200 + index)) })]),
    config([featured({ itemIds: [uuid(5), uuid(5)] })]),
    config([featured({ itemIds: ['not-a-uuid'] })]),
    config([{ ...featured(), kind: 'category' }]),
    config([{ ...popular(), extra: 1 }]),
    config([Object.fromEntries(Object.entries(popular()).filter(([key]) => key !== 'emptyText'))]),
    config([popular()], { revision: 0 }),
    config([popular()], { version: 1 }),
    { ...config([popular()]), extra: true },
    config([popular()], { emptyHomeLink: '' }),
  ]
  for (const value of bad) assert.throws(() => home.validateMarketHomeConfig(value), home.MarketHomeValidationError, JSON.stringify(value).slice(0, 120))
  // 추천 섹션은 여러 개, 상품 24개까지
  assert.equal(home.validateMarketHomeConfig(config([featured(), featured({ id: uuid(4), itemIds: Array.from({ length: 24 }, (_, index) => uuid(300 + index)) })])).sections.length, 2)
})

test('판 1·행 없음 → 설정 없음(revision 0), 판 2 형식 오류 → 저장된 revision 과 읽을 수 있는 섹션만', () => {
  for (const value of [null, undefined, 'text', [], { version: 1, popular: {}, recent: {} }]) {
    assert.deepEqual(home.readMarketHomeConfig(value), { state: 'missing', config: null, revision: 0 })
  }
  const broken = { version: 2, revision: 6, sections: [popular(), { ...recent(), limit: 99 }, featured(), popular({ id: uuid(8) })], emptyHomeLink: '국어 보기', extra: 1 }
  const read = home.readMarketHomeConfig(broken)
  assert.equal(read.state, 'invalid')
  assert.equal(read.revision, 6)
  assert.deepEqual(read.readableSections.map((section) => section.id), [uuid(1), uuid(3)])
  assert.equal(read.emptyHomeLink, '국어 보기')
  assert.equal(home.readMarketHomeConfig({ version: 2, revision: 'x', sections: [] }).revision, 0)
})

test('회원 홈에 보일 섹션: 0개 섹션은 빈 화면 문구가 있을 때만, 빈 홈 링크는 섹션·배너 모두 0개일 때만', () => {
  const rendered = [
    { id: 'a', kind: 'popular', title: '인기', emptyText: '집계 없음', items: [] },
    { id: 'b', kind: 'recent', title: '최근', emptyText: null, items: [] },
    { id: 'c', kind: 'featured', title: '추천', emptyText: null, items: [{ id: 'x' }] },
  ]
  assert.deepEqual(home.visibleMarketHomeSections(rendered).map((section) => section.id), ['a', 'c'])
  const data = { sections: [rendered[1]], emptyHomeLink: '국어 문제마켓 보기' }
  assert.equal(home.shouldShowEmptyHomeLink(data, 0), true)
  assert.equal(home.shouldShowEmptyHomeLink(data, 1), false)
  assert.equal(home.shouldShowEmptyHomeLink({ ...data, emptyHomeLink: null }, 0), false)
  assert.equal(home.shouldShowEmptyHomeLink({ ...data, sections: [rendered[0]] }, 0), false)
})

test('섹션 이동·추가: 인기·최근은 하나씩, 전체 8개까지, 새 섹션은 꺼진 채 제목 없이 맨 아래', () => {
  const sections = [popular(), recent(), featured()]
  assert.deepEqual(home.moveMarketHomeSection(sections, 2, 'up').map((section) => section.kind), ['popular', 'featured', 'recent'])
  assert.equal(home.moveMarketHomeSection(sections, 0, 'up'), sections)
  assert.equal(home.moveMarketHomeSection(sections, 2, 'down'), sections)
  assert.equal(home.addMarketHomeSection(sections, 'popular', uuid(50)), sections)
  assert.equal(home.canAddMarketHomeSection(sections, 'recent'), false)
  const added = home.addMarketHomeSection(sections, 'featured', uuid(50))
  assert.deepEqual(added.at(-1), { id: uuid(50), kind: 'featured', isActive: false, title: '', emptyText: null, itemIds: [] })
  const full = Array.from({ length: 8 }, (_, index) => featured({ id: uuid(60 + index) }))
  assert.equal(home.canAddMarketHomeSection(full, 'featured'), false)
  assert.deepEqual(home.createMarketHomeSection('popular', uuid(70)), { id: uuid(70), kind: 'popular', isActive: false, title: '', emptyText: null, limit: 12, rankingWindowDays: 30 })
  assert.deepEqual(home.addFeaturedItem([uuid(1)], uuid(1)), [uuid(1)])
  assert.deepEqual(home.addFeaturedItem([uuid(1)], uuid(2).toUpperCase()), [uuid(1), uuid(2)])
  assert.deepEqual(home.removeFeaturedItem([uuid(1), uuid(2)], uuid(1)), [uuid(2)])
})

test('추천 거르기(Q3): 공개·활성·삭제 안 됨·같은 과목만, 고른 순서 유지, 빠진 상품은 이유와 함께', () => {
  const row = (id, extra = {}) => ({ id, workspace_subject: 'korean', status: 'published', is_active: true, deleted_at: null, ...extra })
  const rows = [
    row(uuid(4)),
    row(uuid(2), { status: 'hidden' }),
    row(uuid(3), { workspace_subject: 'english' }),
    row(uuid(1)),
    row(uuid(5), { deleted_at: '2026-11-01' }),
    row(uuid(6), { is_active: false }),
  ]
  const result = home.filterFeaturedItems([uuid(1), uuid(2), uuid(3), uuid(9), uuid(4), uuid(5), uuid(6)], rows, 'korean')
  assert.deepEqual(result.visible.map((entry) => entry.id), [uuid(1), uuid(4)])
  assert.deepEqual(result.excluded.map((entry) => [entry.id, entry.reason]), [
    [uuid(2), 'not_published'], [uuid(3), 'other_subject'], [uuid(9), 'not_found'], [uuid(5), 'deleted'], [uuid(6), 'inactive'],
  ])
  for (const reason of Object.keys(home.MARKET_HOME_FEATURED_EXCLUSION_LABELS)) assert.ok(home.MARKET_HOME_FEATURED_EXCLUSION_LABELS[reason])
})

test('작업 기록 차이(7절): 종류·켜기·제목 글자 수·상품 id 차이만, 제목·문구 원문 없음', () => {
  const before = [popular({ title: '비밀 제목' }), featured({ itemIds: [uuid(101), uuid(102)] }), recent()]
  const after = [featured({ itemIds: [uuid(102), uuid(103)], title: '새 추천 제목' }), popular({ title: '비밀 제목', isActive: false }), featured({ id: uuid(9), title: '더한 섹션' })]
  const changes = home.diffMarketHomeSections(before, after)
  const text = JSON.stringify(changes)
  for (const raw of ['비밀 제목', '새 추천 제목', '더한 섹션', '없음']) assert.equal(text.includes(raw), false, raw)
  assert.deepEqual(changes.map((change) => [change.id, change.change]), [[uuid(3), 'updated'], [uuid(1), 'updated'], [uuid(9), 'added'], [uuid(2), 'removed']])
  assert.deepEqual(changes[0].addedItemIds, [uuid(103)])
  assert.deepEqual(changes[0].removedItemIds, [uuid(101)])
  assert.deepEqual(changes[1].fields, ['position', 'isActive'])
  assert.equal(changes[0].titleLength, '새 추천 제목'.length)
})

// ---------------------------------------------------------------------------------------------------------------
// 서버(가짜 DB): 회원 홈 읽기와 3-4 저장 경로
// ---------------------------------------------------------------------------------------------------------------

function withEnv(t) {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  t.after(() => {
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
}

const itemRow = (id) => ({
  id, title: `자료 ${id}`, summary: null, question_count: null, source_type: null, source_1: null, source_2: null, source_3: null, source_4: null,
  pdf_price: 0, hwp_price: 0, zip_price: 0, published_at: '2026-11-01', created_at: '2026-11-01', thumbnail_image: null, category_item: null,
  workspace_subject: 'korean', status: 'published', is_active: true, deleted_at: null,
})

function loadServer({ setting, settingError = null, popularRows = [], recentRows = [], update = () => ({ data: [{ id: 'row' }], error: null }) } = {}) {
  const errors = []
  const admin = createFakeAdmin(({ table, ops }) => {
    if (table === 'workspace_settings') {
      if (op(ops, 'update') || op(ops, 'upsert')) return update(ops)
      return { data: setting === undefined ? null : { value: setting }, error: settingError }
    }
    if (table === 'market_items') {
      const ids = ops.find(([name, column]) => name === 'in' && column === 'id')?.[2]
      return { data: ids ? ids.map(itemRow) : recentRows.map(itemRow), error: null }
    }
    return { data: [], error: null }
  }, {
    rpc: (name) => (name === 'get_market_home_popular_items'
      ? { data: popularRows.map((id) => ({ item_id: id, download_issuer_user_count: 2 })), error: null }
      : { data: null, error: { message: name } }),
  })
  const server = load('src/lib/market-home-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/market-item-list-enrichment': {
      loadMarketItemListEnrichment: async () => ({ sampleCounts: new Map(), startingPrices: new Map(), ratingSummaries: new Map() }),
    },
    '@/lib/market-home': home,
    '@/lib/market-images': marketImages,
  }, errors)
  return { admin, server, errors }
}

// 22번 전 회원 부품의 코드 글(지금 모습). 시드가 같은 글을 DB 에 넣는다.
const CURRENT_COPY = {
  popularTitle: '인기 다운로드 자료',
  popularEmpty: '아직 다운로드 집계가 없습니다.',
  recentTitle: '최근 등록된 수업 자료',
  recentEmpty: '최근 등록된 자료가 없습니다.',
}

test('시드 값으로 그리면 국어·영어 모두 지금과 같은 섹션·순서·개수·문구(영어 인기 0개 → 빈 문구)', async (t) => {
  withEnv(t)
  const shapes = {}
  for (const [subject, popularRows] of [['korean', [uuid(1), uuid(2)]], ['english', []]]) {
    const { server, admin } = loadServer({ setting: seed[subject], popularRows, recentRows: [uuid(7), uuid(8)] })
    const data = await server.getMarketHomeData(subject)
    const visible = home.visibleMarketHomeSections(data.sections)
    shapes[subject] = visible.map((section) => [section.kind, section.title, section.items.length, section.items.length === 0 ? section.emptyText : null])
    // 추천은 꺼진 채라 읽지 않는다
    assert.equal(admin.calls.filter((call) => call.table === 'market_items' && op(call.ops, 'in')?.[2]?.includes?.(uuid(101))).length, 0)
    const rpc = admin.calls.find((call) => call.type === 'rpc')
    assert.equal(rpc.args.p_limit, 12)
    const recentQuery = admin.calls.find((call) => call.table === 'market_items' && op(call.ops, 'limit'))
    assert.equal(op(recentQuery.ops, 'limit')[1], 8)
  }
  assert.deepEqual(shapes.korean, [['popular', CURRENT_COPY.popularTitle, 2, null], ['recent', CURRENT_COPY.recentTitle, 2, null]])
  assert.deepEqual(shapes.english, [['popular', CURRENT_COPY.popularTitle, 0, CURRENT_COPY.popularEmpty], ['recent', CURRENT_COPY.recentTitle, 2, null]])
  assert.equal(seed.korean.sections[1].emptyText, CURRENT_COPY.recentEmpty)
})

test('회원 홈 읽기: 설정 없음·형식 오류는 섹션 0개 + 서버 로그, 읽기 오류는 던진다, 꺼진 섹션은 읽지 않는다', async (t) => {
  withEnv(t)
  for (const setting of [undefined, { version: 1, popular: {}, recent: {} }, { version: 2, revision: 1, sections: 'x', emptyHomeLink: null }]) {
    const { server, admin, errors } = loadServer({ setting })
    const data = await server.getMarketHomeData('korean')
    assert.deepEqual(data.sections, [])
    assert.ok(['missing', 'invalid'].includes(data.state))
    assert.equal(data.emptyHomeLink, null)
    assert.equal(admin.calls.some((call) => call.type === 'rpc' || call.table === 'market_items'), false)
    assert.equal(errors.length, 1)
  }
  const failing = loadServer({ setting: seed.korean, settingError: { message: 'timeout' } })
  await assert.rejects(() => failing.server.getMarketHomeData('korean'), /timeout/)

  const off = loadServer({ setting: config([popular({ isActive: false }), recent()]) })
  const data = await off.server.getMarketHomeData('korean')
  assert.deepEqual(data.sections.map((section) => section.kind), ['recent'])
  assert.equal(off.admin.calls.some((call) => call.type === 'rpc'), false)
  assert.deepEqual(home.marketHomeReadFailed('english'), { subject: 'english', state: 'error', sections: [], emptyHomeLink: null, expandLabel: null, collapseLabel: null })
})

test('3-4 저장 경로: revision ≥ 1 은 판 2·같은 revision 조건, 0 은 행 없음 INSERT DO NOTHING·판 1 UPDATE, 0행이면 409', async (t) => {
  withEnv(t)
  const draft = { sections: [popular()], emptyHomeLink: null }
  const run = async (setting, expectedRevision, update) => {
    const loaded = loadServer({ setting, update })
    const result = await loaded.server.saveMarketHomeConfig({ workspaceSubject: 'korean', expectedRevision, draft, actorId: uuid(900) })
    const write = loaded.admin.calls.find((call) => call.table === 'workspace_settings' && (op(call.ops, 'update') || op(call.ops, 'upsert')))
    return { result, ops: write.ops }
  }

  const v2 = await run(seed.korean, 1)
  assert.equal(v2.result.config.revision, 2)
  assert.deepEqual(v2.ops.filter(([name]) => name === 'eq').map(([, column, value]) => [column, value]), [
    ['workspace_subject', 'korean'], ['setting_key', 'market_home'], ['value->>version', '2'], ['value->>revision', '1'],
  ])
  assert.equal(op(v2.ops, 'update')[1].value.version, 2)
  assert.equal(op(v2.ops, 'update')[1].updated_by, uuid(900))
  assert.deepEqual(v2.result.previousSections, seed.korean.sections)

  const none = await run(undefined, 0)
  assert.equal(none.result.config.revision, 1)
  assert.deepEqual(op(none.ops, 'upsert')[2], { onConflict: 'workspace_subject,setting_key', ignoreDuplicates: true })
  assert.equal(op(none.ops, 'upsert')[1].workspace_subject, 'korean')

  const v1 = await run({ version: 1, popular: {}, recent: {} }, 0)
  assert.equal(v1.result.config.revision, 1)
  assert.deepEqual(op(v1.ops, 'neq').slice(1), ['value->>version', '2'])
  assert.deepEqual(v1.result.previousSections, [])

  const noVersion = await run({ something: true }, 0)
  assert.deepEqual(op(noVersion.ops, 'is').slice(1), ['value->>version', null])

  for (const [setting, expected] of [[seed.korean, 1], [seed.korean, 0], [undefined, 0]]) {
    const loaded = loadServer({ setting, update: () => ({ data: [], error: null }) })
    await assert.rejects(
      () => loaded.server.saveMarketHomeConfig({ workspaceSubject: 'korean', expectedRevision: expected, draft, actorId: uuid(900) }),
      (error) => error.name === 'MarketHomeRevisionConflictError' && /다른 관리자가 먼저 저장했습니다/.test(error.message)
    )
  }
})

test('섹션 제목 강조: **…** 로 감싼 부분만 강조로 나뉘고, 짝이 없는 ** 와 이모지는 글자 그대로 남는다', () => {
  assert.deepEqual(home.splitMarketHomeTitle('인기 다운로드 자료'), [{ text: '인기 다운로드 자료', emphasis: false }])
  assert.deepEqual(home.splitMarketHomeTitle('🔥 인기 **다운로드** 자료'), [
    { text: '🔥 인기 ', emphasis: false },
    { text: '다운로드', emphasis: true },
    { text: ' 자료', emphasis: false },
  ])
  assert.deepEqual(home.splitMarketHomeTitle('**최근** 등록된 **수업 자료**'), [
    { text: '최근', emphasis: true },
    { text: ' 등록된 ', emphasis: false },
    { text: '수업 자료', emphasis: true },
  ])
  assert.deepEqual(home.splitMarketHomeTitle('별표 ** 하나만'), [{ text: '별표 ** 하나만', emphasis: false }])
  assert.equal(home.plainMarketHomeTitle('🔥 인기 **다운로드** 자료'), '🔥 인기 다운로드 자료')
  // 강조 표시가 든 제목도 판 2 구조 검사를 그대로 통과한다(길이는 표시까지 센다)
  assert.equal(home.validateMarketHomeConfig(config([popular({ title: '🔥 인기 **다운로드** 자료' })])).sections[0].title, '🔥 인기 **다운로드** 자료')
})

// ---------------------------------------------------------------------------------------------------------------
// 17절: 인기 기간 버튼과 펼쳐보기(새 칸은 모두 선택 — 없으면 22번과 같은 모양·같은 동작)
// ---------------------------------------------------------------------------------------------------------------

const tabs = [{ label: '월간', days: 30 }, { label: '주간', days: 7 }]
const labels = { expandLabel: '펼쳐보기', collapseLabel: '접기' }

test('17절 검사: 새 칸이 없으면 값이 그대로, 있으면 기간 버튼·처음 보이는 개수·버튼 글자를 검사하고 집계 기간을 첫 버튼에 맞춘다', () => {
  // 새 칸이 없는 값에는 칸을 더하지 않는다(시드 값·지금 저장된 값과 같은 모양)
  const plain = home.validateMarketHomeConfig(config([popular(), recent()]))
  assert.deepEqual(Object.keys(plain).sort(), ['emptyHomeLink', 'revision', 'sections', 'version'])
  assert.equal('periodTabs' in plain.sections[0] || 'collapsedLimit' in plain.sections[0] || 'collapsedLimit' in plain.sections[1], false)

  const full = home.validateMarketHomeConfig(config(
    [popular({ limit: 20, rankingWindowDays: 14, collapsedLimit: 5, periodTabs: [{ label: ' 주간 ', days: 7 }, { label: '월간', days: 30 }] }), recent({ limit: 20, collapsedLimit: 5 })],
    labels
  ))
  assert.deepEqual(full.sections[0].periodTabs, [{ label: '주간', days: 7 }, { label: '월간', days: 30 }])
  assert.equal(full.sections[0].rankingWindowDays, 7)
  assert.equal(full.sections[0].collapsedLimit, 5)
  assert.equal(full.sections[1].collapsedLimit, 5)
  assert.deepEqual([full.expandLabel, full.collapseLabel], ['펼쳐보기', '접기'])
  assert.equal(home.readMarketHomeConfig(config([popular({ periodTabs: tabs })])).state, 'ok')
  // 처음 보이는 개수 = 개수 도 된다(버튼은 숨은 상품이 없어 나오지 않는다)
  assert.equal(home.validateMarketHomeConfig(config([recent({ collapsedLimit: 8 })], labels)).sections[0].collapsedLimit, 8)
  // 버튼 글자만 있고 쓰는 섹션이 없어도 된다
  assert.equal(home.validateMarketHomeConfig(config([recent()], labels)).expandLabel, '펼쳐보기')

  const bad = [
    config([popular({ periodTabs: [] })]),
    config([popular({ periodTabs: [...tabs, { label: '일간', days: 1 }, { label: '분기', days: 90 }] })]),
    config([popular({ periodTabs: [{ label: '월간', days: 30 }, { label: '한 달', days: 30 }] })]),
    config([popular({ periodTabs: [{ label: '', days: 30 }] })]),
    config([popular({ periodTabs: [{ label: '가'.repeat(11), days: 30 }] })]),
    config([popular({ periodTabs: [{ label: '월간', days: 0 }] })]),
    config([popular({ periodTabs: [{ label: '월간', days: 91 }] })]),
    config([popular({ periodTabs: [{ label: '월간', days: 30, extra: 1 }] })]),
    config([popular({ periodTabs: [{ label: '월간' }] })]),
    config([popular({ periodTabs: 'x' })]),
    config([recent({ periodTabs: tabs })]),
    config([featured({ collapsedLimit: 1 })]),
    config([popular({ collapsedLimit: 0 })], labels),
    config([popular({ collapsedLimit: 13 })], labels),
    config([recent({ collapsedLimit: 2.5 })], labels),
    // 처음 보이는 개수를 쓰면 버튼 글자 둘 다 있어야 한다
    config([recent({ collapsedLimit: 5 })]),
    config([recent({ collapsedLimit: 5 })], { expandLabel: '펼쳐보기' }),
    config([recent({ collapsedLimit: 5 })], { expandLabel: '펼쳐보기', collapseLabel: null }),
    config([recent()], { expandLabel: '' }),
    config([recent()], { collapseLabel: '가'.repeat(21) }),
  ]
  for (const value of bad) assert.throws(() => home.validateMarketHomeConfig(value), home.MarketHomeValidationError, JSON.stringify(value).slice(0, 160))

  // 형식 오류 값도 읽을 수 있는 버튼 글자는 편집 시작값으로 돌려준다
  const broken = home.readMarketHomeConfig({ ...config([popular({ periodTabs: tabs }), { ...recent(), limit: 99 }], labels) })
  assert.equal(broken.state, 'invalid')
  assert.deepEqual(broken.readableSections.map((section) => section.periodTabs?.length ?? null), [2])
  assert.deepEqual([broken.expandLabel, broken.collapseLabel], ['펼쳐보기', '접기'])
})

test('17절 빈 목록 규칙: 빈 화면 문구가 있으면 0개 기간도 버튼을 보이고, 없으면 그 버튼을 숨기고 모든 기간이 0개면 섹션째 숨긴다', () => {
  const period = (label, days, count) => ({ label, days, items: Array.from({ length: count }, (_, index) => ({ id: `${days}-${index}` })) })
  const section = (emptyText, periods) => ({ id: 'p', kind: 'popular', title: '인기', emptyText, items: periods[0].items, periods })
  const mixed = [period('월간', 30, 3), period('주간', 7, 0)]
  assert.deepEqual(home.visibleMarketHomePeriods(section('집계 없음', mixed)).map((entry) => entry.label), ['월간', '주간'])
  assert.deepEqual(home.visibleMarketHomePeriods(section(null, mixed)).map((entry) => entry.label), ['월간'])
  assert.deepEqual(home.visibleMarketHomePeriods({ periods: null, emptyText: '집계 없음' }), [])
  // 첫 기간(items)이 0개여도 다른 기간에 상품이 있으면 섹션은 보인다
  const firstEmpty = section(null, [period('주간', 7, 0), period('월간', 30, 2)])
  assert.equal(firstEmpty.items.length, 0)
  assert.equal(home.visibleMarketHomeSections([firstEmpty]).length, 1)
  assert.deepEqual(home.visibleMarketHomePeriods(firstEmpty).map((entry) => entry.label), ['월간'])
  const allEmpty = [period('월간', 30, 0), period('주간', 7, 0)]
  assert.equal(home.visibleMarketHomeSections([section(null, allEmpty)]).length, 0)
  assert.equal(home.visibleMarketHomeSections([section('집계 없음', allEmpty)]).length, 1)
  assert.equal(home.shouldShowEmptyHomeLink({ sections: [section(null, allEmpty)], emptyHomeLink: '보기' }, 0), true)
  assert.equal(home.shouldShowEmptyHomeLink({ sections: [firstEmpty], emptyHomeLink: '보기' }, 0), false)
})

test('17절 펼치기 계산: 접힌 동안은 처음 개수만, 버튼 글자는 지금 누르면 할 일, 숨은 상품이 없거나 글자가 없으면 버튼 없이 모두', () => {
  const items = Array.from({ length: 12 }, (_, index) => index)
  const collapse = { collapsedLimit: 5, ...labels }
  assert.deepEqual(home.collapseMarketHomeItems(items, collapse, false), { visible: [0, 1, 2, 3, 4], toggleLabel: '펼쳐보기' })
  assert.deepEqual(home.collapseMarketHomeItems(items, collapse, true), { visible: items, toggleLabel: '접기' })
  assert.deepEqual(home.collapseMarketHomeItems(items.slice(0, 5), collapse, false), { visible: [0, 1, 2, 3, 4], toggleLabel: null })
  assert.deepEqual(home.collapseMarketHomeItems(items.slice(0, 3), collapse, false), { visible: [0, 1, 2], toggleLabel: null })
  for (const noCollapse of [
    { collapsedLimit: null, ...labels },
    { ...labels },
    { collapsedLimit: 5, expandLabel: null, collapseLabel: '접기' },
    { collapsedLimit: 5, expandLabel: '펼쳐보기', collapseLabel: null },
  ]) assert.deepEqual(home.collapseMarketHomeItems(items, noCollapse, false), { visible: items, toggleLabel: null })
})

test('17절 기간 버튼 더하기·작업 기록: 일수는 쓰지 않은 첫 시작값(이름은 빈 채), 3개까지, 차이는 칸 이름만(버튼 이름 원문 없음)', () => {
  assert.deepEqual(home.addMarketHomePeriodTab({ rankingWindowDays: 30 }), [{ label: '', days: 30 }])
  assert.deepEqual(home.addMarketHomePeriodTab({ rankingWindowDays: 30, periodTabs: [{ label: '월간', days: 30 }] }).at(-1), { label: '', days: 7 })
  assert.deepEqual(home.addMarketHomePeriodTab({ rankingWindowDays: 14, periodTabs: [{ label: '2주', days: 14 }] }).at(-1), { label: '', days: 30 })
  assert.deepEqual(home.addMarketHomePeriodTab({ rankingWindowDays: 30, periodTabs: tabs }).at(-1), { label: '', days: 1 })
  const three = [...tabs, { label: '일간', days: 1 }]
  assert.equal(home.addMarketHomePeriodTab({ rankingWindowDays: 30, periodTabs: three }), three)
  // 새 섹션의 시작값은 22번 그대로(기간 버튼·처음 보이는 개수 없이)
  assert.deepEqual(Object.keys(home.createMarketHomeSection('popular', uuid(70))).sort(), ['emptyText', 'id', 'isActive', 'kind', 'limit', 'rankingWindowDays', 'title'])

  const changes = home.diffMarketHomeSections(
    [popular(), recent()],
    [popular({ periodTabs: tabs, collapsedLimit: 5 }), recent({ collapsedLimit: 5 })]
  )
  assert.deepEqual(changes.map((change) => change.fields), [['periodTabs', 'collapsedLimit'], ['collapsedLimit']])
  for (const raw of ['월간', '주간']) assert.equal(JSON.stringify(changes).includes(raw), false, raw)
  assert.deepEqual(home.diffMarketHomeSections([popular({ periodTabs: tabs })], [popular({ periodTabs: tabs })]), [])
})

test('17절 회원 홈 읽기: 기간 버튼마다 그 기간·같은 개수로 순위를 읽고 items 는 첫 버튼, 새 칸이 없으면 한 번만 읽는다', async (t) => {
  withEnv(t)
  const setting = config(
    [popular({ limit: 20, collapsedLimit: 5, periodTabs: [{ label: '주간', days: 7 }, { label: '월간', days: 30 }] }), recent({ limit: 20, collapsedLimit: 5 })],
    labels
  )
  const { server, admin } = loadServer({ setting, popularRows: [uuid(1), uuid(2)], recentRows: [uuid(7)] })
  const before = Date.now()
  const data = await server.getMarketHomeData('korean')
  const rpcs = admin.calls.filter((call) => call.type === 'rpc')
  assert.equal(rpcs.length, 2)
  assert.deepEqual(rpcs.map((call) => call.args.p_limit), [20, 20])
  // p_from = 지금에서 버튼의 일수만큼 거꾸로(오늘부터 7일·30일)
  const spans = rpcs.map((call) => Math.round((before - Date.parse(call.args.p_from)) / 86_400_000))
  assert.deepEqual(spans, [7, 30])
  const [popularSection, recentSection] = data.sections
  assert.deepEqual(popularSection.periods.map((period) => [period.label, period.days, period.items.length]), [['주간', 7, 2], ['월간', 30, 2]])
  assert.equal(popularSection.items, popularSection.periods[0].items)
  assert.equal(popularSection.collapsedLimit, 5)
  assert.equal(recentSection.collapsedLimit, 5)
  assert.deepEqual([data.expandLabel, data.collapseLabel], ['펼쳐보기', '접기'])

  const plain = loadServer({ setting: config([popular(), recent()]), popularRows: [uuid(1)], recentRows: [uuid(7)] })
  const plainData = await plain.server.getMarketHomeData('korean')
  assert.equal(plain.admin.calls.filter((call) => call.type === 'rpc').length, 1)
  assert.deepEqual([plainData.sections[0].periods, plainData.sections[0].collapsedLimit, plainData.sections[1].collapsedLimit], [null, null, null])
  assert.deepEqual([plainData.expandLabel, plainData.collapseLabel], [null, null])
})

test('17절 관리 화면 재료·저장: 저장된 기간 버튼의 일수별 순위를 상한(24)까지 미리 읽고, 버튼 글자는 적었을 때만 칸을 둔다', async (t) => {
  withEnv(t)
  const setting = config([popular({ periodTabs: [{ label: '주간', days: 7 }, { label: '월간', days: 30 }] }), recent()], labels)
  const { server, admin } = loadServer({ setting, popularRows: [uuid(1)], recentRows: [uuid(7)] })
  const data = await server.getMarketHomeAdminData('korean')
  assert.equal(data.pool.rankingWindowDays, 7)
  assert.deepEqual(Object.keys(data.pool.popularByDays).sort(), ['30', '7'])
  assert.deepEqual(admin.calls.filter((call) => call.type === 'rpc').map((call) => call.args.p_limit), [24, 24])
  assert.deepEqual([data.draft.expandLabel, data.draft.collapseLabel], ['펼쳐보기', '접기'])
  const preview = await server.getMarketHomePopularPreview('korean', 14)
  assert.equal(preview.length, 1)
  assert.equal(admin.calls.filter((call) => call.type === 'rpc').at(-1).args.p_limit, 24)

  const write = async (draft) => {
    const loaded = loadServer({ setting: seed.korean })
    await loaded.server.saveMarketHomeConfig({ workspaceSubject: 'korean', expectedRevision: 1, draft, actorId: uuid(900) })
    return op(loaded.admin.calls.find((call) => call.table === 'workspace_settings' && op(call.ops, 'update')).ops, 'update')[1].value
  }
  assert.deepEqual(Object.keys(await write({ sections: [popular()], emptyHomeLink: null })).sort(), ['emptyHomeLink', 'revision', 'sections', 'version'])
  assert.deepEqual(Object.keys(await write({ sections: [popular()], emptyHomeLink: null, expandLabel: null, collapseLabel: null })).sort(), ['emptyHomeLink', 'revision', 'sections', 'version'])
  const withLabels = await write({ sections: [recent({ collapsedLimit: 5 })], emptyHomeLink: null, ...labels })
  assert.deepEqual([withLabels.expandLabel, withLabels.collapseLabel], ['펼쳐보기', '접기'])
  // 저장한 값은 다시 읽어도 통과한다
  assert.equal(home.readMarketHomeConfig(withLabels).state, 'ok')
})
