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

test('purchase route returns snapshot-backed balance fields', () => {
  assert.match(purchaseRouteSource, /getCreditBalanceSnapshot/)
  assert.match(purchaseRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(purchaseRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})

test('deduct route returns snapshot-backed balance fields', () => {
  assert.match(deductRouteSource, /getCreditBalanceSnapshot/)
  assert.match(deductRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(deductRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})

test('admin grant route returns snapshot-backed balance fields', () => {
  assert.match(adminGrantRouteSource, /getCreditBalanceSnapshot/)
  assert.match(adminGrantRouteSource, /buildCreditBalanceResponseFields/)
  assert.match(adminGrantRouteSource, /\.\.\.buildCreditBalanceResponseFields\(snapshot\)/)
})
