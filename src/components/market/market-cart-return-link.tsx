'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

// 충전 결과 화면의 장바구니 복귀 CTA. 장바구니를 쓸 수 없으면(비로그인 401) 숨긴다.
export function MarketCartReturnLink({ className }: { className?: string }) {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/market/cart', { cache: 'no-store' })
      .then((response) => {
        if (active) setAvailable(response.ok)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  if (!available) {
    return null
  }

  return (
    <Button asChild variant="brandOutline" className={className}>
      <Link href="/cart">장바구니로 돌아가기</Link>
    </Button>
  )
}
