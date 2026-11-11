import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const checkoutClient = readFileSync('src/app/checkout/checkout-client.tsx', 'utf8')
const migration = readFileSync('supabase/migrations/20261111100000_payment_method_descriptions.sql', 'utf8')
const rollback = readFileSync('supabase/rollback/20261111100000_payment_method_descriptions_down.sql', 'utf8')

test('checkout uses the ink monotone palette without the brand purple tint', () => {
  // B-1 디자인: 강조색은 잉크 하나, 선택 상태는 색을 채우지 않고 테두리와 라디오로만 표시한다.
  assert.match(checkoutClient, /\[--ck-ink:#1C1917\]/)
  assert.match(checkoutClient, /has-\[:checked\]:border-\[var\(--ck-ink\)\]/)
  assert.doesNotMatch(checkoutClient, /studio-primary|primary-soft|variant="brand"/)
  assert.doesNotMatch(checkoutClient, /eyebrow=/)
})

test('payment method marks follow the public/payment-methods/{code}.svg convention', () => {
  assert.match(checkoutClient, /src=\{`\/payment-methods\/\$\{code\}\.svg`\}/)
  assert.match(checkoutClient, /onError=\{\(\) => setMissing\(true\)\}/)
  assert.match(checkoutClient, /<PaymentMethodMark code=\{method\.code\} \/>/)
  // 결제수단 코드별 파일이 있어야 한다(데이터는 DB, 이미지는 코드 이름 규칙).
  for (const code of ['card', 'phone', 'naverpay', 'tosspay']) {
    const file = `public/payment-methods/${code}.svg`
    assert.ok(existsSync(file), file)
    const svg = readFileSync(file, 'utf8')
    assert.doesNotMatch(svg, /<script|foreignObject|on\w+=/i, file)
    // 외부 주소를 부르지 않는다(토스페이는 공식 PNG를 data URI로 감싼다).
    for (const [, url] of svg.matchAll(/href="([^"]*)"/g)) {
      assert.match(url, /^data:image\/png;base64,/, file)
    }
  }
})

test('focus, unselected radio and sticky summary stay visible', () => {
  // 포커스 링은 불투명 잉크, 선택 안 된 라디오 원은 muted(대비 3:1 이상)로 그린다.
  assert.match(checkoutClient, /has-\[:focus-visible\]:ring-\[var\(--ck-ink\)\] has-\[:focus-visible\]:ring-offset-2/)
  assert.doesNotMatch(checkoutClient, /ring-\[var\(--ck-ink\)\]\/\d/)
  assert.match(checkoutClient, /border-\[1\.5px\] border-\[var\(--ck-muted\)\] group-has-\[:checked\]:border-\[var\(--ck-ink\)\]/)
  // overflow-x-hidden은 sticky를 깨뜨린다.
  assert.match(checkoutClient, /overflow-x-clip/)
  assert.doesNotMatch(checkoutClient, /overflow-x-hidden/)
  assert.match(checkoutClient, /lg:sticky lg:top-24/)
  // 좁은 화면에서 결제 버튼 문구가 넘치지 않게 줄바꿈을 허용한다.
  assert.match(checkoutClient, /whitespace-normal break-keep/)
})

test('method descriptions are data: migration fills only empty payapp rows and rollback clears only its own text', () => {
  assert.match(migration, /m\.provider = 'payapp'\s+AND m\.code = v\.code\s+AND m\.description IS NULL/)
  assert.match(migration, /IF v_count <> 3 THEN/)
  assert.doesNotMatch(migration, /'phone'/)
  assert.match(rollback, /AND m\.description = v\.description/)
  for (const text of ['국내 모든 신용·체크카드', '네이버페이 포인트·연결 카드로 결제', '토스 간편결제']) {
    assert.ok(migration.includes(text) && rollback.includes(text), text)
    assert.ok(!checkoutClient.includes(text), `${text} is not hardcoded in the client`)
  }
})
