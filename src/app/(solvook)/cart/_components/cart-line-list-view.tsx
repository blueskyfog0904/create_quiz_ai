'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { MarketCartItem } from '@/lib/market-cart-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'
import { formatCartCredits } from '@/lib/cart-checkout-panel'
import { resolveCartLineOptionTitle } from '@/lib/cart-line-title'

// 11번 6-1 표시 부품: 장바구니 줄 목록. 선택 값은 껍데기가 든다(이 부품 안에 선택 상태 없음).

const SUBJECT_GROUPS: { subject: WorkspaceSubject | null; label: string }[] = [
  { subject: 'korean', label: '국어' },
  { subject: 'english', label: '영어' },
  { subject: null, label: '판매 종료' },
]

const ROW_CHECKBOX_LABEL_CLASS = 'grid size-11 shrink-0 cursor-pointer place-items-center rounded-md has-[:disabled]:cursor-not-allowed'

export function getCartItemTitle(item: MarketCartItem) {
  return item.itemTitle ?? '판매가 종료된 자료'
}

function getUnavailableReason(item: MarketCartItem) {
  if (item.reason === 'ALREADY_OWNED') {
    return '이미 보유한 자료입니다. 자료 보관함에서 받을 수 있어요.'
  }
  if (item.reason) {
    return '현재 판매하지 않는 자료라 구매할 수 없습니다.'
  }
  return null
}

export interface CartLineListViewProps {
  items: MarketCartItem[]
  selectableCount: number
  selectedCount: number
  allSelected: boolean
  // 결제 중·재시도 대기·선택 저장 중에는 목록 조작을 잠근다
  locked: boolean
  conflictLineIds: ReadonlySet<string>
  // PRICE_CHANGED 뒤 '이전 N → 지금 M'
  previousCredits: Readonly<Record<string, number>>
  onToggle: (ids: string[], isSelected: boolean) => void
  onToggleAll: () => void
  onRemove: (ids: string[]) => void
  onRemoveSelected: () => void
}

export function CartLineListView({
  items,
  selectableCount,
  selectedCount,
  allSelected,
  locked,
  conflictLineIds,
  previousCredits,
  onToggle,
  onToggleAll,
  onRemove,
  onRemoveSelected,
}: CartLineListViewProps) {
  const renderItem = (item: MarketCartItem) => {
    const title = getCartItemTitle(item)
    const unavailableReason = getUnavailableReason(item)
    const isUpgradePrice = item.chargedCredits !== null && item.originalCredits !== null && item.chargedCredits < item.originalCredits
    const conflicted = conflictLineIds.has(item.id)
    const previous = previousCredits[item.id]
    const lineTag = item.categoryName ?? (item.targetKind === 'bundle' ? '전체 패키지' : '개별 자료')
    // 19번: 묶음 줄 이름이 꼬리표와 같으면 한 번만 보인다(빈 이름은 지금처럼 숨김)
    const lineOptionTitle = resolveCartLineOptionTitle(item.targetKind, lineTag, item.optionTitle)

    return (
      <li key={item.id} data-conflict-line={conflicted ? 'true' : undefined} className="flex items-start gap-2 py-4 sm:gap-3">
        <label className={ROW_CHECKBOX_LABEL_CLASS}>
          <Checkbox
            checked={item.purchasable && item.isSelected}
            disabled={!item.purchasable || locked}
            onCheckedChange={(checked) => onToggle([item.id], checked === true)}
            aria-label={`${title} 선택`}
          />
        </label>
        <div className="min-w-0 flex-1 py-1">
          <p className="text-xs font-semibold text-[var(--studio-muted)]">
            {lineTag}
          </p>
          <p className="mt-1 break-keep font-bold leading-6 text-[var(--studio-ink)]">
            {item.detailHref ? (
              <Link
                href={item.detailHref}
                className="rounded-sm outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                {title}
              </Link>
            ) : title}
          </p>
          {lineOptionTitle ? (
            <p className="mt-0.5 break-keep text-sm text-[var(--studio-text)]">{lineOptionTitle}</p>
          ) : null}
          {unavailableReason ? (
            <p className="mt-2 text-xs font-medium text-destructive">{unavailableReason}</p>
          ) : null}
          {conflicted ? (
            <p className="mt-2 text-xs font-semibold text-destructive">함께 살 수 없는 자료예요. 둘 중 하나를 빼 주세요.</p>
          ) : null}
          {item.purchasable && item.partiallyOwned ? (
            <p className="mt-2 inline-block rounded-sm bg-[var(--studio-background)] px-1.5 py-0.5 text-xs font-semibold text-[var(--studio-text)]">정가 구매</p>
          ) : null}
          {item.purchasable && isUpgradePrice ? (
            <p className="mt-2 text-xs text-[var(--studio-muted)]">보유한 자료 가격을 뺀 차액으로 구매합니다.</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => onRemove([item.id])}
            disabled={locked}
            aria-label={`${title} 삭제`}
            className="grid size-11 place-items-center rounded-md text-[var(--studio-muted)] outline-none hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
          {item.chargedCredits !== null ? (
            <div className="text-right">
              {isUpgradePrice ? (
                <p className="text-xs text-[var(--studio-muted)] line-through">{formatCartCredits(item.originalCredits ?? 0)}</p>
              ) : null}
              {previous !== undefined ? (
                <p className="text-xs text-[var(--studio-muted)] tabular-nums">이전 {formatCartCredits(previous)} → 지금 {formatCartCredits(item.chargedCredits)}</p>
              ) : null}
              <p className="whitespace-nowrap font-bold tabular-nums text-[var(--studio-ink)]">{formatCartCredits(item.chargedCredits)} 크레딧</p>
            </div>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--studio-ink)] pb-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-1 text-sm font-semibold text-[var(--studio-ink)]">
          <span className="grid size-11 place-items-center">
            <Checkbox
              checked={allSelected}
              disabled={selectableCount === 0 || locked}
              onCheckedChange={() => onToggleAll()}
              aria-label="구매 가능한 자료 전체 선택"
            />
          </span>
          전체 선택 ({selectedCount}/{selectableCount})
        </label>
        <Button variant="brandGhost" disabled={selectedCount === 0 || locked} onClick={onRemoveSelected}>
          선택 삭제
        </Button>
      </div>

      {SUBJECT_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.workspaceSubject === group.subject)
        if (groupItems.length === 0) {
          return null
        }
        return (
          <section key={group.label} aria-label={`${group.label} 자료`} className="mt-4">
            <h2 className="text-sm font-extrabold text-[var(--studio-ink)]">
              {group.label} <span className="font-semibold text-[var(--studio-muted)]">{groupItems.length}</span>
            </h2>
            <ul className="divide-y divide-[var(--studio-border)] border-b border-[var(--studio-border)]">
              {groupItems.map(renderItem)}
            </ul>
          </section>
        )
      })}
    </>
  )
}
