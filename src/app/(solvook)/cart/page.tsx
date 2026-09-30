import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import { getMarketCartView } from '@/lib/market-cart-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { CartView } from './_components/cart-view'

export const metadata: Metadata = {
  title: '장바구니 | 써머썬 연구소',
  description: '담아 둔 문제마켓 자료를 확인하고 크레딧으로 한 번에 구매하는 장바구니',
}

export default async function CartPage() {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(buildAuthRedirectPath('/cart'))
  }

  const view = await getMarketCartView(userId)

  return <CartView initialView={view} />
}
