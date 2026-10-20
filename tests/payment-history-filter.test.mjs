import assert from 'node:assert/strict'
import test from 'node:test'

import {
  filterRealPaidPlanPurchases,
  isRealPaidPlanPurchase,
  normalizePaymentHistoryRecord,
} from '../src/lib/payment-history.ts'

test('isRealPaidPlanPurchase keeps only rows that belong to a paid plan purchase', () => {
  assert.equal(isRealPaidPlanPurchase({
    id: 'paid',
    created_at: '2026-04-15T00:00:00.000Z',
    amount: 29900,
    status: 'completed',
    payment_method: 'toss',
    plan_id: 'plan-basic',
    pricing_plans: { name: 'Basic' },
  }), true)

  assert.equal(isRealPaidPlanPurchase({
    id: 'admin-grant',
    created_at: '2026-04-15T00:00:00.000Z',
    amount: 0,
    status: 'completed',
    payment_method: 'admin_grant',
    plan_id: null,
    pricing_plans: null,
  }), false)
})

test('normalizePaymentHistoryRecord flattens a Supabase relation array into a single plan object', () => {
  const normalized = normalizePaymentHistoryRecord({
    id: 'paid',
    created_at: '2026-04-15T00:00:00.000Z',
    amount: 29900,
    status: 'completed',
    payment_method: 'toss',
    plan_id: 'plan-basic',
    pricing_plans: [{ name: 'Basic' }],
  })

  assert.deepEqual(normalized.pricing_plans, { name: 'Basic' })
})

test('filterRealPaidPlanPurchases removes legacy zero-won grant rows from payment history', () => {
  const filtered = filterRealPaidPlanPurchases([
    {
      id: 'paid',
      created_at: '2026-04-15T00:00:00.000Z',
      amount: 29900,
      status: 'completed',
      payment_method: 'toss',
      plan_id: 'plan-basic',
      pricing_plans: { name: 'Basic' },
    },
    {
      id: 'grant',
      created_at: '2026-04-15T00:00:00.000Z',
      amount: 0,
      status: 'completed',
      payment_method: 'admin_grant',
      plan_id: null,
      pricing_plans: null,
    },
    {
      id: 'refund-system',
      created_at: '2026-04-15T00:00:00.000Z',
      amount: 0,
      status: 'completed',
      payment_method: 'system_refund',
      plan_id: 'plan-basic',
      pricing_plans: { name: 'Basic' },
    },
  ])

  assert.deepEqual(filtered.map((payment) => payment.id), ['paid'])
})

test('payment method and provider status labels come from one place', async () => {
  const history = await import('../src/lib/payment-history.ts')
  assert.equal(history.getPaymentMethodLabel({ payment_method: 'card', provider: 'payapp', payment_method_label: '신용·체크카드' }), '신용·체크카드')
  assert.equal(history.getPaymentMethodLabel({ payment_method: '간편결제', provider: 'toss', payment_method_label: null }), '일반결제(이전)')
  assert.equal(history.getPaymentMethodLabel({ payment_method: '카드', provider: null, payment_method_label: null }), '카드')
  assert.equal(history.getProviderStatusLabel('10'), '결제 대기')
  assert.equal(history.getProviderStatusLabel('16'), '요청 취소')
  assert.equal(history.getProviderStatusLabel('4'), '승인 완료')
  assert.equal(history.getProviderStatusLabel('64'), '결제 취소 완료')
  assert.equal(history.getProviderStatusLabel('PART_CANCEL_PAYMENT'), '부분 취소')
  assert.equal(history.getProviderStatusLabel(null), '상태 확인 중')
  assert.equal(history.getPartialRefundAmount({ status: 'completed', refunded_amount: 3000 }), 3000)
  assert.equal(history.getPartialRefundAmount({ status: 'refunded', refunded_amount: 9900 }), null)
  assert.equal(history.getPartialRefundAmount({ status: 'completed', refunded_amount: 0 }), null)
})
