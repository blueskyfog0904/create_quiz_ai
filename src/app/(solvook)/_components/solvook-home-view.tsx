'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  HomeFinalCta,
  RecentMaterials,
} from '@/app/preview/solvook-concept/_components/home/home-material-sections'
import { MainAdCarousel } from '@/app/preview/solvook-concept/_components/home/main-ad-carousel'
import { PopularDownloadsSlider } from '@/app/preview/solvook-concept/_components/home/popular-downloads-slider'
import { StudioLandingPageFrame } from '@/components/page-templates'
import type { PublicMainAdCarouselItem } from '@/lib/main-ad-carousel'
import type { MarketHomeData } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface SubjectHomeData {
  homeData: MarketHomeData
  adItems: PublicMainAdCarouselItem[]
}

interface SolvookHomeViewProps {
  english: SubjectHomeData
  korean: SubjectHomeData
  initialSubject: WorkspaceSubject
}

export function SolvookHomeView({
  english,
  korean,
  initialSubject,
}: SolvookHomeViewProps) {
  const searchParams = useSearchParams()
  const paramSubject = searchParams.get('subject')
  const subject: WorkspaceSubject =
    paramSubject === 'korean' || paramSubject === 'english'
      ? paramSubject
      : initialSubject
  const { homeData, adItems } = subject === 'korean' ? korean : english

  useEffect(() => {
    document.cookie = `preferred_workspace=${subject}; path=/; max-age=31536000`
  }, [subject])

  return (
    <StudioLandingPageFrame
      hero={<MainAdCarousel subject={subject} items={adItems} categories={homeData.categories} />}
    >
      {homeData.config.popular.isActive && (
        <PopularDownloadsSlider subject={subject} items={homeData.popular} rankingWindowDays={homeData.config.popular.rankingWindowDays} />
      )}
      {homeData.config.recent.isActive && (
        <RecentMaterials subject={subject} items={homeData.recent} />
      )}
      <HomeFinalCta subject={subject} itemCount={homeData.publicItemCount} categories={homeData.categories} />
    </StudioLandingPageFrame>
  )
}
