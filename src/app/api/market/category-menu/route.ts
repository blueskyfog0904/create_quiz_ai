import { NextResponse } from 'next/server'
import { listMarketCategoryMenu } from '@/lib/market-categories-server'

export const dynamic = 'force-dynamic'

// 항목 옆 상품 수는 카테고리 페이지 왼쪽 목록과 같은 계산을 쓴다.
// 상품 수 계산이 실패해도 메뉴는 보이도록 수 없이 한 번 더 읽는다(이때 메가메뉴는 (N)을 표시하지 않는다).
async function loadCategoryMenu() {
  try {
    return await listMarketCategoryMenu(true)
  } catch (error) {
    console.error('카테고리 메뉴 상품 수를 불러오지 못했습니다.', error)
    return listMarketCategoryMenu()
  }
}

// 공개 메가메뉴 트리 — 인증 가드 없음 (비로그인 헤더에서도 사용)
export async function GET() {
  try {
    const data = await loadCategoryMenu()
    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } }
    )
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : '카테고리 메뉴를 불러오지 못했습니다.' },
      { status: 500 }
    )
  }
}
