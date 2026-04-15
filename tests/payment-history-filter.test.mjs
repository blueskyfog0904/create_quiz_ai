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
