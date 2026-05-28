import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json({
    success: false,
    error: {
      code: 'BATCH_PURCHASE_DEPRECATED',
      message: '문제마켓 리스트 직접 결제는 종료되었습니다. 상세페이지에서 구매해주세요.',
    },
  }, { status: 410 })
}
