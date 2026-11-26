'use client'

import type { ReactNode, RefObject } from 'react'
import Link from 'next/link'
import { StudioContainer, StudioEmptyState } from '@/components/design-system'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatCartCredits } from '@/lib/cart-checkout-panel'

// 11번 6-1 표시 부품: 장바구니 화면 틀(2단·'결제 칸으로 건너뛰기'·목록·결제 칸·고정 막대). 요청 없음.

export const CART_BAR_HEIGHT = 72

export interface CartCheckoutBarProps {
  visible: boolean
  selectedCount: number
  total: number
  barRef: RefObject<HTMLDivElement | null>
  // 결제 칸으로 스크롤하고 첫 번째 막힌 조작에 초점을 준다. 막대는 결제하지 않는다.
  onGoToPanel: () => void
  // 잔액 부족일 때만: 충전 페이지 링크(이름은 결제 칸 주 버튼과 같은 값)
  charge?: { href: string; label: string } | null
}

// 고정 막대: 결제 버튼 줄이 화면 밖일 때 모든 폭에서 보인다. 보이지 않을 때는 hidden·inert.
export function CartCheckoutBar({ visible, selectedCount, total, barRef, onGoToPanel, charge }: CartCheckoutBarProps) {
  return (
    <div
      ref={barRef}
      hidden={!visible}
      inert={!visible}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--studio-border)] bg-[var(--studio-surface)] pb-[env(safe-area-inset-bottom)]"
    >
      <StudioContainer className="flex min-h-[72px] items-center justify-between gap-3 py-3">
        <p className="min-w-0 text-sm text-[var(--studio-text)]">
          선택 {selectedCount}건 · <span className="font-extrabold tabular-nums text-[var(--studio-primary)]">합계 {formatCartCredits(total)}</span>
        </p>
        {/* 잔액 부족이면 막대도 충전 페이지로 안내한다(막대는 결제하지 않는다). */}
        {charge ? (
          <Button asChild variant="brand" className="shrink-0 min-h-11">
            <Link href={charge.href}>{charge.label}</Link>
          </Button>
        ) : (
          <Button type="button" variant="brand" className="shrink-0 min-h-11" onClick={onGoToPanel}>
            결제 칸으로
          </Button>
        )}
      </StudioContainer>
    </div>
  )
}

export interface CartPageViewProps {
  count: number
  isEmpty: boolean
  upcomingNotice?: ReactNode
  list: ReactNode
  panel: ReactNode
  bar: ReactNode
  barVisible: boolean
}

export function CartPageView({ count, isEmpty, upcomingNotice, list, panel, bar, barVisible }: CartPageViewProps) {
  return (
    <StudioContainer className={cn('pt-8 sm:pt-10', barVisible ? 'pb-32' : 'pb-16')}>
      {!isEmpty ? (
        <a
          href="#cart-checkout-panel-title"
          className="sr-only rounded-md bg-[var(--studio-surface)] px-3 py-2 text-sm font-bold text-[var(--studio-ink)] focus:not-sr-only focus:absolute focus:z-50 focus:ring-2 focus:ring-[var(--studio-focus-ring)]"
        >
          결제 칸으로 건너뛰기
        </a>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <h1 className="text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">장바구니</h1>
        <p className="pb-1 text-sm text-[var(--studio-muted)]">{count}/50</p>
      </div>
      {upcomingNotice ? <div className="mt-4">{upcomingNotice}</div> : null}

      {isEmpty ? (
        <div className="mt-8">
          <StudioEmptyState
            title="장바구니가 비어 있습니다"
            description="문제마켓 상세 화면에서 필요한 자료를 장바구니에 담아 보세요."
            action={(
              <Button asChild variant="brand">
                <Link href="/">자료 둘러보기</Link>
              </Button>
            )}
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <div className="min-w-0">{list}</div>
          {panel}
        </div>
      )}
      {!isEmpty ? bar : null}
    </StudioContainer>
  )
}
