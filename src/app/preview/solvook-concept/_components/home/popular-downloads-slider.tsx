import type { MarketHomePopularItem } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialList } from '../market-material-list'
import { SectionHeading } from './section-heading'

interface PopularDownloadsSliderProps {
  subject: WorkspaceSubject
  // 제목·빈 화면 문구는 DB(홈 진열 설정) 값이다(22번). 빈 문구가 없으면 섹션째 숨기므로 여기 오지 않는다.
  title: string
  emptyText: string | null
  items: MarketHomePopularItem[]
}

export function PopularDownloadsSlider({ subject, title, emptyText, items }: PopularDownloadsSliderProps) {
  return (
    <section id="popular-downloads">
      <SectionHeading title={title} />
      {items.length === 0 ? (
        <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-5 py-12 text-center text-sm text-[var(--studio-muted)]">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
          <MarketMaterialList
            subject={subject}
            items={items.map((item) => ({
              id: item.id,
              title: item.title,
              thumbnailUrl: item.thumbnailUrl,
              detailHref: `/items/${item.id}?subject=${subject}`,
              metadataLabels: Array.from(new Set([
                ...item.sources,
                item.sourceType,
                item.questionCount !== null ? `${item.questionCount}문항` : null,
              ].filter((value): value is string => Boolean(value)))).slice(0, 2),
              sampleAvailable: item.sample.available,
              startingPriceCredits: item.startingPriceCredits,
              ratingAverage: item.ratingAverage,
              ratingCount: item.ratingCount,
            }))}
          />
        </div>
      )}
    </section>
  )
}
