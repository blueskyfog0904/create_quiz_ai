import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const purchaseRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url),
  'utf8'
)
const marketPurchase = readFileSync(new URL('../src/lib/market-purchase.ts', import.meta.url), 'utf8')
const marketItemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

test('legacy market purchase stores credit consumption snapshot on purchase row', () => {
  assert.match(purchaseRoute, /credit_consumptions: deductionResult\.consumptions/)
  assert.match(marketItemsServer, /MarketPurchaseInsert/)
  assert.match(marketItemsServer, /credit_consumptions/)
})

test('v2 market purchase stores credit consumption snapshot on purchase order', () => {
  assert.match(marketPurchase, /credit_consumptions: deductionResult\.consumptions/)
  assert.match(marketItemsServer, /MarketPurchaseOrderInsert/)
  assert.match(marketItemsServer, /credit_consumptions/)
})
