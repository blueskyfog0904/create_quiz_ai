import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// 11번(계획 docs/plan-bundle11-checkout-simplify.md 7절): 자료 구매는 장바구니로만 한다.
// 상품 상세 바로 구매는 닫고 410 만 돌려준다(옛 탭은 error.message 를 읽는다). 돈·동의 기록 RPC 를 부르지 않는다.
// 파일은 2판이 자리 잡은 뒤 정리 묶음에서 지운다(14절).
export async function POST() {
  return NextResponse.json({
    success: false,
    error: {
      code: 'MARKET_DIRECT_PURCHASE_CLOSED',
      message: '상품 상세 바로 구매는 종료되었습니다. 장바구니에 담아 구매해 주세요. 이미 결제가 끝났다면 자료 보관함에서 확인할 수 있어요.',
    },
  }, { status: 410 })
}
