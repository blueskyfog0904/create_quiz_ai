import { unstable_cache } from 'next/cache'
import { getPublicMainAdCarouselItems } from '@/lib/main-ad-carousel-server'
import { MARKET_HOME_CACHE_TAG } from '@/lib/market-home'
import { getMarketHomeData } from '@/lib/market-home-server'
import { MARKET_PUBLIC_LIST_CACHE_TAG } from '@/lib/market-images'

// 공개 홈(루트)과 솔북 컨셉 프리뷰 홈이 공유하는 60초 데이터 캐시.
// 어드민 화면은 원본 함수를 직접 호출하므로 영향 없음.
// 상품 이미지가 바뀌면 관리자 API가 MARKET_PUBLIC_LIST_CACHE_TAG로, 홈 진열을 저장하면 MARKET_HOME_CACHE_TAG로 즉시 무효화한다.
// 홈 데이터 읽기 오류는 getMarketHomeData 가 던진다 → 이전 정상 값을 유지한다(22번 3-3).
// 키 -v2: 22번에서 값 모양이 바뀌었다(섹션 배열). 배포 전 모양의 캐시 값을 읽지 않게 한다.
export const getCachedMarketHomeData = unstable_cache(getMarketHomeData, ['preview-market-home-v2'], {
  revalidate: 60,
  tags: [MARKET_PUBLIC_LIST_CACHE_TAG, MARKET_HOME_CACHE_TAG],
})
// 배너는 isActive 항목을 기간(startsAt·endsAt)과 함께 캐시한다. 기간 거르기는 캐시 밖, page 가 요청마다 한다(22번 3-5).
export const getCachedMainAdItems = unstable_cache(getPublicMainAdCarouselItems, ['preview-main-ad'], { revalidate: 60 })
