import type { Metadata } from 'next'
import { connection } from 'next/server'
import { StudioLandingPageFrame } from '@/components/page-templates'
import { getPublicMainAdCarouselItems } from '@/lib/main-ad-carousel-server'
import { getMarketHomeData } from '@/lib/market-home-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import {
  HomeFinalCta,
  RecentMaterials,
  TextbookExplorer,
} from './_components/home/home-material-sections'
import { MainAdCarousel } from './_components/home/main-ad-carousel'
import { PopularDownloadsSlider } from './_components/home/popular-downloads-slider'

export const metadata: Metadata = {
  title: '써머썬 스튜디오 | 문제마켓 프리뷰',
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
  const [homeData, mainAdItems] = await Promise.all([
    getMarketHomeData(subject),
    getPublicMainAdCarouselItems(subject),
  ])

  return (
    <StudioLandingPageFrame
      hero={<MainAdCarousel subject={subject} items={mainAdItems} categories={homeData.categories} />}
    >
      {homeData.config.popular.isActive && (
        <PopularDownloadsSlider subject={subject} items={homeData.popular} rankingWindowDays={homeData.config.popular.rankingWindowDays} />
      )}
      {homeData.config.recent.isActive && (
        <RecentMaterials subject={subject} items={homeData.recent} />
      )}
      {homeData.config.sourceExplorer.isActive && (
        <TextbookExplorer subject={subject} configs={homeData.sourceConfigs} paths={homeData.sourcePaths} />
      )}
      <HomeFinalCta subject={subject} itemCount={homeData.publicItemCount} categories={homeData.categories} />
    </StudioLandingPageFrame>
  )
}
