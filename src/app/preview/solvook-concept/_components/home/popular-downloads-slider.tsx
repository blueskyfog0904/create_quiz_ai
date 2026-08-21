import type { MarketHomePopularItem } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialList } from '../market-material-list'
import { SectionHeading } from './section-heading'

interface PopularDownloadsSliderProps {
  subject: WorkspaceSubject
  items: MarketHomePopularItem[]
  rankingWindowDays: number
}

export function PopularDownloadsSlider({ subject, items, rankingWindowDays }: PopularDownloadsSliderProps) {
  return (
    <section id="popular-downloads">
      <SectionHeading
        eyebrow="TEACHER'S PICK"
        title="인기 다운로드 자료"
        description={`최근 ${rankingWindowDays}일 다운로드 URL 발급 사용자 기준`}
      />
      {items.length === 0 ? (
        <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-5 py-12 text-center text-sm text-[var(--studio-muted)]">
          아직 다운로드 집계가 없습니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
          <MarketMaterialList
            subject={subject}
            items={items.map((item) => ({
              id: item.id,
              title: item.title,
              thumbnailUrl: item.thumbnailUrl,
              detailHref: `/preview/solvook-concept/boards/${item.categorySlug}/items/${item.id}?subject=${subject}`,
              metadataLabels: Array.from(new Set([
                `${item.downloadUserCount.toLocaleString('ko-KR')}명 다운로드`,
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
