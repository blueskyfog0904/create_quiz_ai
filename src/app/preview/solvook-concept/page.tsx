import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CampaignHero } from './_components/home/campaign-hero'
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

export default function SolvookConceptPreviewPage() {
  if (!featuredPost) {
    notFound()
  }

  return (
    <div>
      <CampaignHero featuredPost={featuredPost} />
      <QuickAccessGrid />
      <RecommendedMaterials posts={samplePosts.slice(0, 4)} />
      <TextbookExplorer textbookCounts={getSampleTextbookCounts()} />
      <RecentMaterials posts={getRecentSamplePosts(5)} />
      <HomeFinalCta />
    </div>
  )
}
