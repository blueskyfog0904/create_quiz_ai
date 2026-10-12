import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

// R12(S3): 공개 조회는 상품 상태(published·active·미삭제)만으로 노출을 정한다. 게시판(market_menu_entries) 게이트 없음.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const PUBLIC_QUERY_FILES = [
  'src/lib/market-search-server.ts',
  'src/lib/market-categories-server.ts',
  'src/lib/market-home-server.ts',
  'src/lib/market-cart-server.ts',
  'src/app/api/market/items/[itemId]/sample-pages/route.ts',
]

test('공개 조회 파일은 게시판을 읽지 않고 is_visible 게이트가 없다', () => {
  for (const path of PUBLIC_QUERY_FILES) {
    const source = read(path)
    assert.doesNotMatch(source, /market_menu_entries/, path)
    assert.doesNotMatch(source, /is_visible/, path)
    assert.doesNotMatch(source, /menuMap|visibleMenuIds|matchingMenuIds|loadVisibleMenus/, path)
  }
})

test('검색·보관함 경로는 활성 칸 1쿼리를 메모리에서 조립하고 캐시 모듈을 import하지 않는다', () => {
  const search = read('src/lib/market-search-server.ts')
  const items = read('src/lib/market-items-server.ts')
  const libraryStart = items.indexOf('export async function listMarketLibraryRowsForUser')
  const libraryEnd = items.indexOf('\nexport ', libraryStart + 1)
  const libraryBody = items.slice(libraryStart, libraryEnd === -1 ? undefined : libraryEnd)
  for (const [name, source] of [['search', search], ['library', libraryBody]]) {
    assert.doesNotMatch(source, /market_menu_entries/, name)
    assert.equal(source.match(/\.from\('market_category_items'\)/g)?.length, 1, name)
    assert.match(source, /\.select\('id, workspace_subject, parent_id, depth, title, sort_order, created_at'\)/, name)
    assert.match(source, /buildCategoryTree\(/, name)
    assert.match(source, /findCategoryPath\(/, name)
  }
  for (const source of [search, items]) {
    assert.doesNotMatch(source, /next\/cache|market-category-tree-cache/)
  }
})

test('목록 행 타입은 게시판 값 대신 카테고리 id·경로를 싣는다', () => {
  const search = read('src/lib/market-search-server.ts')
  const searchRow = search.slice(search.indexOf('export interface MarketSearchRow'), search.indexOf('export interface MarketSearchFacetOption'))
  assert.match(searchRow, /categoryId: string \| null/)
  assert.match(searchRow, /categoryPath: MarketCategoryPathNode\[\]/)
  assert.doesNotMatch(searchRow, /categorySlug|categoryTitle/)

  const items = read('src/lib/market-items-server.ts')
  const libraryRow = items.slice(items.indexOf('export interface MarketLibraryRow'), items.indexOf('\n}\n', items.indexOf('export interface MarketLibraryRow')))
  assert.match(libraryRow, /categoryId: string \| null/)
  assert.match(libraryRow, /categoryPath: MarketCategoryPathNode\[\]/)
  assert.doesNotMatch(libraryRow, /categoryTitle/)

  // 카테고리 목록은 이미 받은 칸 정보(조상)로 경로를 만들고 칸을 다시 읽지 않는다.
  const categories = read('src/lib/market-categories-server.ts')
  const list = categories.slice(categories.indexOf('export async function listMarketItemsForCategory'), categories.indexOf('export async function getMarketCategoryItemWorkspaceSubject'))
  assert.match(list, /\[\.\.\.detail\.ancestors, \{ id: detail\.id, title: detail\.title \}\]/)
  assert.doesNotMatch(list, /\.from\('market_category_items'\)/)
})

test('새 마이그레이션의 인기 목록 RPC 정의에 게시판 join이 없다', (t) => {
  const directory = new URL('../supabase/migrations/', import.meta.url)
  const name = readdirSync(directory).find((file) => /^\d+_market_public_gate_without_board\.sql$/.test(file))
  if (!name) {
    t.skip('supabase/migrations/*_market_public_gate_without_board.sql(M3)이 아직 없다 — 마이그레이션 작성 뒤 다시 실행')
    return
  }
  // 옛 정의는 market-home-download-ranking-contract가 그대로 읽는다. 여기서는 새 파일만 본다.
  const migration = readFileSync(new URL(name, directory), 'utf8').replace(/--[^\n]*/g, '')
  const definition = migration.match(/create\s+or\s+replace\s+function\s+public\.get_market_home_popular_items\s*\([\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\1/i)
  assert.ok(definition, 'get_market_home_popular_items 정의가 있어야 한다')
  assert.doesNotMatch(definition[2], /market_menu_entries/i)
})
