import type { Metadata } from 'next'
import { connection } from 'next/server'
import { StudioLandingPageFrame } from '@/components/page-templates'
import { filterVisibleMainAdItems } from '@/lib/main-ad-carousel'
import { marketHomeReadFailed } from '@/lib/market-home'
import { getCachedMainAdItems, getCachedMarketHomeData } from '@/lib/preview-home-cache'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MainAdCarousel } from './_components/home/main-ad-carousel'
import { MarketHomeSections } from './_components/home/market-home-sections'

export const metadata: Metadata = {
  title: '문제마켓 프리뷰',
  description: '영어와 국어 수업 자료를 과목별로 탐색하는 선생님용 문제마켓 프리뷰',
}

function resolveSubject(value?: string): WorkspaceSubject {
  return value === 'korean' ? 'korean' : 'english'
}

export default async function SolvookConceptPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ subject?: string }>
}) {
  await connection()
  const params = await searchParams
  const subject = resolveSubject(params.subject)
  const [homeData, cachedAdItems] = await Promise.all([
    getCachedMarketHomeData(subject).catch(() => marketHomeReadFailed(subject)),
    getCachedMainAdItems(subject),
  ])
  // 회원 홈(루트)과 같은 섹션 배열·배너 거르기(22번 3-3·3-5). 기간 거르기는 캐시 밖에서 요청마다.
  const mainAdItems = filterVisibleMainAdItems(cachedAdItems, new Date())

  return (
    <StudioLandingPageFrame
      hero={mainAdItems.length > 0 ? <MainAdCarousel subject={subject} items={mainAdItems} /> : null}
    >
      <MarketHomeSections subject={subject} homeData={homeData} visibleBannerCount={mainAdItems.length} />
    </StudioLandingPageFrame>
  )
}
