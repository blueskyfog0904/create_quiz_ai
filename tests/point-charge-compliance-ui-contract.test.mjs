import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const pricingPage = read('../src/app/pricing/page.tsx')
const pricingClient = read('../src/app/pricing/pricing-client.tsx')
// 충전 화면 안내 문구의 처음 값(관리자 요금제 화면에서 고침)
const pricingContentSeed = read('../supabase/migrations/20261119100000_pricing_page_content.sql')
const checkout = read('../src/app/checkout/checkout-client.tsx')
// 9번: 결제 전 확인 문구는 DB 설정(point_charge_policy)이고, 처음 값은 이 마이그레이션이 넣는다.
const pointChargePolicySeed = read('../supabase/migrations/20261125100000_point_charge_policy.sql')
const creditsPage = read(
  '../src/app/(solvook)/mypage/credits/_components/credits-view.tsx'
)
const paymentsPage = read(
  '../src/app/(solvook)/mypage/payments/_components/payments-view.tsx'
)
const paymentList = read(
  '../src/app/legacy/mypage/payments/payment-list.tsx'
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
  assert.match(pricingContentSeed, /1회 최대 \{충전한도\}/)
  assert.match(pricingPage, /'\{충전한도\}': POINT_CHARGE_MAX_AMOUNT_TEXT/)
  assert.match(pricingContentSeed, /문제마켓/)
  for (const source of [pricingPage, pricingContentSeed]) {
    assert.doesNotMatch(source, /AI 문제 생성/)
    assert.doesNotMatch(source, /문제은행/)
  }
  assert.match(pricingPage, /\/terms\/refund/)
  assert.match(pricingPage, /min-h-11/)
  assert.match(pricingClient, /충전하기/)
  assert.match(pricingContentSeed, /문제마켓 이용/)
  assert.doesNotMatch(pricingClient, /AI 문제 생성 이용/)
  assert.doesNotMatch(pricingClient, /문제은행 이용/)
  assert.match(pricingClient, /min-h-11/)
})

test('checkout shows the restrictions before payment', () => {
  // 제한 사항은 DB 결제 전 확인 문구로 보여 주고(코드에 적지 않음), 처음 값에 한 번 결제·1년·양도 불가가 있다.
  assert.match(checkout, /POINT_CHARGE_CHECKOUT_ITEM_KEYS\.map/)
  assert.match(checkout, /notice\.checkoutItems\[key\]/)
  assert.doesNotMatch(checkout, /자동결제 없음|POINT_CHARGE_VALIDITY_YEARS/)
  assert.match(pointChargePolicySeed, /자동결제 없이 한 번만 결제되는 충전 상품/)
  assert.match(pointChargePolicySeed, /결제한 때부터 1년 동안 쓸 수 있고/)
  assert.match(pointChargePolicySeed, /다른 회원에게 넘길 수 없습니다/)
  assert.match(checkout, /method\.description/)
  assert.match(checkout, /문제마켓/)
  assert.doesNotMatch(checkout, /AI 문제 생성·문제은행/)
  assert.match(checkout, /\/terms\/refund/)
})

test('terms include the requested sentence and operational paths', () => {
  // 9번: '1년 이내로 제한' 문장은 실제 규칙(결제한 때부터 1년 이용·결제일 다음 날부터 환불 기간)으로 바뀌었다.
  assert.doesNotMatch(footerContent, /환불가능기간은 결제시점으로부터 1년 이내로 제한됩니다/)
  assert.match(footerContent, /충전한 크레딧은 결제한 때부터 1년 동안 쓸 수 있고/)
  assert.match(footerContent, /1회[^\n]*100,000원/)
  assert.match(footerContent, /충전 경로/)
  assert.match(footerContent, /사용 경로/)
  assert.match(footerContent, /문제마켓/)
  assert.match(policyMigration, /site_footer_content/)
  assert.match(policyMigration, /jsonb_set/)
  // 9번: 약관 화면은 DB 약관 본문만 보여 준다(코드에 박은 대체 섹션 없음).
  assert.doesNotMatch(termsPage, /REQUIRED_POINT_CHARGE_POLICY_SENTENCE|포인트 충전 핵심 안내|point-charge-policy/)
  assert.match(termsPage, /<PolicyDocumentContent content=\{document\.content\}/)
})

test('mypage exposes server refund cutoff and navigable paths', () => {
  assert.match(creditsPage, /refundableUntil/)
  assert.match(creditsPage, /환불 신청 마감/)
  assert.match(creditsPage, /\/mypage\/payments/)
  assert.match(creditsPage, /\/terms\/refund/)
  assert.match(creditsPage, /문제마켓 자료 구매/)
  assert.doesNotMatch(creditsPage, /AI 문제 생성, 문제은행/)
  assert.match(paymentsPage, /order_id/)
  assert.match(paymentsPage, /provider_status/)
  assert.match(paymentsPage, /getPaymentMethodLabel\(payment\)/)
  assert.match(paymentsPage, /부분 환불/)
  assert.match(paymentList, /주문번호/)
  assert.match(paymentList, /getProviderStatusLabel\(payment\.provider_status\)/)
  assert.match(paymentList, /getPaymentMethodLabel\(payment\)/)
  assert.match(paymentList, /부분 환불/)
})

test('admin refund view exposes provider completion and retry evidence', () => {
  assert.match(adminRefunds, /provider_cancel_transaction_key/)
  assert.match(adminRefunds, /last_error_message/)
  assert.match(adminRefunds, /취소 거래키/)
  assert.doesNotMatch(adminRefunds, /Toss/)
})
