import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('공개 검색 화면은 과목별 카탈로그를 공유 캐시로 읽고, 관리자 변경 태그로 무효화된다', () => {
  const cache = read('src/lib/market-search-cache.ts')
  assert.match(cache, /unstable_cache\(\n\s+loadMarketSearchCatalog,\n\s+\['market-search-catalog'\],\n\s+\{ revalidate: 60, tags: \[MARKET_PUBLIC_LIST_CACHE_TAG, MARKET_CATEGORY_TREE_CACHE_TAG\] \}/)
  assert.match(cache, /searchMarketCatalog\(await getCachedMarketSearchCatalog\(workspaceSubject\), workspaceSubject, filters\)/)

  const page = read('src/app/(solvook)/search/page.tsx')
  assert.match(page, /await searchCachedMarketItemsForSubject\(subject, \{/)
  assert.doesNotMatch(page, /searchMarketItemsForSubject\(/)
})

test('검색 서버는 카탈로그 읽기와 검색어·필터 적용을 나누고, 캐시 없는 기존 진입점도 같은 경로를 쓴다', () => {
  const server = read('src/lib/market-search-server.ts')
  assert.match(server, /export async function loadMarketSearchCatalog\(workspaceSubject: WorkspaceSubject\)/)
  assert.match(server, /return searchMarketCatalog\(await loadMarketSearchCatalog\(workspaceSubject\), workspaceSubject, filters\)/)
  // 샘플 가용 여부는 캐시하지 않고 현재 페이지 행만 매번 조회한다
  const searchBody = server.slice(server.indexOf('export async function searchMarketCatalog'))
  assert.match(searchBody, /listActiveMarketItemSamplePagesForItems\(\n\s+pagedRows\.map/)
  assert.doesNotMatch(searchBody, /\.from\('market_items'\)/)
})
