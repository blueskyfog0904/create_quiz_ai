import { NextResponse } from 'next/server'
import { getMarketCartView, guardMarketCartRequest, marketCartErrorResponse } from '@/lib/market-cart-server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await guardMarketCartRequest()
  if ('response' in guard) {
    return guard.response
  }

  try {
    const view = await getMarketCartView(guard.userId)
    return NextResponse.json({ success: true, data: view }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[MarketCart] GET failed', error)
    return marketCartErrorResponse({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '장바구니를 불러오지 못했습니다.' })
  }
}
