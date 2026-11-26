import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { load, createFakeAdmin } from './helpers/market-images-harness.mjs'

// 11번 묶음 8절·11-1: 결제 내역 상세(계약내용 교부)에서 2판 기록을 consent_details.consent 로 그린다.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const view = read('src/app/(solvook)/mypage/payments/_components/payments-view.tsx')

const policyLib = load('src/lib/point-charge-policy.ts', { '@/lib/payment-constants': { MAX_POINT_CHARGE_AMOUNT: 100000 } })
const consentLib = load('src/lib/checkout-consent.ts', { '@/lib/point-charge-policy': policyLib })

const USER = '00000000-0000-4000-8000-000000000001'
const CONSENT = {
  consentFormat: 2,
  consentTitle: '주문 내용·충전 조건 확인 및 결제 동의',
  consentSummary: ['7일째 되는 날까지 신청할 수 있어요.'],
  consentItems: [
    { key: 'product', label: '충전 상품 안내', view: 'text', texts: ['상품 A', '기간 B'] },
    { key: 'refundPolicy', label: '취소·환불정책', view: 'link', link: 'refundPolicy' },
  ],
  refundDays: 7,
}

function loadDetails(acks) {
  const tables = {
    payment_history: [{ id: 'h1', payment_order_id: 'o1', source_id: null, approved_at: '2026-12-01T00:00:00Z' },
      { id: 'h2', payment_order_id: 'o2', source_id: null, approved_at: '2026-12-01T00:00:00Z' }],
    payment_orders: [{ id: 'o1', checkout_attempt_id: 'a1', source_id: null, approved_at: null },
      { id: 'o2', checkout_attempt_id: 'a2', source_id: null, approved_at: null }],
    checkout_attempts: [{ id: 'a1', checkout_attempt_id: 's1' }, { id: 'a2', checkout_attempt_id: 's2' }],
    point_charge_checkout_acks: acks,
    credit_sources: [],
  }
  const fake = createFakeAdmin(({ table }) => ({ data: tables[table] ?? [], error: null }))
  return load('src/lib/mypage-payment-details-server.ts', {
    'server-only': {},
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => fake.client },
    '@/lib/point-charge-refunds-server': { getPointChargeRefundEligibility: async () => ({}), reportPointChargePolicyFallback: async () => {} },
    '@/lib/checkout-consent': consentLib,
    '@/lib/footer-content-server': { getSiteFooterContent: async () => ({}) },
    '@/lib/market-purchase-info': {
      buildMarketPurchaseInfo: () => ({ supplierRows: [], termsLink: { label: '약관', href: '/terms/service' }, refundPolicyLink: { label: '환불', href: '/terms/refund' } }),
    },
  })
}

test('2판 기록: consent_details.consent 로 제목·요약 줄·항목 이름·본문, link 항목은 지금 문서 링크', async () => {
  const server = loadDetails([
    { checkout_attempt_id: 's1', notice_text: '원문\n링크:refundPolicy', consent_format: 2, consent_details: { consent: CONSENT } },
    { checkout_attempt_id: 's2', notice_text: '1판 원문', consent_format: 1, consent_details: null },
  ])
  const details = await server.loadPaymentChargeDetails(USER, ['h1', 'h2'])
  assert.deepEqual(details.h1.consent, {
    title: CONSENT.consentTitle,
    summary: CONSENT.consentSummary,
    items: [
      { label: '충전 상품 안내', view: 'text', texts: ['상품 A', '기간 B'] },
      { label: '취소·환불정책', view: 'link', href: '/terms/refund' },
    ],
  })
  // 1판 기록은 지금처럼 원문(notice_text)
  assert.equal(details.h2.consent, null)
  assert.equal(details.h2.noticeText, '1판 원문')
})

test('2판 기록의 consent 모양이 깨졌으면 그리지 않는다(원문으로 떨어짐)', async () => {
  const server = loadDetails([{ checkout_attempt_id: 's1', notice_text: '원문', consent_format: 2, consent_details: { consent: { consentFormat: 2 } } }])
  const details = await server.loadPaymentChargeDetails(USER, ['h1'])
  assert.equal(details.h1.consent, null)
  assert.equal(details.h1.noticeText, '원문')
})

test('결제 내역 화면: 2판은 consent 로 그리고 "링크:" 줄을 보이지 않으며 링크 옆에 판 안내', () => {
  assert.match(view, /\{detail\.consent \? \(/)
  assert.match(view, /detail\.consent\.summary\.map/)
  assert.match(view, /item\.texts\.map/)
  assert.match(view, /<Link href=\{item\.href\} className=\{refundPolicyLinkClassName\}>\{item\.label\}<\/Link>/)
  assert.match(view, /\(결제 당시 판과 다를 수 있어요\)/)
  assert.doesNotMatch(view, /링크:/)
  assert.match(view, /\) : detail\.noticeText \? \(/)
})
