import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeAdmin, load, marketImages, op } from './helpers/market-images-harness.mjs'

// R12(S3): 게시판을 전부 is_visible=false로 둔 픽스처에서도 published 상품이 공개 화면에 그대로 나온다.
// 장바구니는 tests/market-cart-detail-href.test.mjs, 카테고리 목록·트리 개수는 tests/category-pagination-server.test.mjs,
// 샘플 API는 tests/public-market-sample.test.mjs가 같은 픽스처(숨김 게시판)로 확인한다.

const HIDDEN_BOARD = '00000000-0000-4000-8000-0000000000b1'
const ROOT = '00000000-0000-4000-8000-000000000010'
const DEPTH2 = '00000000-0000-4000-8000-000000000020'
const DEPTH3 = '00000000-0000-4000-8000-000000000030'
const INACTIVE = '00000000-0000-4000-8000-000000000040'

const hiddenBoards = [{ id: HIDDEN_BOARD, slug: 'entexam', title: '숨김 게시판', workspace_subject: 'korean', is_visible: false, is_active: true, deleted_at: null }]
// 게시판 조회가 있으면 eq·is 조건을 실제처럼 적용해 돌려준다(is_visible=true 조건이면 0건 → 예전 게이트라면 상품이 빠진다).
const boardRows = (ops) => hiddenBoards.filter((row) => ops
  .filter(([name]) => name === 'eq' || name === 'is')
  .every(([, column, value]) => row[column] === value))

// 활성 칸만(쿼리의 is_active 조건을 흉내 낸다). INACTIVE 칸은 비활성이라 결과에 없다.
const activeNodes = [
  { id: ROOT, workspace_subject: 'korean', parent_id: null, depth: 1, title: 'EBS', sort_order: 10, created_at: '2026-01-01' },
  { id: DEPTH2, workspace_subject: 'korean', parent_id: ROOT, depth: 2, title: '수능특강 독서', sort_order: 10, created_at: '2026-01-01' },
  { id: DEPTH3, workspace_subject: 'korean', parent_id: DEPTH2, depth: 3, title: '2부 적용학습', sort_order: 10, created_at: '2026-01-01' },
]

const item = (id, categoryItemId, viewCount) => ({
  id, title: `자료 ${id}`, summary: null, menu_entry_id: HIDDEN_BOARD, category_item_id: categoryItemId,
  exam_year: null, grade_level: null, question_count: null, view_count: viewCount, published_at: '2026-01-01', created_at: '2026-01-01',
})
// depth3 / depth1 직접 / 미지정 / 비활성 칸 연결
const searchItems = [item('k1', DEPTH3, 4), item('k2', ROOT, 3), item('k3', null, 2), item('k4', INACTIVE, 1)]

function loadSearch() {
  const admin = createFakeAdmin(({ table, ops }) => {
    if (table === 'market_items') return { data: searchItems, error: null }
    if (table === 'market_category_items') return { data: activeNodes, error: null }
    if (table === 'market_menu_entries') return { data: boardRows(ops), error: null }
    return { data: [], error: null }
  })
  const server = load('src/lib/market-search-server.ts', {
    'server-only': {},
    '@/lib/market-sample-pages-server': { listActiveMarketItemSamplePagesForItems: async () => new Map() },
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/workspace-subject': { DEFAULT_WORKSPACE_SUBJECT: 'korean' },
    '@/lib/list-pagination': load('src/lib/list-pagination.ts'),
    '@/lib/read-all-query-rows': load('src/lib/read-all-query-rows.ts'),
    '@/lib/market-images': marketImages,
    '@/lib/market-category-tree': load('src/lib/market-category-tree.ts'),
  })
  return { admin, search: (filters = {}) => server.searchMarketItemsForSubject('korean', filters) }
}

test('검색: 숨김 게시판 상품도 결과·패싯에 나오고 게시판을 조회하지 않는다', async () => {
  const { admin, search } = loadSearch()
  const result = await search()
  assert.deepEqual(result.rows.map((row) => row.itemId), ['k1', 'k2', 'k3', 'k4'])
  assert.equal(admin.calls.some((call) => call.table === 'market_menu_entries'), false)

  const itemsQuery = admin.calls.find((call) => call.table === 'market_items')
  assert.ok(itemsQuery.ops.some(([name, column, value]) => name === 'eq' && column === 'status' && value === 'published'))
  assert.equal(itemsQuery.ops.some(([name, column]) => name === 'in' && column === 'menu_entry_id'), false)
  const nodesQuery = admin.calls.find((call) => call.table === 'market_category_items')
  assert.equal(admin.calls.filter((call) => call.table === 'market_category_items').length, 1)
  assert.ok(nodesQuery.ops.some(([name, column, value]) => name === 'eq' && column === 'is_active' && value === true))

  // 패싯은 depth2 조상(없으면 depth1) 단위. 미지정·비활성 칸 상품은 패싯 값이 없다.
  assert.deepEqual(
    result.facets.categories.map((option) => [option.value, option.label, option.count]),
    [[ROOT, 'EBS', 1], [DEPTH2, 'EBS > 수능특강 독서', 1]],
  )
})

