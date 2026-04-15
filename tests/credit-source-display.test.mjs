import assert from 'node:assert/strict'
import test from 'node:test'

import { getCreditSourceCategoryLabel } from '../src/lib/credit-source-display.ts'

test('uses the pricing plan name for regular plan purchases', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: { name: 'Basic', price: 29900 },
    paymentMethod: 'toss',
  }), 'Basic')
})

test('shows refunded plan purchases as plan name plus refund marker', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'refunded',
    plan: { name: 'Basic', price: 29900 },
    paymentMethod: 'toss',
  }), 'Basic / 환불')
})

test('maps non-plan admin grants and historical refund rows to explicit labels', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    paymentMethod: 'admin_grant',
  }), '관리자 지급')

  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    paymentMethod: 'system_refund',
  }), '환불')
})

test('falls back to 기타 지급 when no plan or recognized payment method exists', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    paymentMethod: null,
  }), '기타 지급')
})
