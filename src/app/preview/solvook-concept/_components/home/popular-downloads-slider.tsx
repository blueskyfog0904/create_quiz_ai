'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  collapseMarketHomeItems,
  plainMarketHomeTitle,
  visibleMarketHomePeriods,
  type MarketHomePopularItem,
  type MarketHomeRenderedPeriod,
} from '@/lib/market-home'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { MarketMaterialList } from '../market-material-list'
import { ExpandToggle } from './expand-toggle'
import { SectionHeading } from './section-heading'

interface PopularDownloadsSliderProps {
  subject: WorkspaceSubject
  // 제목·빈 화면 문구는 DB(홈 진열 설정) 값이다(22번). 빈 문구가 없으면 섹션째 숨기므로 여기 오지 않는다.
  title: string
  emptyText: string | null
  items: MarketHomePopularItem[]
  // 17절: 기간 버튼별 순위(없으면 버튼 없이 items 만), 처음 보이는 개수, 펼치기·접기 버튼 글자 — 모두 DB 값
  periods?: MarketHomeRenderedPeriod[] | null
  collapsedLimit?: number | null
  expandLabel?: string | null
  collapseLabel?: string | null
}

export function PopularDownloadsSlider({
  subject,
  title,
  emptyText,
  items,
  periods = null,
  collapsedLimit = null,
  expandLabel = null,
  collapseLabel = null,
}: PopularDownloadsSliderProps) {
  const listId = useId()
  const [selectedDays, setSelectedDays] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  // 빈 화면 문구가 없으면 0개인 기간의 버튼은 보이지 않는다
  const tabs = visibleMarketHomePeriods({ periods, emptyText })
  const selected = tabs.find((tab) => tab.days === selectedDays) ?? tabs[0] ?? null
  const periodItems = selected ? selected.items : items
  const { visible, toggleLabel } = collapseMarketHomeItems(periodItems, { collapsedLimit, expandLabel, collapseLabel }, expanded)

  return (
    <section id="popular-downloads">
      <SectionHeading title={title} />
      {tabs.length > 0 ? (
        <div role="group" aria-label={plainMarketHomeTitle(title)} className="mb-4 flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <Button
              key={tab.days}
              type="button"
              variant={tab === selected ? 'brand' : 'brandOutline'}
              aria-pressed={tab === selected}
              className="rounded-full px-5 font-bold"
              // 기간을 바꾸면 목록은 다시 접힌 채로 시작한다
              onClick={() => { setSelectedDays(tab.days); setExpanded(false) }}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      ) : null}
      {periodItems.length === 0 ? (
        <div className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] px-5 py-12 text-center text-sm text-[var(--studio-muted)]">
          {emptyText}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)]">
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
              }))}
            />
          </div>
          {toggleLabel ? (
            <ExpandToggle label={toggleLabel} expanded={expanded} controls={listId} onToggle={() => setExpanded((current) => !current)} />
          ) : null}
        </div>
      )}
    </section>
  )
}
