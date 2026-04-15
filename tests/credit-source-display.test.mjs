import assert from 'node:assert/strict'
import test from 'node:test'

import { getCreditSourceCategoryLabel } from '../src/lib/credit-source-display.ts'

test('uses the pricing plan name for regular plan purchases', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: { name: 'Basic', price: 29900 },
    sourceCategory: 'plan_purchase',
  }), 'Basic')
})

test('shows refunded plan purchases as plan name plus refund marker', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'refunded',
    plan: { name: 'Basic', price: 29900 },
    sourceCategory: 'plan_purchase',
  }), 'Basic / 환불')
})

test('maps non-plan admin grant rows to 관리자 지급', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    sourceCategory: 'admin_grant',
  }), '관리자 지급')
})

test('maps non-plan system refund rows to 환불', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    sourceCategory: 'system_refund',
  }), '환불')
})

test('maps bonus and legacy rows to their explicit fallback labels', () => {
  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    sourceCategory: 'bonus',
  }), '보너스')

  assert.equal(getCreditSourceCategoryLabel({
    status: 'active',
    plan: null,
    sourceCategory: 'legacy_unknown',
  }), '기타 지급')
})
