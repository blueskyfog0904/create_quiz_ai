'use client'

import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fillSampleCount, type MarketItemDetailDisplay } from '@/lib/market-item-options'

// 상세 구매 칸 맨 위 무료 샘플 줄(D4: 장식 카드·배지 없이 한 줄 행). 19번: 제목·설명·버튼 글은 DB 상세 안내 문구({장수} = 샘플 장수).
// 회원 상세(market-item-actions)와 관리자 '상세 안내 문구' 미리보기가 같은 부품을 쓴다(미리보기는 onOpen 없이 그림 — 요청 없음).
interface MarketSampleRowProps {
  titleId: string
  display: Pick<MarketItemDetailDisplay, 'sampleTitle' | 'sampleTitleEmpty' | 'sampleDescription' | 'sampleDescriptionLegacy'
    | 'sampleDescriptionEmpty' | 'sampleRowButton'>
  samplePageCount: number
  hasLegacySample: boolean
  onOpen?: () => void
  onPrefetch?: () => void
}

export function MarketSampleRow({ titleId, display, samplePageCount, hasLegacySample, onOpen, onPrefetch }: MarketSampleRowProps) {
  const hasSamplePages = samplePageCount > 0
  return (
    <section aria-labelledby={titleId} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--studio-border)] pb-4">
      <div className="min-w-0">
        <h3 id={titleId} className="text-sm font-bold text-[var(--studio-ink)]">
          {hasSamplePages ? display.sampleTitle : display.sampleTitleEmpty}
        </h3>
        <p className="mt-0.5 break-keep text-xs leading-5 text-[var(--studio-muted)]">
          {hasSamplePages
            ? fillSampleCount(display.sampleDescription, samplePageCount)
            : hasLegacySample
              ? display.sampleDescriptionLegacy
              : display.sampleDescriptionEmpty}
        </p>
      </div>
      {hasSamplePages ? (
        <Button
          type="button"
          variant="brandOutline"
          className="min-h-11 shrink-0"
          onClick={onOpen}
          onFocus={onPrefetch}
          onMouseEnter={onPrefetch}
          onTouchStart={onPrefetch}
        >
          <Eye aria-hidden="true" className="h-4 w-4" />
          {display.sampleRowButton}
        </Button>
      ) : null}
    </section>
  )
}
