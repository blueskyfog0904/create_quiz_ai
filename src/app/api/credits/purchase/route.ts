import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: '테스트 크레딧 충전 기능은 종료되었습니다. 결제 화면에서 충전해 주세요.',
      code: 'TEST_CREDIT_PURCHASE_DISABLED',
    },
    { status: 410 }
  )
}
