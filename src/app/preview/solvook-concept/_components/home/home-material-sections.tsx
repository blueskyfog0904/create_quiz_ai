import type { MarketHomeItem } from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialList } from '../market-material-list'
import { SectionHeading } from './section-heading'

export function RecentMaterials({
  subject,
  items,
}: {
  subject: WorkspaceSubject
  items: MarketHomeItem[]
}) {
  return (
    <section id="recent-materials">
      <SectionHeading title="최근 등록된 수업 자료" />
      <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
        {items.length === 0 ? (
          <div className="grid min-h-[112px] place-items-center px-5 text-sm text-[var(--studio-muted)]">최근 등록된 자료가 없습니다.</div>
        ) : (
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
        )}
      </div>
    </section>
  )
}
