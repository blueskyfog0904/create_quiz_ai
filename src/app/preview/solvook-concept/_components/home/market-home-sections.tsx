import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  shouldShowEmptyHomeLink,
  visibleMarketHomeSections,
  type MarketHomeData,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { FeaturedMaterials } from './featured-materials'
import { RecentMaterials } from './home-material-sections'
import { PopularDownloadsSlider } from './popular-downloads-slider'

// 22번 회원 홈 섹션: 저장한 순서·제목대로 그린다(3-3). 0개 섹션은 빈 화면 문구가 있을 때만 보인다.
// 보일 섹션과 배너가 모두 0개면 빈 홈 링크 한 줄(과목 문제마켓)을 보인다. 문구는 모두 DB 값이다.
export function MarketHomeSections({
  subject,
  homeData,
  visibleBannerCount,
}: {
  subject: WorkspaceSubject
  homeData: MarketHomeData
  visibleBannerCount: number
}) {
  const sections = visibleMarketHomeSections(homeData.sections)

  return (
    <>
      {sections.map((section) => {
        if (section.kind === 'popular') {
          return <PopularDownloadsSlider key={section.id} subject={subject} title={section.title} emptyText={section.emptyText} items={section.items} />
        }
        if (section.kind === 'recent') {
          return <RecentMaterials key={section.id} subject={subject} title={section.title} emptyText={section.emptyText} items={section.items} />
        }
        return (
          <FeaturedMaterials
            key={section.id}
            sectionId={section.id}
            subject={subject}
            title={section.title}
            emptyText={section.emptyText}
            items={section.items}
          />
        )
      })}
      {shouldShowEmptyHomeLink(homeData, visibleBannerCount) ? (
        <p className="text-center">
          <Link
            href={`/search?subject=${subject}`}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-bold text-[var(--studio-text)] outline-none transition-colors hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
          >
            {homeData.emptyHomeLink}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </Link>
        </p>
      ) : null}
    </>
  )
}
