import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const ORDER_ID_PATTERN = /^PAYAPP_[0-9A-Z_]{1,80}$/

// 페이앱 결제 후 브라우저가 GET 또는 POST로 돌아온다. 받은 값은 믿지 않고 결과 화면으로만 보낸다.
function redirectToResult(request: Request) {
  const orderId = new URL(request.url).searchParams.get('orderId') ?? ''
  const resultUrl = new URL('/checkout/payapp/result', request.url)

  if (ORDER_ID_PATTERN.test(orderId)) {
    resultUrl.searchParams.set('orderId', orderId)
  }

  return NextResponse.redirect(resultUrl, 303)
}

export const GET = redirectToResult
export const POST = redirectToResult
