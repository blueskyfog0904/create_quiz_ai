'use client'

import { CartLineListView } from '@/app/(solvook)/cart/_components/cart-line-list-view'
import type { MarketCartItem } from '@/lib/market-cart-server'

// 19번 9-2 V5: 장바구니 묶음 줄 이름 미리보기(꼬리표와 같으면 한 번, 다르면 둘, 빈 이름은 꼬리표만). 조작은 아무 일도 하지 않는다.
export function CartLinePreview({ items }: { items: MarketCartItem[] }) {
  const noop = () => undefined
  return (
    <CartLineListView
      items={items}
      selectableCount={items.length}
      selectedCount={items.length}
      allSelected
      locked={false}
      conflictLineIds={new Set()}
      previousCredits={{}}
      onToggle={noop}
      onToggleAll={noop}
      onRemove={noop}
      onRemoveSelected={noop}
    />
  )
}
