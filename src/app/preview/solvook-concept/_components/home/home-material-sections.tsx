'use client'

import { useId, useState } from 'react'
import { collapseMarketHomeItems, type MarketHomeItem } from '@/lib/market-home'
import { formatMarketItemRegisteredAt } from '@/lib/market-item-options'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialList } from '../market-material-list'
import { ExpandToggle } from './expand-toggle'
import { SectionHeading } from './section-heading'

// 제목·빈 화면 문구는 DB(홈 진열 설정) 값이다(22번). 빈 문구가 없으면 섹션째 숨기므로 여기 오지 않는다.
export function RecentMaterials({
  subject,
  title,
  emptyText,
  items,
  collapsedLimit = null,
  expandLabel = null,
  collapseLabel = null,
  registeredAtLabel,
}: {
  subject: WorkspaceSubject
  title: string
  emptyText: string | null
  items: MarketHomeItem[]
  // 17절: 처음 보이는 개수와 펼치기·접기 버튼 글자(DB 값). 없으면 모두 보인다.
  collapsedLimit?: number | null
  expandLabel?: string | null
  collapseLabel?: string | null
  // 자료 등록일 이름(DB 상품 표시 설정). null 이면 날짜를 보이지 않는다(숨김·읽기 실패).
  registeredAtLabel: string | null
}) {
  const listId = useId()
  const [expanded, setExpanded] = useState(false)
  const { visible, toggleLabel } = collapseMarketHomeItems(items, { collapsedLimit, expandLabel, collapseLabel }, expanded)

  return (
    <section id="recent-materials">
      <SectionHeading title={title} />
      <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
        {items.length === 0 ? (
          <div className="grid min-h-[112px] place-items-center px-5 text-sm text-[var(--studio-muted)]">{emptyText}</div>
        ) : (
          <>
            <div id={listId}>
              <MarketMaterialList
                subject={subject}
                items={visible.map((item) => ({
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
                  registeredAt: registeredAtLabel
                    ? { label: registeredAtLabel, text: formatMarketItemRegisteredAt(item.createdAt) }
                    : null,
                }))}
              />
            </div>
            {toggleLabel ? (
              <ExpandToggle label={toggleLabel} expanded={expanded} controls={listId} onToggle={() => setExpanded((current) => !current)} />
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}
