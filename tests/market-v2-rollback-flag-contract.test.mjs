import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const purchaseRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url),
  'utf8'
)
const downloadRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/download/route.ts', import.meta.url),
  'utf8'
)

test('v2 purchase rollback flag disables only new purchases', () => {
  assert.match(purchaseRoute, /isMarketV2PurchaseEnabled\(\)/)
  assert.match(purchaseRoute, /V2_PURCHASE_DISABLED/)
  assert.doesNotMatch(downloadRoute, /MARKET_V2_PURCHASE_ENABLED/)
  assert.doesNotMatch(downloadRoute, /V2_PURCHASE_DISABLED/)
})

test('v2 download resolver continues to read entitlements even when purchase flag exists', () => {
  assert.match(downloadRoute, /handleMarketV2Download/)
  assert.match(downloadRoute, /listMarketV2EntitlementsForItem/)
  assert.match(downloadRoute, /findMarketSubproductFileV2Entitlement/)
  assert.match(downloadRoute, /createSignedUrl\(file\.storage_path/)
})

