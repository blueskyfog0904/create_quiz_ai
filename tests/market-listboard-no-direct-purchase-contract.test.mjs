import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const batchRoute = readFileSync(new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url), 'utf8')

test('legacy batch purchase API is explicitly deprecated and cannot create purchases', () => {
  assert.match(batchRoute, /BATCH_PURCHASE_DEPRECATED/)
  assert.match(batchRoute, /status:\s*410/)
  // 11번: 자료 구매는 장바구니로만 하므로 안내도 장바구니로 보낸다
  assert.match(batchRoute, /장바구니에서 구매해 주세요/)
  assert.doesNotMatch(batchRoute, /상세페이지에서 구매/)
  assert.doesNotMatch(batchRoute, /CreditService\.deductCredits/)
  assert.doesNotMatch(batchRoute, /createMarketPurchases/)
  assert.doesNotMatch(batchRoute, /rollbackMarketPurchases/)
})
