'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { MainAdCarousel } from '@/app/preview/solvook-concept/_components/home/main-ad-carousel'
import { MarketHomeSections } from '@/app/preview/solvook-concept/_components/home/market-home-sections'
import { StudioLandingPageFrame } from '@/components/page-templates'
import type { PublicMainAdCarouselItem } from '@/lib/main-ad-carousel'
import type { MarketHomeData } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface SubjectHomeData {
  homeData: MarketHomeData
  // page 가 요청마다 기간으로 거른 배너(22번 3-5)
  adItems: PublicMainAdCarouselItem[]
}

interface SolvookHomeViewProps {
  english: SubjectHomeData
  korean: SubjectHomeData
  initialSubject: WorkspaceSubject
  // 최근 등록 섹션의 자료 등록일 이름(DB 상품 표시 설정). null 이면 날짜를 보이지 않는다.
  registeredAtLabel: string | null
}

export function SolvookHomeView({
  english,
  korean,
  initialSubject,
  registeredAtLabel,
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

  // 보일 배너가 0개면 배너 영역을 그리지 않는다(Q6). 과목 탭을 바꿀 때 영역이 생겼다 사라질 수 있다(의도).
  return (
    <StudioLandingPageFrame
      hero={adItems.length > 0 ? <MainAdCarousel subject={subject} items={adItems} /> : null}
    >
      <MarketHomeSections subject={subject} homeData={homeData} visibleBannerCount={adItems.length} registeredAtLabel={registeredAtLabel} />
    </StudioLandingPageFrame>
  )
}
