import type {
  MarketHomeItem,
  MarketHomeMenuEntry,
} from '@/lib/market-home'
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
      <SectionHeading eyebrow="NEW MATERIALS" title="최근 등록된 수업 자료" description="새로 올라온 자료의 카테고리, 출처, 문항 수를 한 번에 확인하세요." />
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
              detailHref: `/preview/solvook-concept/boards/${item.categorySlug}/items/${item.id}?subject=${subject}`,
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

export function HomeFinalCta({
  subject,
  itemCount,
}: {
  subject: WorkspaceSubject
  itemCount: number
  categories: MarketHomeMenuEntry[]
}) {
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  return (
    <section>
      <div className="relative flex flex-col items-start justify-between gap-6 overflow-hidden rounded-xl bg-[var(--studio-ink)] px-6 py-9 text-white sm:px-10 sm:py-11 md:flex-row md:items-center">
        <div className="absolute -right-14 -top-20 h-56 w-56 rounded-full border-[36px] border-white/[0.04]" />
        <div className="relative">
          <p className="text-xs font-extrabold tracking-[0.14em] text-[#9af0d6]">START YOUR CLASS MATERIAL</p>
          <h2 className="mt-3 break-keep text-2xl font-black tracking-[-0.035em] sm:text-3xl">필요한 {subjectLabel} 자료부터 찾아 수업을 준비하세요</h2>
          <p className="mt-2 break-keep text-sm leading-6 text-white/65">현재 공개된 {subjectLabel} 문제마켓 자료 {itemCount.toLocaleString('ko-KR')}개를 살펴볼 수 있습니다.</p>
        </div>
      </div>
    </section>
  )
}
