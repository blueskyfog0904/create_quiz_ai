import { unstable_cache } from 'next/cache'
import { getPublicMainAdCarouselItems } from '@/lib/main-ad-carousel-server'
import { getMarketHomeData } from '@/lib/market-home-server'
import { MARKET_PUBLIC_LIST_CACHE_TAG } from '@/lib/market-images'

// 공개 홈(루트)과 솔북 컨셉 프리뷰 홈이 공유하는 60초 데이터 캐시.
// 어드민 화면은 원본 함수를 직접 호출하므로 영향 없음.
// 상품 이미지가 바뀌면 관리자 API가 MARKET_PUBLIC_LIST_CACHE_TAG로 즉시 무효화한다.
export const getCachedMarketHomeData = unstable_cache(getMarketHomeData, ['preview-market-home'], {
  revalidate: 60,
  tags: [MARKET_PUBLIC_LIST_CACHE_TAG],
})
export const getCachedMainAdItems = unstable_cache(getPublicMainAdCarouselItems, ['preview-main-ad'], { revalidate: 60 })
