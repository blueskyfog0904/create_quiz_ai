import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as pagination from '../src/lib/list-pagination.ts'
import { readAllQueryRows } from '../src/lib/read-all-query-rows.ts'
import * as marketImages from '../src/lib/market-images.ts'

const rootId = '00000000-0000-4000-8000-000000000010'
const categoryId = '00000000-0000-4000-8000-000000000001'
const categoryDepth3 = '00000000-0000-4000-8000-000000000002'
const inactiveId = '00000000-0000-4000-8000-000000000003'
const underInactiveId = '00000000-0000-4000-8000-000000000004'
const treeModule = (() => {
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/market-category-tree.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  new Function('exports', code)(loaded.exports)
  return loaded.exports
})()
function harness() {
  // 64개 중 앞 24개는 depth3(2부)에, 나머지 40개는 depth2(독서)에 직접 연결한다.
  const items = Array.from({ length: 64 }, (_, id) => ({
    id: String(id).padStart(3, '0'), title: `자료 ${id}`, summary: null,
    category_item_id: id < 24 ? categoryDepth3 : categoryId, workspace_subject: 'korean', menu_entry_id: 'visible',
    is_active: true, status: 'published', deleted_at: null,
    view_count: 1, created_at: '2026-01-01', published_at: '2026-01-01',
  }))
  const tables = {
    // depth1 EBS → depth2 독서(categoryId) → depth3 2부(categoryDepth3). 비활성 depth2 아래 depth3은 공개 트리에서 빠진다.
    market_category_items: [
      { id: rootId, parent_id: null, depth: 1, workspace_subject: 'korean', title: 'EBS', is_active: true, sort_order: 10, created_at: '2026-01-01' },
      { id: categoryId, parent_id: rootId, depth: 2, workspace_subject: 'korean', title: '독서', is_active: true, sort_order: 20, created_at: '2026-01-01' },
      { id: categoryDepth3, parent_id: categoryId, depth: 3, workspace_subject: 'korean', title: '2부', is_active: true, sort_order: 10, created_at: '2026-01-01' },
      { id: inactiveId, parent_id: rootId, depth: 2, workspace_subject: 'korean', title: '숨김 칸', is_active: false, sort_order: 30, created_at: '2026-01-01' },
      { id: underInactiveId, parent_id: inactiveId, depth: 3, workspace_subject: 'korean', title: '숨김 칸 아래', is_active: true, sort_order: 10, created_at: '2026-01-01' },
    ],
    market_menu_entries: [
      { id: 'visible', workspace_subject: 'korean', slug: 'reading', title: '독서', is_visible: true, is_active: true, deleted_at: null },
      { id: 'hidden', workspace_subject: 'korean', slug: 'hidden', title: '숨김', is_visible: false, is_active: true, deleted_at: null },
    ],
    market_items: [...items, ...[
      { status: 'draft' }, { is_active: false }, { deleted_at: '2026-01-01' },
      { workspace_subject: 'english' }, { menu_entry_id: 'hidden' },
      { category_item_id: 'another-category' }, { category_item_id: underInactiveId },
    ].map((patch, id) => ({ ...items[0], id: `excluded-${id}`, ...patch }))],
    market_item_subproducts: [{ id: 'price', item_id: '000', category_id: 'pdf', price_credits: 2500, workspace_subject: 'korean', is_active: true, deleted_at: null }],
    market_subproduct_categories: [{ id: 'pdf', slug: 'pdf', name: 'PDF', workspace_subject: 'korean' }],
    market_item_reviews: Array.from({ length: 503 }, (_, id) => ({ id: String(id).padStart(4, '0'), item_id: '000', rating: 5, workspace_subject: 'korean', deleted_at: null })),
  }
  const queries = []
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; this.from = 0; this.to = Infinity; queries.push(this) }
    select(columns, options = {}) { this.head = options.head; return this }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this }
    is(key, value) { return this.eq(key, value) }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this }
    order(key, options = {}) { this.orders.push([key, options.ascending !== false]); return this }
    range(from, to) { this.from = from; this.to = to; return this }
    maybeSingle() { this.single = true; return this }
    then(resolve, reject) {
      let rows = tables[this.table].filter((row) => this.filters.every((filter) => filter(row)))
      const count = rows.length
      rows.sort((a, b) => {
        for (const [key, ascending] of this.orders) {
          const comparison = String(a[key] ?? '').localeCompare(String(b[key] ?? ''))
          if (comparison) return ascending ? comparison : -comparison
        }
        return 0
      })
      rows = rows.slice(this.from, this.to + 1)
      return Promise.resolve({ data: this.head ? null : this.single ? rows[0] ?? null : rows, count, error: null }).then(resolve, reject)
    }
  }
  const sampleRequests = []
  const mocks = {
    'server-only': {},
    '@/lib/supabase/bypass': { createAdminClient: () => ({ from: (table) => new Query(table) }) },
    '@/lib/market-sample-pages-server': { listActiveMarketItemSamplePagesForItems: async (ids) => { sampleRequests.push(ids); return new Map() } },
    '@/lib/workspace-subject': { isWorkspaceSubject: (value) => ['english', 'korean'].includes(value) },
    '@/lib/list-pagination': pagination,
    '@/lib/read-all-query-rows': { readAllQueryRows },
    '@/lib/market-images': marketImages,
    '@/lib/market-category-tree': treeModule,
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/market-categories-server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'exports', code)((name) => {
    if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`)
    return mocks[name]
  }, loaded.exports)
  return { ...loaded.exports, sampleRequests, queries }
}

const countByTable = (queries) => queries.reduce((counts, query) => ({ ...counts, [query.table]: (counts[query.table] ?? 0) + 1 }), {})

test('only public items in visible menus count; pages contain no duplicate IDs', async () => {
  const app = harness()
  const results = await Promise.all([1, 2, 3, 4].map((page) => app.listMarketItemsForCategory(categoryId, { page })))
  assert.deepEqual(results.map((result) => result.rows.length), [20, 20, 20, 4])
  assert.ok(results.every((result) => result.totalCount === 64))
  assert.equal(new Set(results.flatMap((result) => result.rows.map((row) => row.itemId))).size, 64)
  assert.deepEqual(app.sampleRequests.map((ids) => ids.length).sort((a, b) => a - b), [4, 20, 20, 20])
  assert.equal(results[0].rows[0].ratingCount, 503)
  assert.equal(results[0].rows[0].ratingAverage, 5)
})

test('every depth page lists the products of its whole subtree', async () => {
  const app = harness()
  const [root, depth2, depth3] = await Promise.all([rootId, categoryId, categoryDepth3]
    .map((id) => app.listMarketItemsForCategory(id, { pageSize: 100 })))
  assert.equal(root.totalCount, 64)
  assert.equal(depth2.totalCount, 64)
  assert.equal(depth3.totalCount, 24)
  assert.ok(depth3.rows.every((row) => Number(row.itemId) < 24))
})

test('nodes under an inactive ancestor are hidden from the public tree', async () => {
  const app = harness()
  assert.equal(await app.getMarketCategoryNodeDetail(underInactiveId), null)
  assert.equal(await app.getMarketCategoryNodeDetail(inactiveId), null)
  assert.equal(await app.getMarketCategoryNodeDetail('not-a-uuid'), null)
  const tree = await app.listMarketCategoryTree()
  assert.deepEqual(tree.korean.map((node) => node.id), [rootId])
  assert.deepEqual(tree.korean[0].children.map((node) => node.id), [categoryId])
  assert.equal((await app.listMarketItemsForCategory(underInactiveId)).totalCount, 0)
})

test('node detail gives ancestors, children, siblings and subtree ids from the given tree', async () => {
  const app = harness()
  const tree = await app.listMarketCategoryTree(true)
  const before = app.queries.length
  const detail = await app.getMarketCategoryNodeDetail(categoryDepth3, tree)
  assert.equal(app.queries.length, before, 'no query when the tree is given')
  assert.equal(detail.depth, 3)
  assert.equal(detail.workspaceSubject, 'korean')
  assert.deepEqual(detail.ancestors, [{ id: rootId, title: 'EBS' }, { id: categoryId, title: '독서' }])
  assert.deepEqual(detail.children, [])
  assert.deepEqual(detail.siblings, [{ id: categoryDepth3, title: '2부', itemCount: 24 }])
  assert.deepEqual((await app.getMarketCategoryNodeDetail(categoryId, tree)).subtreeIds, [categoryId, categoryDepth3])
})

test('tree counts are summed over subtrees with a query count independent of node count', async () => {
  const app = harness()
  const tree = await app.listMarketCategoryTree(true)
  assert.equal(tree.korean[0].itemCount, 64)
  assert.equal(tree.korean[0].children[0].itemCount, 64)
  assert.equal(tree.korean[0].children[0].children[0].itemCount, 24)
  assert.equal(tree.english.length, 0)
  // 노드 1 + 게시판 1 + 상품 readAll 1(500행 미만)
  assert.deepEqual(countByTable(app.queries), { market_category_items: 1, market_menu_entries: 1, market_items: 1 })
})

// T2-M(docs/market-category-tree-plan.md 8.5): 401075d 코드의 카테고리 페이지 요청(캐시 적중)은
// 상세 2(항목·그룹) + 목록 7 = 9회였다. 노드 트리를 넘기면 상세 조회가 0회가 되어야 한다.
test('a category page request with the cached node tree makes no more queries than before', async () => {
  const app = harness()
  const nodes = await app.listMarketCategoryTree()
  app.queries.length = 0
  const detail = await app.getMarketCategoryNodeDetail(categoryId, nodes)
  await app.listMarketItemsForCategory(categoryId, { page: 1 }, detail)
  assert.ok(app.queries.length <= 9, `queries ${app.queries.length}`)
  assert.equal(countByTable(app.queries).market_category_items, undefined)
})

test('out of range pages clamp before the item range query', async () => {
  const app = harness()
  const result = await app.listMarketItemsForCategory(categoryId, { page: Number.MAX_SAFE_INTEGER })
  assert.equal(result.page, 4)
  assert.equal(result.rows.length, 4)
  assert.equal(app.queries.find((query) => query.table === 'market_items' && !query.head).from, 60)
})
