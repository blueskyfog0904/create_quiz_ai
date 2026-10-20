import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

const ordersRoute = read('../src/app/api/payments/payapp/orders/route.ts')
const webhookRoute = read('../src/app/api/payments/webhooks/payapp/route.ts')
const returnRoute = read('../src/app/api/payments/payapp/return/route.ts')
const statusRoute = read('../src/app/api/payments/payapp/status/route.ts')
const resultPage = read('../src/app/checkout/payapp/result/page.tsx')
const resultClient = read('../src/app/checkout/payapp/result/result-client.tsx')

const indexOf = (source, pattern) => {
  const index = source.search(pattern)
  assert.notEqual(index, -1, String(pattern))
  return index
}

test('order route gates new requests and reads payment methods from the database', () => {
  assert.match(ordersRoute, /assertPayAppReady\(\)/)
  assert.match(ordersRoute, /from\('payment_methods'\)/)
  assert.match(ordersRoute, /\.eq\('provider', 'payapp'\)/)
  assert.match(ordersRoute, /method\.provider_open_pay_type/)
  assert.doesNotMatch(ordersRoute, /'(card|naverpay|tosspay|kakaopay)'/)
  assert.match(ordersRoute, /payapp_accepts_new_orders/)
  assert.match(ordersRoute, /runtimeConfig\.payapp_merchant_id !== payappConfig\.userId/)
  assert.match(ordersRoute, /p_provider_environment: 'live'/)
  assert.match(ordersRoute, /p_payment_method_code: method\.code/)
})

test('order fingerprint covers the payment method and phone number', () => {
  const fingerprint = ordersRoute.slice(
    indexOf(ordersRoute, /const requestFingerprint/),
    indexOf(ordersRoute, /\.digest\('hex'\)/)
  )
  assert.match(fingerprint, /paymentMethod: method\.code/)
  assert.match(fingerprint, /phone,/)
  assert.match(fingerprint, /provider: 'payapp'/)
})

