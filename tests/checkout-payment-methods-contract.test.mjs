import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const checkoutPage = readFileSync('src/app/checkout/page.tsx', 'utf8')
const checkoutClient = readFileSync('src/app/checkout/checkout-client.tsx', 'utf8')

test('checkout server lists only enabled methods of runtime-enabled providers from the database', () => {
  assert.match(checkoutPage, /payment_runtime_config/)
  assert.match(checkoutPage, /assertPayAppReady/)
  // 카카오페이는 종료했다(9번): 결제 화면 서버가 카카오페이 결제수단을 내리지 않는다.
  assert.doesNotMatch(checkoutPage, /assertKakaoPayReady|kakaopay_accepts_new_orders|'kakaopay'/)
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
  assert.doesNotMatch(checkoutClient, /\/api\/payments\/kakaopay\/orders|kakaopay/)
  assert.doesNotMatch(checkoutClient, /\/api\/payments\/orders/)
  assert.match(checkoutClient, /paymentMethodCode: selectedMethod\.code/)
})

test('checkout starts a new attempt when the price changes or payapp rejected the request', () => {
  // 서버 요청 지문에 들어가는 금액·크레딧도 비교해야 가격 변경 뒤 PAYLOAD_CONFLICT에 걸리지 않는다.
  assert.match(checkoutClient, /stored\.amount === amount && stored\.credits === credits &&\s*stored\.noticeSha256 === noticeSha256/)
  assert.match(checkoutClient, /JSON\.stringify\(\{ id: checkoutAttemptId, method: methodCode, phone, amount, credits, noticeSha256 \}\)/)
  // 9번: 결제 전 확인 문구(지문)가 바뀌면 새 시도로 다시 동의받는다.
  assert.match(checkoutClient, /needsPhone \? phone : '',\s*plan\.price,\s*plan\.credits,\s*notice\.noticeSha256\s*\)/)
  // 페이앱이 확실히 거절한 주문은 결제될 수 없으므로 시도를 지우고 나서 오류를 보여 준다.
  const notOk = checkoutClient.slice(checkoutClient.indexOf('if (!response.ok) {'))
  assert.match(
    notOk,
    /^if \(!response\.ok\) \{[\s\S]*?if \(body\.code === 'PAYAPP_REQUEST_REJECTED'\) \{\s*clearCheckoutAttempt\(user\.id, plan\.id\)\s*\}\s*failWith\(/
  )
  // 만료 응답은 결제창이 아직 열려 있을 수 있어 자동으로 새 시도를 만들지 않는다(버튼으로만).
  assert.doesNotMatch(checkoutClient, /PAYMENT_ATTEMPT_EXPIRED'\)\s*\{\s*clearCheckoutAttempt/)
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
  // 동의 문구는 DB(agreeLabel). 정책 이름은 코드가 전문 링크로 감싸고 '(필수)'는 코드 한 곳에서만 붙인다.
  assert.match(checkoutClient, /<AgreeLabel label=\{notice\.agreeLabel\} \/>/)
  assert.match(checkoutClient, /const REFUND_POLICY_NAME = '취소·환불정책'/)
  assert.equal(checkoutClient.split('(필수)').length - 1, 1)
  assert.doesNotMatch(checkoutClient, /을 확인했으며 결제에 동의합니다/)
  // 문구를 읽지 못하면(notice 없음) 결제 버튼을 막는다.
  assert.match(checkoutClient, /disabled=\{isBusy \|\| !selectedMethod \|\| !notice \|\| !agreed \|\| \(needsPhone && !phoneValid\)\}/)
  // 마지막에 쓴 수단은 브라우저 저장소에서 읽고, 실패하면 무시한다.
  assert.match(checkoutClient, /window\.localStorage\.getItem\(getLastMethodStorageKey\(user\.id\)\)/)
})

test('checkout recovers from back navigation and starts a new attempt after showing a result', () => {
  assert.match(checkoutClient, /window\.addEventListener\('pageshow', handlePageShow\)/)
  assert.match(checkoutClient, /if \(!event\.persisted\) return/)
  assert.match(checkoutClient, /body\.status === 'result' && body\.resultUrl\) \{\s*clearCheckoutAttempt\(user\.id, plan\.id\)/)
  assert.match(checkoutClient, /role="alert"/)
  assert.match(checkoutPage, /method\.provider !== 'payapp' \|\| Boolean\(method\.provider_open_pay_type\)/)
})

test('KakaoPay order route is retired and never prepares an order', () => {
  const kakaoOrders = readFileSync('src/app/api/payments/kakaopay/orders/route.ts', 'utf8')
  assert.match(kakaoOrders, /code: 'PAYMENT_PROVIDER_RETIRED'/)
  assert.match(kakaoOrders, /\{ status: 503 \}/)
  assert.doesNotMatch(kakaoOrders, /prepare_payment_order|readyKakaoPayPayment|begin_kakaopay_ready/)
})

test('checkout shows the DB notice right above the agreement and re-asks after a 409 change', () => {
  // 서버가 캐시 없이 읽은 결제 전 확인(채운 문구·지문)을 내려 준다.
  assert.match(checkoutPage, /getPointChargeCheckoutNotice\(user\.id\)/)
  assert.match(checkoutPage, /checkoutNotice=\{checkoutNotice\}/)
  // 모든 폭에서 동의 체크 바로 위(주문 요약 상자 안)에 두고, 예전 하드코딩 목록·order-last 배치는 없다.
  assert.match(checkoutClient, /<CheckoutNoticeSection notice=\{notice\} \/>\s*\{notice \? \(\s*<label/)
  assert.match(checkoutClient, /POINT_CHARGE_CHECKOUT_ITEM_KEYS\.map/)
  assert.match(checkoutClient, /notice\.minorNotice/)
  assert.doesNotMatch(checkoutClient, /order-last|자동결제 없음|\d+일 이내/)
  // 요청에 동의·지문·화면이 본 금액과 크레딧을 싣는다.
  assert.match(checkoutClient, /acknowledgeCheckoutNotice: agreed,\s*noticeSha256: notice\.noticeSha256,\s*expectedAmount: plan\.price,\s*expectedCredits: plan\.credits/)
  // 409 CHECKOUT_NOTICE_CHANGED·CHECKOUT_PLAN_CHANGED: 시도를 지우고 새 문구·값으로 바꾼 뒤 체크를 푼다.
  assert.match(checkoutClient, /const CHECKOUT_CHANGED_CODES = \['CHECKOUT_NOTICE_CHANGED', 'CHECKOUT_PLAN_CHANGED'\]/)
  const changed = checkoutClient.slice(checkoutClient.indexOf('CHECKOUT_CHANGED_CODES.includes(body.code)'))
  assert.match(changed, /^CHECKOUT_CHANGED_CODES\.includes\(body\.code\)\) \{\s*clearCheckoutAttempt\(user\.id, plan\.id\)[\s\S]*?setNotice\(nextNotice\)[\s\S]*?setPlan\([\s\S]*?setAgreed\(false\)/)
  assert.match(checkoutClient, /body\.amount !== plan\.price \|\| body\.credits !== plan\.credits/)
})

test('PayApp order route records the checkout notice ack in the planned order', () => {
  const route = readFileSync('src/app/api/payments/payapp/orders/route.ts', 'utf8')
  const at = (needle) => {
    const index = route.indexOf(needle)
    assert.ok(index >= 0, needle)
    return index
  }
  // 인증 → 약관 → 동의 체크(본문 검사보다 먼저 400) → 본문 검사 → 게이트 → 시도 조회 → 동의 기록 → 주문 준비
  assert.ok(at('auth.getUser()') < at('checkMemberConsentForApi(supabase, user)'))
  assert.ok(at('checkMemberConsentForApi(supabase, user)') < at(".acknowledgeCheckoutNotice !== true"))
  assert.ok(at(".acknowledgeCheckoutNotice !== true") < at('preparePayAppOrderSchema.safeParse(requestBody)'))
  assert.match(route, /code: 'CHECKOUT_NOTICE_REQUIRED',\s*\},\s*\{ status: 400 \}/)
  assert.ok(at('payapp_accepts_new_orders,') < at(".from('checkout_attempts')"))
  assert.ok(at(".from('checkout_attempts')") < at('recordPointChargeCheckoutAck({'))
  assert.ok(at('recordPointChargeCheckoutAck({') < at("'prepare_payment_order',"))
  // 시도 조회 오류는 503, 이미 주문이 있으면 동의 기록을 건너뛴다.
  assert.match(route, /if \(attemptError\) \{[\s\S]*?return checkoutNoticeUnavailableResponse\(\)/)
  assert.match(route, /if \(!attemptRow\?\.payment_order_id\) \{\s*const ack = await recordPointChargeCheckoutAck/)
  assert.match(route, /case 'notice_changed':\s*return checkoutChangedResponse\(\s*'CHECKOUT_NOTICE_CHANGED'/)
  assert.match(route, /case 'plan_changed':\s*return checkoutChangedResponse\(\s*'CHECKOUT_PLAN_CHANGED'/)
  assert.match(route, /default:\s*return checkoutNoticeUnavailableResponse\(\)/)
  assert.match(route, /code: 'CHECKOUT_NOTICE_UNAVAILABLE',\s*\},\s*\{ status: 503 \}/)
  // 결제창 재사용인데 이 시도의 동의 행이 없으면 재사용하지 않고 409, 조회 오류는 503.
  const reuse = route.slice(at("=== 'reuse_payurl') {"))
  assert.match(reuse, /\.from\('point_charge_checkout_acks'\)[\s\S]*?if \(ackError\) \{[\s\S]*?return checkoutNoticeUnavailableResponse\(\)[\s\S]*?if \(!ackRow\) \{\s*return checkoutChangedResponse\(\s*'CHECKOUT_NOTICE_CHANGED'[\s\S]*?이전에 연 결제창은 닫아 주세요/)
  // 409 응답에는 새 문구와 지금 상품 값을 싣는다.
  assert.match(route, /return NextResponse\.json\(\{ error, code, notice: freshNotice, plan \}, \{ status: 409 \}\)/)
})
