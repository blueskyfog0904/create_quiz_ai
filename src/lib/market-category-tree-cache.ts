import { unstable_cache } from 'next/cache'
import { listMarketCategoryTree } from '@/lib/market-categories-server'
import { MARKET_CATEGORY_TREE_CACHE_TAG } from '@/lib/market-images'

// 카테고리 트리는 페이지마다 같은 값이라 60초 공유 캐시로 읽고, 관리자가 칸·상품을 바꾸면 태그로 즉시 무효화한다.
// 칸별 상품 수 포함: 카테고리 사이드바·'더 자세히 찾기'·상품 상세 경로와 사이드바가 쓴다.
export const getCachedCategoryTree = unstable_cache(
  () => listMarketCategoryTree(true),
  ['category-tree-with-counts'],
  { revalidate: 60, tags: [MARKET_CATEGORY_TREE_CACHE_TAG] }
)

// 상품 수 없이 활성 칸만(캐시 미스 때 1쿼리): 카테고리 페이지의 칸 존재 확인(404)과 하위 칸 계산에 쓴다.
export const getCachedCategoryNodes = unstable_cache(
  () => listMarketCategoryTree(false),
  ['category-tree-nodes'],
  { revalidate: 60, tags: [MARKET_CATEGORY_TREE_CACHE_TAG] }
)
