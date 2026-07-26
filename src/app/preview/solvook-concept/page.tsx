import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { StudioLandingPageFrame } from '@/components/page-templates'
import { getPublicMainAdCarouselItems } from '@/lib/main-ad-carousel-server'
import { CampaignHero } from './_components/home/campaign-hero'
import { MainAdCarousel } from './_components/home/main-ad-carousel'
import {
  HomeFinalCta,
  RecentMaterials,
  RecommendedMaterials,
  TextbookExplorer,
} from './_components/home/home-material-sections'
import { QuickAccessGrid } from './_components/home/quick-access-grid'
import {
  getRecentSamplePosts,
  getSamplePost,
  getSampleTextbookCounts,
  samplePosts,
} from './_data/sample-data'

export const metadata: Metadata = {
  title: '써머썬 스튜디오 | 자료 탐색 프리뷰',
  description:
    '교재와 작품을 탐색하고 지문 구조와 문항 구성을 확인하는 선생님용 자료 워크스페이스 시안',
}

const featuredPost = getSamplePost('ebs-literature', 'jingsori-2027')

export default async function SolvookConceptPreviewPage() {
  if (!featuredPost) {
    notFound()
  }

  const mainAdItems = await getPublicMainAdCarouselItems()

  return (
    <StudioLandingPageFrame
      hero={mainAdItems.length > 0
        ? <MainAdCarousel items={mainAdItems} />
        : <CampaignHero featuredPost={featuredPost} />}
    >
      <QuickAccessGrid />
      <RecommendedMaterials posts={samplePosts.slice(0, 4)} />
      <TextbookExplorer textbookCounts={getSampleTextbookCounts()} />
      <RecentMaterials posts={getRecentSamplePosts(5)} />
      <HomeFinalCta />
    </StudioLandingPageFrame>
  )
}
