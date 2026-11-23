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

// 충전 화면 문구는 관리자 요금제 화면에서 고치는 설정 행이고, 처음 값은 이 마이그레이션이 넣는다(2026-11-19).
const pricingContentSeed = readFileSync(
  new URL('../supabase/migrations/20261119100000_pricing_page_content.sql', import.meta.url),
  'utf8'
)

test('pricing page refund summary highlights current credit refund rules', () => {
  // {환불기간} 은 DB 충전 정책(point_charge_policy.refundDays) 값이고, 읽지 못하면 그 자리표시가 든 줄을 그리지 않는다.
  assert.match(pricingPageSource, /const pointChargePolicy = await getPointChargePolicyCached\(\)/)
  assert.match(pricingPageSource, /'\{환불기간\}': refundDaysText \?\? '\{환불기간\}'/)
  assert.match(pricingPageSource, /const shows = \(text: string\) => refundDaysText !== null \|\| !text\.includes\('\{환불기간\}'\)/)
  assert.match(pricingPageSource, /content\.refund_items\.filter\(shows\)/)
  assert.doesNotMatch(pricingPageSource, /POINT_CHARGE_REFUND_DAYS/)
  assert.match(pricingPageSource, /'\{사용기한\}': String\(POINT_CHARGE_VALIDITY_YEARS\)/)
  assert.match(pricingContentSeed, /\{환불기간\}일/)
  assert.match(pricingContentSeed, /\{사용기한\}년/)
  assert.match(pricingContentSeed, /사용/)
  assert.match(pricingContentSeed, /취소|환불/)
  assert.match(pricingContentSeed, /1개도 사용하지/)
  assert.match(pricingContentSeed, /AI 생성/)
  assert.match(pricingContentSeed, /다운로드|열람/)
  assert.match(pricingContentSeed, /오류|장애/)
  assert.match(pricingContentSeed, /원 결제수단/)
  assert.match(pricingContentSeed, /회원 간/)
  assert.match(pricingContentSeed, /양도|이전/)
  assert.doesNotMatch(pricingContentSeed, /취소\/환불 요청도 같은 기간/)
  assert.doesNotMatch(pricingContentSeed, /크레딧을 1개라도 사용한 경우 환불이 불가합니다/)
})

test('pricing cards do not advertise unlimited credit validity', () => {
  assert.match(pricingContentSeed, /사용 기한 \{사용기한\}년/)
  for (const source of [pricingClientSource, pricingContentSeed]) {
    assert.doesNotMatch(source, /사용·환불 기한/)
    assert.doesNotMatch(source, /유효기간 없음/)
  }
})
