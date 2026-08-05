import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const pricingPage = read('../src/app/pricing/page.tsx')
const pricingClient = read('../src/app/pricing/pricing-client.tsx')
const checkout = read('../src/app/checkout/checkout-client.tsx')
const creditsPage = read(
  '../src/app/(dashboard)/mypage/credits/credits-client.tsx'
)
const paymentsPage = read(
  '../src/app/(dashboard)/mypage/payments/page.tsx'
)
const paymentList = read(
  '../src/app/(dashboard)/mypage/payments/payment-list.tsx'
)
const footerContent = read('../src/lib/footer-content.ts')
const adminRefunds = read(
  '../src/app/(admin)/admin/refunds/refunds-client.tsx'
)
const policyMigration = read(
  '../supabase/migrations/20260805140000_append_point_charge_compliance_policy.sql'
)
const termsPage = read('../src/app/terms/[documentSlug]/page.tsx')

test('pricing explains the one-time charge limit and real usage paths', () => {
  assert.match(pricingPage, /크레딧 충전 상품/)
  assert.match(pricingPage, /1회 최대 100,000원/)
  assert.match(pricingPage, /AI 문제 생성/)
  assert.match(pricingPage, /문제은행/)
  assert.match(pricingPage, /문제마켓/)
  assert.match(pricingPage, /\/terms\/refund/)
  assert.match(pricingPage, /min-h-11/)
  assert.match(pricingClient, /충전하기/)
  assert.match(pricingClient, /min-h-11/)
})

test('checkout shows the restrictions before payment', () => {
  assert.match(checkout, /자동결제 없음/)
  assert.match(checkout, /결제일로부터 1년/)
  assert.match(checkout, /양도/)
  assert.match(checkout, /카카오페이/)
  assert.match(checkout, /하나카드/)
  assert.match(checkout, /\/terms\/refund/)
})

test('terms include the requested sentence and operational paths', () => {
  assert.match(
    footerContent,
    /충전된 포인트의 이용기간과 환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다\./
  )
  assert.match(footerContent, /1회[^\n]*100,000원/)
  assert.match(footerContent, /충전 경로/)
  assert.match(footerContent, /사용 경로/)
  assert.match(footerContent, /문제마켓/)
  assert.match(policyMigration, /site_footer_content/)
  assert.match(policyMigration, /jsonb_set/)
  assert.match(termsPage, /REQUIRED_POINT_CHARGE_POLICY_SENTENCE/)
  assert.match(termsPage, /document\.content\.includes/)
  assert.match(termsPage, /포인트 충전 핵심 안내/)
})

test('mypage exposes server refund cutoff and navigable paths', () => {
  assert.match(creditsPage, /refundableUntil/)
  assert.match(creditsPage, /환불 신청 마감/)
  assert.match(creditsPage, /\/mypage\/payments/)
  assert.match(creditsPage, /\/terms\/refund/)
  assert.match(paymentsPage, /order_id/)
  assert.match(paymentsPage, /provider_status/)
  assert.match(paymentList, /주문번호/)
  assert.match(paymentList, /providerStatus/)
})

test('admin refund view exposes provider completion and retry evidence', () => {
  assert.match(adminRefunds, /provider_cancel_transaction_key/)
  assert.match(adminRefunds, /last_error_message/)
  assert.match(adminRefunds, /Toss 취소 거래키/)
})