test('검색: 행은 카테고리 id와 경로를 싣고, 비활성·미지정 칸은 빈 경로다', async () => {
  const { search } = loadSearch()
  const rows = new Map((await search()).rows.map((row) => [row.itemId, row]))
  assert.equal(rows.get('k1').categoryId, DEPTH3)
  assert.deepEqual(rows.get('k1').categoryPath.map((node) => node.title), ['EBS', '수능특강 독서', '2부 적용학습'])
  assert.deepEqual(rows.get('k2').categoryPath, [{ id: ROOT, title: 'EBS' }])
  assert.equal(rows.get('k3').categoryId, null)
  assert.deepEqual(rows.get('k3').categoryPath, [])
  assert.equal(rows.get('k4').categoryId, INACTIVE)
  assert.deepEqual(rows.get('k4').categoryPath, [])
  assert.equal('categorySlug' in rows.get('k1'), false)
})

test('검색: ?category=는 칸 id이고 하위 칸 상품까지 포함, 예전 slug 값은 무시한다', async () => {
  const { search } = loadSearch()
  const ids = async (filters) => (await search(filters)).rows.map((row) => row.itemId)
  assert.deepEqual(await ids({ categoryIds: [ROOT] }), ['k1', 'k2'])
  assert.deepEqual(await ids({ categoryIds: [DEPTH2] }), ['k1'])
  assert.deepEqual(await ids({ categoryIds: ['entexam'] }), ['k1', 'k2', 'k3', 'k4'])
  assert.deepEqual(await ids({ categoryIds: ['entexam', DEPTH2] }), ['k1'])
  assert.deepEqual(await ids({ categoryIds: [INACTIVE] }), ['k1', 'k2', 'k3', 'k4'])
})

test('검색: 키워드는 게시판 제목이 아니라 카테고리 경로 제목과 맞춘다', async () => {
  const { search } = loadSearch()
  const ids = async (q) => (await search({ q })).rows.map((row) => row.itemId)
  assert.deepEqual(await ids('적용학습'), ['k1'])
  assert.deepEqual(await ids('EBS'), ['k1', 'k2'])
  assert.deepEqual(await ids('숨김 게시판'), [])
})

function loadHome() {
  const homeItems = [
    { ...item('h1', DEPTH3, 0), source_type: null, source_1: null, source_2: null, source_3: null, source_4: null, pdf_price: 0, hwp_price: 0, zip_price: 0 },
    { ...item('h2', null, 0), source_type: null, source_1: null, source_2: null, source_3: null, source_4: null, pdf_price: 0, hwp_price: 0, zip_price: 0 },
  ]
  const admin = createFakeAdmin(({ table, ops }) => {
    if (table === 'workspace_settings') return { data: null, error: null }
    if (table === 'market_menu_entries') return { data: boardRows(ops), error: null }
    if (table === 'market_items') {
      if (op(ops, 'select')?.[2]?.head) return { data: null, count: homeItems.length, error: null }
      const ids = ops.find(([name, column]) => name === 'in' && column === 'id')?.[2]
      return { data: ids ? homeItems.filter((row) => ids.includes(row.id)) : homeItems, error: null }
    }
    return { data: [], error: null }
  }, {
    rpc: (name) => (name === 'get_market_home_popular_items'
      ? { data: [{ item_id: 'h1', download_issuer_user_count: 3 }], error: null }
      : { data: null, error: { message: `unexpected rpc ${name}` } }),
  })
  const server = load('src/lib/market-home-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/market-item-list-enrichment': {
      loadMarketItemListEnrichment: async () => ({ sampleCounts: new Map(), startingPrices: new Map(), ratingSummaries: new Map() }),
    },
    '@/lib/market-home': load('src/lib/market-home.ts'),
    '@/lib/market-images': marketImages,
  })
  return { admin, server }
}

test('홈: 숨김 게시판 상품도 최근·인기·공개 개수에 들어가고 게시판을 조회하지 않는다', async (t) => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY }
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  t.after(() => {
    for (const [name, value] of [['NEXT_PUBLIC_SUPABASE_URL', saved.url], ['SUPABASE_SERVICE_ROLE_KEY', saved.key]]) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  const { admin, server } = loadHome()
  const data = await server.getMarketHomeData('korean')
  assert.deepEqual(data.recent.map((entry) => entry.id), ['h1', 'h2'])
  assert.deepEqual(data.popular.map((entry) => [entry.id, entry.downloadUserCount]), [['h1', 3]])
  assert.equal(data.publicItemCount, 2)
  assert.equal(admin.calls.some((call) => call.table === 'market_menu_entries'), false)
  for (const call of admin.calls.filter((entry) => entry.table === 'market_items')) {
    assert.equal(call.ops.some(([name, column]) => name === 'in' && column === 'menu_entry_id'), false)
  }
})
