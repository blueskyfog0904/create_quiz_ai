import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { buildAuthRedirectPath } from '@/lib/auth-paths'
import { getMarketCartView } from '@/lib/market-cart-server'
import { getRequestAuthUserId } from '@/lib/request-auth'
import { UpcomingPolicyNotice } from '@/components/legal/upcoming-policy-notice'
import { CheckoutConsentPreviewBand } from '@/components/checkout/checkout-consent-preview-band'
import { CartView } from './_components/cart-view'

export const metadata: Metadata = {
  title: '장바구니',
  description: '담아 둔 문제마켓 자료를 확인하고 크레딧으로 한 번에 구매하는 장바구니',
}

export default async function CartPage() {
  await connection()

  const userId = await getRequestAuthUserId()
  if (!userId) {
    redirect(buildAuthRedirectPath('/cart'))
  }

  const view = await getMarketCartView(userId)

  // 11번 10-1: 개발 스위치가 켜졌을 때만 띠(보통 흐름 — 스크롤하면 사라짐). 첫 값과 다시 읽기가 같은 읽기 함수를 쓴다.
  return (
    <>
      <CheckoutConsentPreviewBand preview={view.consentPreview} />
      <CartView initialView={view} upcomingNotice={<UpcomingPolicyNotice />} />
    </>
  )
}
