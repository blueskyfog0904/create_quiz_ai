import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createFakeAdmin, load, loadRoute, marketImages, op } from './helpers/market-images-harness.mjs'

// S2: 관리자 상품의 카테고리는 필수이고, 상품 과목은 카테고리 칸의 과목으로 정한다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const itemsRoute = read('src/app/api/admin/market/items/route.ts')
const itemRoute = read('src/app/api/admin/market/items/[id]/route.ts')
const itemsServer = read('src/lib/market-items-server.ts')

const ITEM_ID = '11111111-1111-4111-8111-111111111111'
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333'
const BOARD_ID = '55555555-5555-4555-8555-555555555555'
const SUBJECT_MESSAGE = '상품과 같은 과목의 카테고리를 선택해주세요.'
const body = { title: '상품', pdfPrice: 0, hwpPrice: 0, zipPrice: 0 }

function fnBody(source, name) {
  return source.match(new RegExp(`export async function ${name}\\([\\s\\S]+?\\n}\\n`))[0]
}

test('POST는 categoryItemId 필수, PATCH는 선택이지만 null(해제)을 받지 않는다', () => {
  assert.match(itemsRoute, /categoryItemId: z\.string\(\)\.uuid\(\),/)
  assert.match(itemRoute, /categoryItemId: z\.string\(\)\.uuid\(\)\.optional\(\),/)
  for (const source of [itemsRoute, itemRoute]) {
    assert.doesNotMatch(source, /categoryItemId: z\.string\(\)\.uuid\(\)\.nullable\(\)/)
    assert.match(source, new RegExp(`message: '${SUBJECT_MESSAGE}'`))
    assert.doesNotMatch(source, /카테고리 항목을 선택해주세요/)
  }
})

