import { NextResponse } from 'next/server'
import { listMarketCategoryMenu } from '@/lib/market-categories-server'

export const dynamic = 'force-dynamic'

// 공개 메가메뉴 트리 — 인증 가드 없음 (비로그인 헤더에서도 사용)
export async function GET() {
  try {
    const data = await listMarketCategoryMenu()
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'public, max-age=60' } }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '카테고리 메뉴를 불러오지 못했습니다.' },
      { status: 500 }
    )
  }
}
