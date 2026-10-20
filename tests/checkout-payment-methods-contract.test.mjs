import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const checkoutPage = readFileSync('src/app/checkout/page.tsx', 'utf8')
const checkoutClient = readFileSync('src/app/checkout/checkout-client.tsx', 'utf8')
const successPage = readFileSync('src/app/checkout/success/page.tsx', 'utf8')
const failPage = readFileSync('src/app/checkout/fail/page.tsx', 'utf8')

test('checkout server lists only enabled methods of runtime-enabled providers from the database', () => {
  assert.match(checkoutPage, /payment_runtime_config/)
  assert.match(checkoutPage, /assertPayAppReady/)
  assert.match(checkoutPage, /assertKakaoPayReady/)
  assert.match(checkoutPage, /runtime\.payapp_accepts_new_orders/)
  assert.match(checkoutPage, /runtime\.payapp_merchant_id === payapp\.userId/)
  assert.match(checkoutPage, /\.from\('payment_methods'\)[\s\S]*?\.eq\('is_enabled', true\)[\s\S]*?\.order\('sort_order'\)/)
  assert.match(checkoutPage, /availableProviders\.has\(method\.provider\)/)
  assert.doesNotMatch(checkoutPage, /assertTossPaymentsReady|toss_accepts_new_orders/)
})

test('checkout owns one attempt per method and phone and creates orders only from the CTA', () => {
  assert.match(checkoutClient, /function getCheckoutAttemptId/)
  assert.match(checkoutClient, /point-checkout-attempt:\$\{userId\}:\$\{planId\}`/)
  assert.match(checkoutClient, /stored\.method === methodCode && stored\.phone === phone/)
  assert.match(checkoutClient, /const beginPayment = async/)
  assert.match(checkoutClient, /inFlightRef\.current = true/)
  assert.match(checkoutClient, /\/api\/payments\/payapp\/orders/)
  assert.match(checkoutClient, /\/api\/payments\/kakaopay\/orders/)
  assert.doesNotMatch(checkoutClient, /\/api\/payments\/orders/)
  assert.match(checkoutClient, /paymentMethodCode: selectedMethod\.code/)
})

test('checkout shows one accessible method list with a method-and-amount button', () => {
  assert.match(checkoutClient, /StudioContainer/)
  assert.match(checkoutClient, /StudioPageHeader/)
  assert.match(checkoutClient, /<fieldset/)
  assert.match(checkoutClient, /<legend className="sr-only">결제수단 선택<\/legend>/)
  assert.match(checkoutClient, /type="radio"/)
  assert.match(checkoutClient, /method\.description/)
  assert.match(checkoutClient, /withDirectionParticle\(selectedMethod\.label\)\} \$\{amount\.toLocaleString\(\)\}원 결제하기/)
  assert.match(checkoutClient, /min-h-11/)
  assert.match(checkoutClient, /aria-live="polite"/)
  assert.match(checkoutClient, /motion-reduce:animate-none/)
  assert.doesNotMatch(checkoutClient, /TabsList|TossPayments|일반결제/)
  assert.doesNotMatch(checkoutClient, /max-w-6xl|lg:w-\[380px\]|bg-gray-50/)
})

test('checkout asks for a phone only for PayApp methods and requires agreement', () => {
  assert.match(checkoutClient, /const needsPhone = selectedMethod\?\.provider === 'payapp'/)
  assert.match(checkoutClient, /maskPhone\(phone\)/)
  assert.match(checkoutClient, /다음에도 이 번호 사용/)
  assert.match(checkoutClient, /취소·환불정책[\s\S]*?을 확인했으며 결제에 동의합니다 \(필수\)/)
  assert.match(checkoutClient, /disabled=\{isBusy \|\| !selectedMethod \|\| !agreed \|\| \(needsPhone && !phoneValid\)\}/)
  // 마지막에 쓴 수단은 브라우저 저장소에서 읽고, 실패하면 무시한다.
  assert.match(checkoutClient, /window\.localStorage\.getItem\(getLastMethodStorageKey\(user\.id\)\)/)
})

test('Toss result pages use the same Studio frame and semantic tokens', () => {
  for (const source of [successPage, failPage]) {
    assert.match(source, /studio-theme/)
    assert.match(source, /StudioContainer/)
    assert.match(source, /var\(--studio-/)
    assert.doesNotMatch(source, /max-w-md|bg-gray-50|text-(?:blue|green|red|gray)-/)
  }
})

test('checkout recovers from back navigation and starts a new attempt after showing a result', () => {
  assert.match(checkoutClient, /window\.addEventListener\('pageshow', handlePageShow\)/)
  assert.match(checkoutClient, /if \(!event\.persisted\) return/)
  assert.match(checkoutClient, /body\.status === 'result' && body\.resultUrl\) \{\s*clearCheckoutAttempt\(user\.id, plan\.id\)/)
  assert.match(checkoutClient, /role="alert"/)
  assert.match(checkoutPage, /method\.provider !== 'payapp' \|\| Boolean\(method\.provider_open_pay_type\)/)
})

test('KakaoPay tells the checkout to start a new attempt for a closed one', () => {
  const kakaoOrders = readFileSync('src/app/api/payments/kakaopay/orders/route.ts', 'utf8')
  assert.match(kakaoOrders, /error: '현재 다시 사용할 수 없는 결제 시도입니다\.', code: 'PAYMENT_ATTEMPT_EXPIRED'/)
  // 결제됐을 수 있는 주문은 새 시도 대신 결제내역으로 보낸다.
  assert.match(kakaoOrders, /preparedOrder\.status !== 'preparing' && !\['failed', 'expired'\]\.includes\(preparedOrder\.status\)/)
  assert.match(kakaoOrders, /resultUrl: '\/mypage\/payments'/)
})