test('상품 과목은 게시판이 아니라 카테고리 칸에서 정하고, 요청 과목이 있으면 같아야 한다', () => {
  assert.match(itemsRoute, /const workspaceSubject = await getMarketCategoryItemWorkspaceSubject\(parsed\.data\.categoryItemId\)/)
  assert.match(itemsRoute, /requestedSubject !== null && resolveAdminWorkspaceSubject\(requestedSubject\) !== workspaceSubject/)
  assert.match(itemsRoute, /createMarketItem\(\{\n\s+workspace_subject: workspaceSubject,/)
  const create = fnBody(itemsServer, 'createMarketItem')
  assert.match(create, /workspace_subject: input\.workspace_subject,/)
  assert.doesNotMatch(create, /workspace_subject: menuEntry\.workspace_subject/)
  assert.match(create, /category_item_id: input\.category_item_id,/)
})

test('GET은 ?categoryId=의 하위 칸까지 포함해 거르고 게시판(?menuEntryId=) 필터는 없다', () => {
  assert.match(itemsRoute, /listMarketCategorySubtreeIdsForAdmin\(workspaceSubject, categoryId\)/)
  assert.match(itemsRoute, /listMarketItemsForAdmin\(\{ workspaceSubject, categoryIds \}\)/)
  assert.doesNotMatch(itemsRoute, /searchParams\.get\('menuEntryId'\)/)
  const list = fnBody(itemsServer, 'listMarketItemsForAdmin')
  assert.match(list, /\.in\('category_item_id', categoryIds\)/)
  assert.doesNotMatch(list, /menu_entry_id|menuEntryId/)
})

function loadItemRoute({ categorySubject, updateCalls }) {
  return loadRoute('src/app/api/admin/market/items/[id]/route.ts', {
    mocks: {
      '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: (value) => value || 'korean' },
      '@/lib/market-categories-server': { getMarketCategoryItemWorkspaceSubject: async () => categorySubject },
      '@/lib/market-item-cleanup': {},
      '@/lib/market-items-server': {
        getMarketItemById: async () => ({ id: ITEM_ID, workspace_subject: 'korean', category_item_id: null, thumbnail_image_id: null }),
        updateMarketItem: async (_id, input) => {
          updateCalls.push(input)
          return { id: ITEM_ID }
        },
      },
    },
  }).route
}

const patch = (route, payload) => route.PATCH(
  new Request('http://localhost/api/admin/market/items/x?subject=korean', { method: 'PATCH', body: JSON.stringify(payload) }),
  { params: Promise.resolve({ id: ITEM_ID }) },
)

test('PATCH: 다른 과목 칸은 400과 안내 문구, 수정하지 않는다', async () => {
  const updateCalls = []
  const route = loadItemRoute({ categorySubject: 'english', updateCalls })
  const response = await patch(route, { ...body, categoryItemId: CATEGORY_ID })
  assert.equal(response.status, 400)
  assert.equal((await response.json()).error.message, SUBJECT_MESSAGE)
  assert.equal(updateCalls.length, 0)
})

test('PATCH: categoryItemId null(해제)은 400, 같은 과목 칸은 저장된다', async () => {
  const updateCalls = []
  const route = loadItemRoute({ categorySubject: 'korean', updateCalls })
  assert.equal((await patch(route, { ...body, categoryItemId: null })).status, 400)
  assert.equal(updateCalls.length, 0)

  assert.equal((await patch(route, { ...body, categoryItemId: CATEGORY_ID })).status, 200)
  assert.equal(updateCalls[0].category_item_id, CATEGORY_ID)
})

function loadItemsRoute({ categorySubject, createCalls, menuCalls = [] }) {
  return loadRoute('src/app/api/admin/market/items/route.ts', {
    mocks: {
      '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: (value) => value || 'korean' },
      '@/lib/market-categories-server': { getMarketCategoryItemWorkspaceSubject: async () => categorySubject },
      '@/lib/market-menu-server': {
        listMarketMenuEntriesForAdmin: async (subject) => {
          menuCalls.push(subject)
          return [{ id: BOARD_ID, deleted_at: null }]
        },
      },
      '@/lib/market-items-server': {
        createMarketItem: async (input) => {
          createCalls.push(input)
          return { id: ITEM_ID }
        },
      },
    },
  }).route
}

const post = (route, payload, query = '?subject=korean') => route.POST(
  new Request(`http://localhost/api/admin/market/items${query}`, { method: 'POST', body: JSON.stringify(payload) }),
)

test('POST: 카테고리 없음·없는 칸·다른 과목 칸은 400이고 상품을 만들지 않는다', async () => {
  const createCalls = []
  const korean = loadItemsRoute({ categorySubject: 'korean', createCalls })
  assert.equal((await post(korean, { ...body, menuEntryId: BOARD_ID })).status, 400)

  for (const categorySubject of [null, 'english']) {
    const route = loadItemsRoute({ categorySubject, createCalls })
    const response = await post(route, { ...body, menuEntryId: BOARD_ID, categoryItemId: CATEGORY_ID })
    assert.equal(response.status, 400, String(categorySubject))
    assert.equal((await response.json()).error.message, SUBJECT_MESSAGE)
  }
  assert.equal(createCalls.length, 0)
})

test('POST: 상품 과목과 게시판 확인은 카테고리 칸의 과목을 따른다', async () => {
  const createCalls = []
  const menuCalls = []
  const route = loadItemsRoute({ categorySubject: 'english', createCalls, menuCalls })
  const response = await post(route, { ...body, menuEntryId: BOARD_ID, categoryItemId: CATEGORY_ID }, '?subject=english')
  assert.equal(response.status, 201)
  assert.equal(createCalls[0].workspace_subject, 'english')
  assert.equal(createCalls[0].category_item_id, CATEGORY_ID)
  assert.deepEqual(menuCalls, ['english'])
})

test('GET ?categoryId=: 칸의 하위 칸 id(비활성 포함)로 상품을 거른다', async () => {
  const ROOT = '66666666-6666-4666-8666-666666666666'
  const DEPTH2 = '77777777-7777-4777-8777-777777777777'
  const DEPTH3 = '88888888-8888-4888-8888-888888888888'
  const OTHER = '99999999-9999-4999-8999-999999999999'
  const node = (id, parentId, depth, isActive = true) => ({
    id, parent_id: parentId, depth, title: id.slice(0, 2), sort_order: 0, is_active: isActive, created_at: '2026-10-12', default_image: null,
  })
  const admin = createFakeAdmin(({ table }) => {
    if (table === 'market_category_items') {
      return { data: [node(ROOT, null, 1), node(DEPTH2, ROOT, 2), node(DEPTH3, DEPTH2, 3, false), node(OTHER, ROOT, 2)], error: null }
    }
    return { data: [], error: null }
  })
  const categories = load('src/lib/market-categories-server.ts', {
    'server-only': {},
    '@/lib/market-sample-pages-server': {},
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/workspace-subject': { isWorkspaceSubject: () => true },
    '@/lib/list-pagination': {},
    '@/lib/read-all-query-rows': load('src/lib/read-all-query-rows.ts'),
    '@/lib/market-images': marketImages,
    '@/lib/market-category-tree': load('src/lib/market-category-tree.ts'),
  })
  assert.deepEqual(await categories.listMarketCategorySubtreeIdsForAdmin('korean', DEPTH2), [DEPTH2, DEPTH3])
  assert.deepEqual(await categories.listMarketCategorySubtreeIdsForAdmin('korean', ITEM_ID), [])

  const itemsAdmin = createFakeAdmin(() => ({ data: [], error: null }))
  const items = load('src/lib/market-items-server.ts', {
    '@/lib/supabase/bypass': { createAdminClient: () => itemsAdmin.client },
    '@/lib/market-sample-pages-server': {},
    '@/lib/market-refunds': {},
    '@/lib/workspace-subject': { DEFAULT_WORKSPACE_SUBJECT: 'english' },
    '@/lib/market-images': marketImages,
  })
  await items.listMarketItemsForAdmin({ workspaceSubject: 'korean', categoryIds: [DEPTH2, DEPTH3] })
  assert.deepEqual(op(itemsAdmin.calls[0].ops, 'in'), ['in', 'category_item_id', [DEPTH2, DEPTH3]])
  assert.deepEqual(op(itemsAdmin.calls[0].ops, 'eq'), ['eq', 'workspace_subject', 'korean'])
  // 없는 칸(하위 id 0개)이면 조회 없이 빈 목록
  assert.deepEqual(await items.listMarketItemsForAdmin({ workspaceSubject: 'korean', categoryIds: [] }), [])
  assert.equal(itemsAdmin.calls.length, 1)

  const listCalls = []
  const { route } = loadRoute('src/app/api/admin/market/items/route.ts', {
    mocks: {
      '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: (value) => value || 'korean' },
      '@/lib/market-categories-server': { listMarketCategorySubtreeIdsForAdmin: async (subject, id) => (subject === 'korean' && id === DEPTH2 ? [DEPTH2, DEPTH3] : []) },
      '@/lib/market-menu-server': {},
      '@/lib/market-items-server': { listMarketItemsForAdmin: async (options) => { listCalls.push(options); return [] } },
    },
  })
  assert.equal((await route.GET(new Request(`http://localhost/api/admin/market/items?subject=korean&categoryId=${DEPTH2}`))).status, 200)
  assert.equal((await route.GET(new Request('http://localhost/api/admin/market/items?subject=korean'))).status, 200)
  assert.deepEqual(listCalls, [{ workspaceSubject: 'korean', categoryIds: [DEPTH2, DEPTH3] }, { workspaceSubject: 'korean', categoryIds: undefined }])
})
