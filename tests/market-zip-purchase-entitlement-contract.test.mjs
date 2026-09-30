import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const purchase = readFileSync(new URL('../src/lib/market-purchase.ts', import.meta.url), 'utf8')
const batchRoute = readFileSync(new URL('../src/app/api/market/purchases/batch/route.ts', import.meta.url), 'utf8')
const purchaseRoute = readFileSync(new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url), 'utf8')
const downloadRoute = readFileSync(new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url), 'utf8')
const itemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')

test('market purchase helpers model zip as an independent paid asset', () => {
  assert.match(purchase, /MarketPaidAssetKind = 'pdf' \| 'hwp' \| 'zip'/)
  assert.match(purchase, /getMarketPurchaseKindsToCheck|findCoveringMarketPurchase/)
  assert.match(purchase, /assetKind === 'zip'[\s\S]+\['zip'\]/)
})

test('legacy detail purchase is closed while download accepts zip and batch purchase is deprecated', () => {
  assert.match(batchRoute, /BATCH_PURCHASE_DEPRECATED/)
  assert.match(batchRoute, /status:\s*410/)
  assert.match(purchaseRoute, /'assetKind' in body/)
  assert.match(purchaseRoute, /LEGACY_PURCHASE_CLOSED[\s\S]+status: 410/)
  assert.doesNotMatch(purchaseRoute, /z\.enum\(\['pdf', 'hwp', 'zip'\]\)/)
  assert.match(downloadRoute, /assetKind !== 'pdf' && assetKind !== 'hwp' && assetKind !== 'zip'/)
  assert.doesNotMatch(downloadRoute, /assetKind !== 'sample'/)
  assert.match(downloadRoute, /findCoveringMarketPurchase|getMarketPurchaseKindsToCheck/)
})

test('legacy rollback helper remains available for non-listboard flows', () => {
  assert.match(itemsServer, /rollbackMarketPurchases/)
  assert.match(itemsServer, /market_download_events/)
  assert.match(itemsServer, /purchase_id/)
  assert.doesNotMatch(batchRoute, /createdPurchaseIds/)
  assert.doesNotMatch(batchRoute, /rollbackMarketPurchases/)
})
