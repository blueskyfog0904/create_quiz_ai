import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeAdmin, load, loadRoute, marketImages, op } from './helpers/market-images-harness.mjs'

// docs/market-category-tree-plan.md 4.5·8.5: 칸(노드) 서버 함수와 관리자 노드 API 실행 테스트
const tree = load('src/lib/market-category-tree.ts')
const ROOT = '00000000-0000-4000-8000-000000000001'
const DEPTH2 = '00000000-0000-4000-8000-000000000002'
const DEPTH3 = '00000000-0000-4000-8000-000000000003'
const DEPTH4 = '00000000-0000-4000-8000-000000000004'
const LEAF = '00000000-0000-4000-8000-000000000005'
const NODES = [
  { id: ROOT, parent_id: null },
  { id: DEPTH2, parent_id: ROOT },
  { id: DEPTH3, parent_id: DEPTH2 },
  { id: DEPTH4, parent_id: DEPTH3 },
  { id: LEAF, parent_id: ROOT },
]

function loadServer(handler) {
  const admin = createFakeAdmin(handler)
  const server = load('src/lib/market-categories-server.ts', {
    'server-only': {},
    '@/lib/market-sample-pages-server': {},
    '@/lib/supabase/bypass': { createAdminClient: () => admin.client },
    '@/lib/workspace-subject': { isWorkspaceSubject: (value) => ['english', 'korean'].includes(value) },
    '@/lib/list-pagination': {},
    '@/lib/read-all-query-rows': load('src/lib/read-all-query-rows.ts'),
    '@/lib/market-images': marketImages,
    '@/lib/market-category-tree': tree,
  })
  return { server, admin }
}

// 삭제 흐름의 가짜 DB: 노드 목록, 하위 칸 상품 행, delete 결과
function deleteHandler({ products = [], deleteResult = { data: { id: LEAF }, error: null } } = {}) {
  return ({ table, ops }) => {
    if (op(ops, 'delete')) return deleteResult
    if (table === 'market_category_items') return { data: NODES, error: null }
    if (table === 'market_items') {
      const ids = op(ops, 'in')[2]
      return { data: products.filter((product) => ids.includes(product.category_item_id)), error: null }
    }
    throw new Error(`unexpected table ${table}`)
  }
}

const deleteCalls = (admin) => admin.calls.filter((call) => call.ops && op(call.ops, 'delete'))

test('deleteCategoryNode refuses a node whose subtree has products and never deletes', async () => {
  const { server, admin } = loadServer(deleteHandler({ products: [{ id: 'p1', category_item_id: DEPTH4, deleted_at: null }] }))
  await assert.rejects(() => server.deleteCategoryNode(DEPTH2), (error) => (
    error.status === 409 && error.message === '연결된 상품이 있어 삭제할 수 없습니다. 비활성화하거나 상품을 옮긴 뒤 삭제해주세요.'
  ))
  assert.equal(deleteCalls(admin).length, 0)
  const productQuery = admin.calls.find((call) => call.table === 'market_items')
  assert.deepEqual(op(productQuery.ops, 'in'), ['in', 'category_item_id', [DEPTH2, DEPTH3, DEPTH4]])
})

test('deleteCategoryNode counts soft-deleted products in the 409 message', async () => {
  const { server, admin } = loadServer(deleteHandler({ products: [{ id: 'p1', category_item_id: LEAF, deleted_at: '2026-01-01' }] }))
  await assert.rejects(() => server.deleteCategoryNode(LEAF), (error) => (
    error.status === 409 && /\(삭제된 상품 1개 포함\)$/.test(error.message)
  ))
  assert.equal(deleteCalls(admin).length, 0)
})

test('deleteCategoryNode refuses a node with child nodes', async () => {
  const { server, admin } = loadServer(deleteHandler())
  await assert.rejects(() => server.deleteCategoryNode(DEPTH3), (error) => error.status === 409 && error.message === '하위 칸을 먼저 삭제해주세요.')
  assert.equal(deleteCalls(admin).length, 0)
})

test('deleteCategoryNode deletes an empty leaf', async () => {
  const { server, admin } = loadServer(deleteHandler())
  await server.deleteCategoryNode(LEAF)
  const [call] = deleteCalls(admin)
  assert.deepEqual(op(call.ops, 'eq'), ['eq', 'id', LEAF])
})

