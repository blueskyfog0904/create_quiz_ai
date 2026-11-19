'use client'

import { useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import {
  StudioDialogDescription,
  StudioDialogFooter,
  StudioDialogHeader,
  StudioDialogPanel,
  StudioDialogTitle,
} from '@/components/design-system/studio-dialog'

export interface MarketPurchaseCompleteOrder {
  orderId: string
  itemTitle: string
  optionTitle: string | null
  categoryName: string | null
  chargedCredits: number
  workspaceSubject: string
}

export interface MarketPurchaseCompleteResult {
  orders: MarketPurchaseCompleteOrder[]
  totalCredits: number
  // 헤더 credit-balance-updated와 같은 표시용 잔액. 응답에 없으면 null이고 줄을 생략한다.
  balance: number | null
  alreadyCompleted: boolean
}

interface MarketPurchaseCompleteDialogProps {
  result: MarketPurchaseCompleteResult | null
  libraryHref: string
  onClose: () => void
}

function formatCredits(value: number) {
  return value.toLocaleString('ko-KR')
}

// 구매한 자료가 한 과목뿐이면 그 과목 보관함으로, 섞였거나 없으면 보관함 기본(최근 구매 과목)으로 보낸다.
export function resolveMarketLibraryHref(subjects: string[]) {
  const unique = new Set(subjects)
  if (unique.size !== 1) {
    return '/library'
  }
  const [subject] = unique
  return subject === 'korean' || subject === 'english' ? `/library?subject=${subject}` : '/library'
}

// 장바구니·상품 상세 공통 구매 완료 표시부. 요청·상태는 각 소비처가 소유한다.
export function MarketPurchaseCompleteDialog({ result, libraryHref, onClose }: MarketPurchaseCompleteDialogProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <StudioDialogPanel
        showCloseButton={false}
        className="sm:max-w-md"
        // 확정 버튼을 누른 Enter가 곧바로 보관함 링크를 열지 않도록 닫기 버튼에 먼저 포커스한다.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          closeButtonRef.current?.focus()
        }}
      >
        <StudioDialogHeader>
          <StudioDialogTitle>구매 완료</StudioDialogTitle>
          <StudioDialogDescription>
            {result?.alreadyCompleted
              ? '이미 처리된 구매입니다. 같은 요청이 중복으로 차감되지는 않았습니다.'
              : `${result?.orders.length ?? 0}건 구매가 완료되었습니다.`}
          </StudioDialogDescription>
        </StudioDialogHeader>

        {result ? (
          <div className="min-w-0 space-y-4">
            <ul className="max-h-60 divide-y divide-[var(--studio-border)] overflow-y-auto rounded-[var(--studio-radius-control)] border border-[var(--studio-border)]">
              {result.orders.map((order) => {
                const detail = [order.optionTitle, order.categoryName].filter(Boolean).join(' · ')
                return (
                  <li key={order.orderId} className="flex min-h-11 items-start justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="break-keep font-semibold text-[var(--studio-ink)]">{order.itemTitle}</p>
                      {detail ? <p className="break-keep text-xs text-[var(--studio-muted)]">{detail}</p> : null}
                    </div>
                    <p className="shrink-0 font-bold text-[var(--studio-ink)]">{formatCredits(order.chargedCredits)}</p>
                  </li>
                )
              })}
            </ul>

            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--studio-muted)]">사용 크레딧</dt>
                <dd className="font-bold text-[var(--studio-ink)]">{formatCredits(result.totalCredits)} 크레딧</dd>
              </div>
              {result.balance !== null ? (
                <div className="flex items-center justify-between gap-4 border-t border-dashed border-[var(--studio-border)] pt-2">
                  <dt className="font-semibold text-[var(--studio-ink)]">남은 크레딧</dt>
                  <dd className="font-bold text-[var(--studio-ink)]">{formatCredits(result.balance)} 크레딧</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}

        {/* 모바일에서도 시각 순서를 DOM·Tab 순서(닫기 → 보관함)와 맞춘다(공통 틀이 flex-col). */}
        <StudioDialogFooter>
          <Button ref={closeButtonRef} type="button" variant="brandOutline" onClick={onClose}>
            계속 둘러보기
          </Button>
          <Button asChild variant="brand">
            <Link href={libraryHref}>자료 보관함에서 받기</Link>
          </Button>
        </StudioDialogFooter>
      </StudioDialogPanel>
    </Dialog>
  )
}
