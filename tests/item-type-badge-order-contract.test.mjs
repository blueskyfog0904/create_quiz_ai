import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createFakeAdmin, load, marketImages, op } from './helpers/market-images-harness.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('카테고리·검색 목록은 분류를 sort_order → name 순으로 읽고, 정렬된 분류 배열을 상품 분류로 걸러 배지를 만든다', () => {
  for (const path of ['src/lib/market-categories-server.ts', 'src/lib/market-search-server.ts']) {
    const source = read(path)
    assert.match(
      source,
      /\.from\('market_subproduct_categories'\)\n\s+\.select\('id, slug, name, sort_order'\)\n\s+\.eq\('workspace_subject', workspaceSubject\)\n\s+\.order\('sort_order'\)\.order\('name'\)/,
      path,
    )
    assert.match(source, /typeCategories\n\s+\.filter\(\(category\) => categoryIds\?\.has\(category\.id\)\)/, path)
    assert.doesNotMatch(source, /typeCategoryMap/, path)
  }
  assert.match(read('src/lib/market-categories-server.ts'), /typeNames: typeNamesOf\(item\.id\)/)
  const search = read('src/lib/market-search-server.ts')
  assert.match(search, /const itemTypeSlugs = typeSlugsOf\(item\.id\)/)
  assert.match(search, /types: typeSlugOrder\n\s+\.filter\(\(slug\) => typeCounts\.has\(slug\)\)/)
  assert.doesNotMatch(search, /types: toOptions\(/)
})

test('검색 결과 배지와 유형 옵션은 서브상품 순서와 관계없이 DB가 준 분류 순서를 따른다', async () => {
  // DB가 sort_order → name으로 정렬해 준 순서(워크북 10, 문제(PDF) 20, 문제(HWP) 30)를 흉내 낸다.
  const categories = [
    { id: 'c-wb', slug: 'workbook', name: '워크북', sort_order: 10 },
    { id: 'c-pdf', slug: 'pdf', name: '문제(PDF)', sort_order: 20 },
    { id: 'c-hwp', slug: 'hwp', name: '문제(HWP)', sort_order: 30 },
  ]
  const subproducts = [
    { item_id: 'a', category_id: 'c-hwp', price_credits: 300 },
    { item_id: 'a', category_id: 'c-wb', price_credits: 100 },
    { item_id: 'a', category_id: 'c-pdf', price_credits: 200 },
    { item_id: 'b', category_id: 'c-pdf', price_credits: 200 },
    { item_id: 'b', category_id: 'c-hwp', price_credits: 300 },
    { item_id: 'b', category_id: 'c-pdf', price_credits: 250 },
  ]
  const admin = createFakeAdmin(({ table }) => {
    if (table === 'market_items') {
      return {
        data: [
          { id: 'a', title: 'A', menu_entry_id: 'm', view_count: 2 },
          { id: 'b', title: 'B', menu_entry_id: 'm', view_count: 1 },
        ],
        error: null,
      }
    }
    if (table === 'market_menu_entries') return { data: [{ id: 'm', slug: 'board', title: '게시판' }], error: null }
    if (table === 'market_item_subproducts') return { data: subproducts, error: null }
    if (table === 'market_subproduct_categories') return { data: categories, error: null }
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
  })
  const result = await server.searchMarketItemsForSubject('korean', {})
  assert.deepEqual(result.rows.map((row) => [row.itemId, row.typeNames]), [
    ['a', ['워크북', '문제(PDF)', '문제(HWP)']],
    ['b', ['문제(PDF)', '문제(HWP)']],
  ])
  assert.deepEqual(result.facets.types.map((option) => [option.label, option.count]), [
    ['워크북', 1],
    ['문제(PDF)', 2],
    ['문제(HWP)', 2],
  ])
  const categoryQuery = admin.calls.find((call) => call.table === 'market_subproduct_categories')
  assert.deepEqual(categoryQuery.ops.filter(([name]) => name === 'order'), [['order', 'sort_order'], ['order', 'name']])
  assert.equal(op(categoryQuery.ops, 'select')[1], 'id, slug, name, sort_order')
})
