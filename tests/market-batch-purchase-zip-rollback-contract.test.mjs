import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const batchRoute = readFileSync(new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url), 'utf8')
const itemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

test('batch purchase records created purchase ids and rolls them back before refunding credits', () => {
  assert.match(batchRoute, /createdPurchaseIds/) 
  assert.match(batchRoute, /rollbackMarketPurchases/)
  assert.ok(
    batchRoute.indexOf('rollbackMarketPurchases') < batchRoute.indexOf('refundCredits') || batchRoute.includes('await rollbackCreatedPurchases'),
    'purchase rows should be rolled back before or inside the refund rollback path'
  )
  assert.match(itemsServer, /rollbackMarketPurchases/)
  assert.match(itemsServer, /market_download_events/)
  assert.match(itemsServer, /purchase_id/)
})
