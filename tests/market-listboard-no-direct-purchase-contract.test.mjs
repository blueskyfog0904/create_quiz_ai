import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const batchRoute = readFileSync(new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url), 'utf8')

test('legacy batch purchase API is explicitly deprecated and cannot create purchases', () => {
  assert.match(batchRoute, /BATCH_PURCHASE_DEPRECATED/)
  assert.match(batchRoute, /status:\s*410/)
  assert.match(batchRoute, /상세페이지에서 구매/)
  assert.doesNotMatch(batchRoute, /CreditService\.deductCredits/)
  assert.doesNotMatch(batchRoute, /createMarketPurchases/)
  assert.doesNotMatch(batchRoute, /rollbackMarketPurchases/)
})
