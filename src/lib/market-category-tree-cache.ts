import { unstable_cache } from 'next/cache'
import { listMarketCategoryMenu } from '@/lib/market-categories-server'

// 카테고리 목록(항목별 상품 수 포함)은 페이지마다 같은 값이라 60초 공유 캐시로 읽는다.
// 카테고리 페이지 사이드바와 상품 상세의 경로·사이드바가 함께 쓴다.
// 상단 메가메뉴 API(/api/market/category-menu)도 같은 데이터를 60초 캐시한다.
export const getCachedCategoryMenu = unstable_cache(
  () => listMarketCategoryMenu(true),
  ['category-menu-with-counts'],
  { revalidate: 60 }
)