test('payrequest is sent only after a claim and the payurl only after it is stored', () => {
  const begin = indexOf(ordersRoute, /'begin_payapp_request'/)
  const claimed = indexOf(ordersRoute, /requestClaimed = true/)
  const request = indexOf(ordersRoute, /await requestPayAppPayment\(/)
  const store = indexOf(ordersRoute, /'store_payapp_request'/)
  const ready = indexOf(ordersRoute, /return readyResponse\(preparedOrder, payment\.payUrl\)/)

  assert.ok(begin < claimed && claimed < request && request < store && store < ready)
  assert.match(ordersRoute, /if \(!claim\?\.claimed\)/)
  assert.match(ordersRoute, /storeError \|\| !stored\?\.stored/)
})

test('only a definite state=0 rejection closes the order as failed', () => {
  const failCall = ordersRoute.slice(indexOf(ordersRoute, /catch \(error\)/))
  assert.match(failCall, /error\.code === 'PAYAPP_REQUEST_REJECTED'/)
  assert.match(failCall, /'fail_payapp_request'/)
  assert.equal((ordersRoute.match(/fail_payapp_request/g) ?? []).length, 1)
  // 선점 뒤의 다른 실패는 요청이 생겼는지 알 수 없으므로 UNKNOWN이다.
  const rejected = indexOf(failCall, /PAYAPP_REQUEST_REJECTED/)
  const claimed = indexOf(failCall, /if \(requestClaimed\) \{\s*return attemptUnknownResponse\(\)/)
  assert.ok(rejected < claimed)
})

test('repeated attempts never resend payrequest and follow the shared classification', () => {
  assert.match(ordersRoute, /const orderId = createPublicOrderId\(\)/)
  assert.match(ordersRoute, /preparedOrder\.order_id !== orderId \|\| preparedOrder\.status !== 'preparing'/)
  assert.match(ordersRoute, /classifyExistingPayAppOrder\(order\.status, order\.ready_expires_at, Date\.now\(\)\)/)
  assert.match(ordersRoute, /status: 'result'/)
  // begin이 다른 요청의 ready를 알려 주면 그 상태로 저장된 결제창을 판단한다.
  assert.match(ordersRoute, /storedReadyResponse\(admin, \{ \.\.\.preparedOrder, status: 'ready' \}\)/)
  assert.match(ordersRoute, /PAYMENT_ATTEMPT_UNKNOWN/)
  assert.match(ordersRoute, /PAYMENT_ATTEMPT_EXPIRED/)
})

test('prepare arguments stay type-checked except the unused partner user id', () => {
  assert.match(ordersRoute, /\} satisfies PrepareOrderArgs/)
  assert.match(ordersRoute, /p_partner_user_id: null as unknown as string/)
  assert.doesNotMatch(ordersRoute, /as unknown as PrepareOrderArgs/)
  assert.match(ordersRoute, /PAYMENT_ORDER_INPUT_INVALID[\s\S]*?PAYMENT_METHOD_UNAVAILABLE/)
})

test('a phone number is saved to the profile only when asked and only if empty', () => {
  assert.match(ordersRoute, /if \(parsed\.data\.savePhone\)/)
  assert.match(ordersRoute, /\.update\(\{ phone: formatProfilePhone\(phone\) \}\)[\s\S]*?\.eq\('id', user\.id\)[\s\S]*?\.is\('phone', null\)/)
})

test('webhook route answers plain text and delegates to the feedback handler', () => {
  assert.match(webhookRoute, /handlePayAppFeedback\(await request\.text\(\), createPaymentAdminClient\(\)\)/)
  assert.match(webhookRoute, /'Content-Type': 'text\/plain; charset=utf-8'/)
  assert.match(webhookRoute, /reply = \{ body: 'FAIL', status: 503 \}/)
  assert.doesNotMatch(webhookRoute, /\.redirect\(/)
  assert.doesNotMatch(webhookRoute, /console\./)
})

test('return route trusts nothing from PayApp and redirects with 303', () => {
  assert.match(returnRoute, /export const GET = redirectToResult/)
  assert.match(returnRoute, /export const POST = redirectToResult/)
  assert.match(returnRoute, /NextResponse\.redirect\(resultUrl, 303\)/)
  assert.doesNotMatch(returnRoute, /formData|request\.text|request\.json|createPaymentAdminClient/)
})

test('status route shows only the signed-in user\'s PayApp order', () => {
  assert.match(statusRoute, /supabase\.auth\.getUser\(\)/)
  assert.match(statusRoute, /\.eq\('user_id', user\.id\)/)
  assert.match(statusRoute, /\.eq\('provider', 'payapp'\)/)
  assert.match(statusRoute, /'Cache-Control': 'no-store'/)
  assert.match(statusRoute, /이미 결제하셨다면 확인 후 자동 반영됩니다/)
  assert.match(statusRoute, /publicPayAppStatus\(order\.status\)/)
  assert.match(statusRoute, /code: 'AUTH_REQUIRED'/)
  assert.doesNotMatch(statusRoute, /failure_message|provider_transaction_id|next_redirect/)
})

test('result page uses the Studio frame and polls for about a minute', () => {
  assert.match(resultPage, /studio-theme/)
  assert.match(resultPage, /StudioContainer/)
  assert.match(resultClient, /POLL_INTERVAL_MS = 2_000/)
  assert.match(resultClient, /MAX_POLL_ATTEMPTS = 30/)
  assert.match(resultClient, /\/api\/payments\/payapp\/status\?orderId=\$\{encodeURIComponent\(orderId\)\}/)
  assert.match(resultClient, /마이페이지 결제내역에서 확인할 수 있습니다/)
  assert.match(resultClient, /result\.code === 'AUTH_REQUIRED'/)
  assert.match(resultClient, /\/login\?next=/)
  assert.match(resultClient, /결제 결과를 확인할 수 없습니다/)
  assert.match(resultClient, /role="status"/)
  assert.doesNotMatch(resultClient, /#[0-9a-f]{3,8}/i)
})
