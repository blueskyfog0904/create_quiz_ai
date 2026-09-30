'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShoppingCart } from 'lucide-react'

const MARKET_CART_UPDATED_EVENT = 'market-cart-updated'

// 담기·삭제·구매 응답의 행 수로 헤더 배지를 갱신한다.
export function dispatchMarketCartUpdated(count: number) {
  window.dispatchEvent(new CustomEvent(MARKET_CART_UPDATED_EVENT, { detail: { count } }))
}

interface MarketCartIndicatorProps {
  // 서버가 확인한 로그인 사용자 ID. 바뀌면 key로 배지 상태를 버린다(계정 전환 캐시 폐기).
  ownerId: string | null
  // null이면 숨긴다(비로그인).
  initialCount: number | null
  className: string
  label?: string
}

export function MarketCartIndicator({ ownerId, initialCount, className, label }: MarketCartIndicatorProps) {
  if (!ownerId || initialCount === null) {
    return null
  }

  return <MarketCartLink key={ownerId} initialCount={initialCount} className={className} label={label} />
}

function MarketCartLink({ initialCount, className, label }: {
  initialCount: number
  className: string
  label?: string
}) {
  const [count, setCount] = useState(initialCount)
  const [syncedInitialCount, setSyncedInitialCount] = useState(initialCount)

  // 서버 재렌더(로그인·로그아웃·refresh)로 초기값이 바뀌면 그 값을 따른다.
  if (initialCount !== syncedInitialCount) {
    setSyncedInitialCount(initialCount)
    setCount(initialCount)
  }

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const nextCount = (event as CustomEvent<{ count?: unknown }>).detail?.count
      if (typeof nextCount === 'number') {
        setCount(nextCount)
      }
    }

    window.addEventListener(MARKET_CART_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(MARKET_CART_UPDATED_EVENT, handleUpdate)
  }, [])

  return (
    <Link href="/cart" aria-label={`장바구니 ${count}개`} className={className}>
      <span className="relative inline-flex">
        <ShoppingCart aria-hidden="true" className="h-5 w-5" />
        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--studio-primary)] px-1 text-[10px] font-bold leading-none text-white"
          >
            {count}
          </span>
        ) : null}
      </span>
      {label ? (
        <span className="whitespace-nowrap text-[11px] font-bold leading-none">{label}</span>
      ) : null}
    </Link>
  )
}
