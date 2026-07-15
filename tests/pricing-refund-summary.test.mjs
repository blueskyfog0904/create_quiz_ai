import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const pricingPageSource = readFileSync(
  new URL('../src/app/pricing/page.tsx', import.meta.url),
  'utf8'
)

const pricingClientSource = readFileSync(
  new URL('../src/app/pricing/pricing-client.tsx', import.meta.url),
  'utf8'
)

test('pricing page refund summary highlights current credit refund rules', () => {
  assert.match(pricingPageSource, /7일/)
  assert.match(pricingPageSource, /1년/)
  assert.match(pricingPageSource, /사용/)
  assert.match(pricingPageSource, /취소|환불/)
  assert.match(pricingPageSource, /1개도 사용하지/)
  assert.match(pricingPageSource, /AI 생성/)
  assert.match(pricingPageSource, /다운로드|열람/)
  assert.match(pricingPageSource, /오류|장애/)
  assert.match(pricingPageSource, /원 결제수단/)
  assert.match(pricingPageSource, /회원 간/)
  assert.match(pricingPageSource, /양도|이전/)
  assert.doesNotMatch(pricingPageSource, /취소\/환불 요청도 같은 기간/)
  assert.doesNotMatch(pricingPageSource, /크레딧을 1개라도 사용한 경우 환불이 불가합니다/)
})

test('pricing cards do not advertise unlimited credit validity', () => {
  assert.match(pricingClientSource, /사용 기한 1년/)
  assert.doesNotMatch(pricingClientSource, /사용·환불 기한 1년/)
  assert.doesNotMatch(pricingClientSource, /유효기간 없음/)
})
