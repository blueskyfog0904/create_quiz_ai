import { unstable_cache } from 'next/cache'
import { MARKET_CATEGORY_TREE_CACHE_TAG, MARKET_PUBLIC_LIST_CACHE_TAG } from '@/lib/market-images'
import {
  loadMarketSearchCatalog,
  searchMarketCatalog,
  type MarketSearchFilters,
  type MarketSearchResult,
} from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

// 검색 카탈로그는 검색어·필터와 무관해 과목별 60초 공유 캐시로 읽는다.
// 관리자가 상품·칸을 바꾸면 공개 목록·카테고리 트리 태그로 즉시 무효화된다.
const getCachedMarketSearchCatalog = unstable_cache(
  loadMarketSearchCatalog,
  ['market-search-catalog'],
  { revalidate: 60, tags: [MARKET_PUBLIC_LIST_CACHE_TAG, MARKET_CATEGORY_TREE_CACHE_TAG] }
)

export async function searchCachedMarketItemsForSubject(
  workspaceSubject: WorkspaceSubject,
  filters: MarketSearchFilters
): Promise<MarketSearchResult> {
  return searchMarketCatalog(await getCachedMarketSearchCatalog(workspaceSubject), workspaceSubject, filters)
}
