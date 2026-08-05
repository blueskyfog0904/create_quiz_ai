import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const purchaseRouteSource = readFileSync(
  new URL('../src/app/api/credits/purchase/route.ts', import.meta.url),
  'utf8'
)

const deductRouteSource = readFileSync(
  new URL('../src/app/api/credits/deduct/route.ts', import.meta.url),
  'utf8'
)

const adminGrantRouteSource = readFileSync(
  new URL('../src/app/api/admin/users/credits/route.ts', import.meta.url),
  'utf8'
)

test('legacy test purchase route is disabled', () => {
  assert.match(purchaseRouteSource, /TEST_CREDIT_PURCHASE_DISABLED/)
  assert.match(purchaseRouteSource, /status:\s*410/)
  assert.doesNotMatch(purchaseRouteSource, /purchaseCredits/)
})

test('generic deduct route is disabled', () => {
  assert.match(deductRouteSource, /GENERIC_CREDIT_DEDUCTION_DISABLED/)
  assert.match(deductRouteSource, /status:\s*410/)
  assert.doesNotMatch(deductRouteSource, /deductCredits/)
})

test('admin grant route returns snapshot-backed balance fields', () => {
  assert.match(adminGrantRouteSource, /getCreditBalanceSnapshot/)
  assert.match(adminGrantRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(adminGrantRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})
