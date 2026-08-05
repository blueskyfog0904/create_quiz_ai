import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: '범용 크레딧 차감 API는 사용할 수 없습니다.',
      code: 'GENERIC_CREDIT_DEDUCTION_DISABLED',
    },
    { status: 410 }
  )
}
