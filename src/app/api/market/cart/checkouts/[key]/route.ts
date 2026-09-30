import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getMarketCheckoutReceipt, guardMarketCartRequest, marketCartErrorResponse } from '@/lib/market-cart-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ key: string }>
}

const notFound = () => marketCartErrorResponse({ status: 404, code: 'NOT_FOUND', message: '구매 영수증을 찾을 수 없습니다.' })

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const guard = await guardMarketCartRequest()
  if ('response' in guard) {
    return guard.response
  }

  const { key } = await params
  if (!z.string().uuid().safeParse(key).success) {
    return notFound()
  }

  try {
    const receipt = await getMarketCheckoutReceipt(guard.userId, key)
    if (!receipt) {
      return notFound()
    }
    return NextResponse.json({ success: true, data: receipt }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[MarketCart] receipt lookup failed', error)
    return marketCartErrorResponse({ status: 500, code: 'INTERNAL_SERVER_ERROR', message: '구매 영수증을 불러오지 못했습니다.' })
  }
}
