import assert from 'node:assert/strict'
import test from 'node:test'

import { isRealPaidPlanPurchase } from './payment-history.ts'

test('accepts a real paid pricing plan purchase', () => {
  assert.equal(
    isRealPaidPlanPurchase({
      plan_id: 'plan_123',
      payment_key: 'payment_key_123',
      amount: 39000,
    }),
    true
  )
})

test('rejects zero-won admin or system credit records', () => {
  assert.equal(
    isRealPaidPlanPurchase({
      plan_id: null,
      payment_key: null,
      amount: 0,
    }),
    false
  )
})

test('rejects unpaid test purchases without a payment key', () => {
  assert.equal(
    isRealPaidPlanPurchase({
      plan_id: 'plan_123',
      payment_key: null,
      amount: 39000,
    }),
    false
  )
})