test('deleteCategoryNode maps a racing 23503 by constraint name', async () => {
  const fk = (name) => ({ data: null, error: { code: '23503', message: `update or delete on table "market_category_items" violates foreign key constraint "${name}"` } })
  for (const [name, message] of [
    ['market_items_category_item_subject_fkey', '연결된 상품이 있어 삭제할 수 없습니다. 비활성화하거나 상품을 옮긴 뒤 삭제해주세요.'],
    ['market_category_items_parent_subject_fkey', '하위 칸을 먼저 삭제해주세요.'],
    ['something_else_fkey', '다른 데이터가 이 칸을 참조하고 있어 삭제할 수 없습니다.'],
  ]) {
    const { server } = loadServer(deleteHandler({ deleteResult: fk(name) }))
    await assert.rejects(() => server.deleteCategoryNode(LEAF), (error) => error.status === 409 && error.message === message)
  }
})

function createHandler(parent) {
  return ({ table, ops }) => {
    if (table !== 'market_category_items') throw new Error(`unexpected table ${table}`)
    if (op(ops, 'insert')) return { data: { id: 'new', ...op(ops, 'insert')[1] }, error: null }
    return { data: parent, error: null }
  }
}

const insertCalls = (admin) => admin.calls.filter((call) => op(call.ops, 'insert'))

test('createCategoryNode refuses a child under depth5 or another subject', async () => {
  for (const [parent, status] of [
    [{ id: DEPTH4, workspace_subject: 'korean', depth: 5 }, 400],
    [{ id: DEPTH4, workspace_subject: 'english', depth: 2 }, 400],
    [null, 404],
  ]) {
    const { server, admin } = loadServer(createHandler(parent))
    await assert.rejects(() => server.createCategoryNode({ workspaceSubject: 'korean', parentId: DEPTH4, title: '새 칸' }), (error) => error.status === status)
    assert.equal(insertCalls(admin).length, 0)
  }
})

test('createCategoryNode inserts depth = parent depth + 1, or depth1 without a parent', async () => {
  const child = loadServer(createHandler({ id: DEPTH3, workspace_subject: 'korean', depth: 3 }))
  await child.server.createCategoryNode({ workspaceSubject: 'korean', parentId: DEPTH3, title: ' 4단 ' })
  assert.deepEqual(op(insertCalls(child.admin)[0].ops, 'insert')[1], { workspace_subject: 'korean', parent_id: DEPTH3, depth: 4, title: '4단', sort_order: 0 })

  const root = loadServer(createHandler(null))
  await root.server.createCategoryNode({ workspaceSubject: 'english', parentId: null, title: 'Root', sortOrder: 10 })
  assert.equal(root.admin.calls.length, 1)
  assert.deepEqual(op(insertCalls(root.admin)[0].ops, 'insert')[1], { workspace_subject: 'english', parent_id: null, depth: 1, title: 'Root', sort_order: 10 })
})

// 라우트: 서버 함수를 가짜로 바꿔 권한·입력 검증·캐시 무효화만 본다.
class FakeCategoryError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function loadNodeRoutes(options = {}, serverOverrides = {}) {
  const calls = []
  const server = {
    MarketCategoryError: FakeCategoryError,
    listMarketCategoryTreeForAdmin: async () => [],
    createCategoryNode: async (input) => { calls.push(['create', input]); return { id: 'new' } },
    updateCategoryNode: async (id, input) => { calls.push(['update', id, input]); return { id } },
    deleteCategoryNode: async (id) => { calls.push(['delete', id]) },
    ...serverOverrides,
  }
  const mocks = { '@/lib/admin-workspace': { resolveAdminWorkspaceSubject: () => 'korean' }, '@/lib/market-categories-server': server }
  const list = loadRoute('src/app/api/admin/market-categories/route.ts', { ...options, mocks })
  const node = loadRoute('src/app/api/admin/market-categories/[nodeId]/route.ts', { ...options, mocks })
  return { list, node, calls }
}

const json = (method, body) => new Request('http://localhost/api/admin/market-categories', { method, body: JSON.stringify(body) })
const params = { params: Promise.resolve({ nodeId: LEAF }) }
const TREE_TAGS = [['market-category-tree', { expire: 0 }], ['market-public-lists', { expire: 0 }]]

test('node routes require a logged-in admin for every method', async () => {
  for (const [options, status] of [[{ loggedIn: false }, 401], [{ isAdmin: false }, 403]]) {
    const { list, node, calls } = loadNodeRoutes(options)
    assert.equal((await list.route.GET(new Request('http://localhost/x'))).status, status)
    assert.equal((await list.route.POST(json('POST', { workspace_subject: 'korean', parent_id: null, title: '칸' }))).status, status)
    assert.equal((await node.route.PATCH(json('PATCH', { title: '칸' }), params)).status, status)
    assert.equal((await node.route.DELETE(json('DELETE', {}), params)).status, status)
    assert.equal(calls.length, 0)
  }
})

