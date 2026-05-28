import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const batchRoute = readFileSync(new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url), 'utf8')
const itemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

test('batch purchase route is deprecated and cannot create or rollback purchase rows', () => {
  assert.match(batchRoute, /BATCH_PURCHASE_DEPRECATED/)
  assert.match(batchRoute, /status:\s*410/)
  assert.doesNotMatch(batchRoute, /createdPurchaseIds/)
  assert.doesNotMatch(batchRoute, /rollbackMarketPurchases/)
  assert.match(itemsServer, /rollbackMarketPurchases/)
  assert.match(itemsServer, /market_download_events/)
  assert.match(itemsServer, /purchase_id/)
})
