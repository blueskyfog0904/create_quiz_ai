import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import * as pagination from '../src/lib/list-pagination.ts'
import { readAllQueryRows } from '../src/lib/read-all-query-rows.ts'

const categoryId = '00000000-0000-4000-8000-000000000001'
function harness() {
  const items = Array.from({ length: 64 }, (_, id) => ({
    id: String(id).padStart(3, '0'), title: `자료 ${id}`, summary: null,
    category_item_id: categoryId, workspace_subject: 'korean', menu_entry_id: 'visible',
    is_active: true, status: 'published', deleted_at: null,
    view_count: 1, created_at: '2026-01-01', published_at: '2026-01-01',
  }))
  const tables = {
    market_category_groups: [{ id: 'group', workspace_subject: 'korean', title: 'EBS', is_active: true }],
    market_category_items: [{ id: categoryId, group_id: 'group', workspace_subject: 'korean', title: '독서', is_active: true }],
    market_menu_entries: [
      { id: 'visible', workspace_subject: 'korean', slug: 'reading', title: '독서', is_visible: true, is_active: true, deleted_at: null },
      { id: 'hidden', workspace_subject: 'korean', slug: 'hidden', title: '숨김', is_visible: false, is_active: true, deleted_at: null },
    ],
    market_items: [...items, ...[
      { status: 'draft' }, { is_active: false }, { deleted_at: '2026-01-01' },
      { workspace_subject: 'english' }, { menu_entry_id: 'hidden' },
      { category_item_id: 'another-category' },
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
    '@/lib/market-images': { MARKET_IMAGES_BUCKET: 'market-images' },
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

test('sidebar group and category counts equal the unfiltered visible catalog', async () => {
  const app = harness()
  const menu = await app.listMarketCategoryMenu(true)
  assert.equal(menu.korean[0].itemCount, 64)
  assert.equal(menu.korean[0].items[0].itemCount, 64)
  assert.equal(menu.english.length, 0)
})

test('out of range pages clamp before the item range query', async () => {
  const app = harness()
  const result = await app.listMarketItemsForCategory(categoryId, { page: Number.MAX_SAFE_INTEGER })
  assert.equal(result.page, 4)
  assert.equal(result.rows.length, 4)
  assert.equal(app.queries.find((query) => query.table === 'market_items' && !query.head).from, 60)
})