test('node writes revalidate the tree and list caches; a 409 revalidates nothing', async () => {
  const { list, node } = loadNodeRoutes()
  assert.equal((await list.route.POST(json('POST', { workspace_subject: 'korean', parent_id: ROOT, title: '칸' }))).status, 201)
  assert.deepEqual(list.revalidations, TREE_TAGS)
  assert.equal((await node.route.PATCH(json('PATCH', { is_active: false }), params)).status, 200)
  assert.equal((await node.route.DELETE(json('DELETE', {}), params)).status, 200)
  assert.deepEqual(node.revalidations, [...TREE_TAGS, ...TREE_TAGS])

  const blocked = loadNodeRoutes({}, { deleteCategoryNode: async () => { throw new FakeCategoryError(409, '하위 칸을 먼저 삭제해주세요.') } })
  const response = await blocked.node.route.DELETE(json('DELETE', {}), params)
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error, '하위 칸을 먼저 삭제해주세요.')
  assert.equal(blocked.node.revalidations.length, 0)
})

test('node titles must be 1~120 characters after trimming', async () => {
  const { list, node, calls } = loadNodeRoutes()
  for (const title of ['', '   ', 'x'.repeat(121)]) {
    assert.equal((await list.route.POST(json('POST', { workspace_subject: 'korean', parent_id: null, title }))).status, 400)
    assert.equal((await node.route.PATCH(json('PATCH', { title }), params)).status, 400)
  }
  assert.equal(calls.length, 0)
  assert.equal((await list.route.POST(json('POST', { workspace_subject: 'korean', parent_id: null, title: 'x'.repeat(120) }))).status, 201)
  assert.equal((await node.route.PATCH(json('PATCH', { title: 'x'.repeat(120) }), params)).status, 200)
})

test('toMegaMenuTree keeps depth1~2 and the depth2 subtree count without changing the tree', () => {
  const source = {
    korean: [{ id: ROOT, title: 'EBS', depth: 1, itemCount: 7, children: [
      { id: DEPTH2, title: '독서', depth: 2, itemCount: 7, children: [
        { id: DEPTH3, title: '2부', depth: 3, itemCount: 7, children: [{ id: DEPTH4, title: '인문', depth: 4, itemCount: 7, children: [] }] },
      ] },
    ] }],
    english: [],
  }
  const snapshot = structuredClone(source)
  const menu = tree.toMegaMenuTree(source, 2)
  assert.deepEqual(menu.korean[0].children[0], { id: DEPTH2, title: '독서', depth: 2, itemCount: 7, children: [] })
  assert.deepEqual(source, snapshot)
  assert.deepEqual(tree.findCategoryPath(source.korean, DEPTH4).map((node) => node.id), [ROOT, DEPTH2, DEPTH3, DEPTH4])
  assert.equal(tree.findCategoryPath(source.korean, LEAF), null)
  assert.deepEqual(tree.collectSubtreeIds(source.korean[0].children[0]), [DEPTH2, DEPTH3, DEPTH4])
})

test('buildCategoryTree drops nodes under a missing (inactive) parent and sums counts', () => {
  const rows = [
    { id: ROOT, parent_id: null, depth: 1, title: 'B', sort_order: 20, created_at: '2026-01-01', workspace_subject: 'korean' },
    { id: LEAF, parent_id: null, depth: 1, title: 'A', sort_order: 10, created_at: '2026-01-01', workspace_subject: 'korean' },
    { id: DEPTH2, parent_id: ROOT, depth: 2, title: '독서', sort_order: 0, created_at: '2026-01-01', workspace_subject: 'korean' },
    { id: DEPTH4, parent_id: DEPTH3, depth: 4, title: '부모 없음', sort_order: 0, created_at: '2026-01-01', workspace_subject: 'korean' },
  ]
  const built = tree.buildCategoryTree(rows)
  assert.deepEqual(built.korean.map((node) => node.title), ['A', 'B'])
  assert.equal(tree.findCategoryPath(built.korean, DEPTH4), null)
  tree.applyCategoryItemCounts(built.korean, new Map([[DEPTH2, 3], [ROOT, 1]]))
  assert.equal(built.korean[1].itemCount, 4)
  assert.equal(built.korean[0].itemCount, 0)
})
