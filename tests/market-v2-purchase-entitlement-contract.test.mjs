import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const purchaseRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url),
  'utf8'
)
const marketPurchase = readFileSync(
  new URL('../src/lib/market-purchase.ts', import.meta.url),
  'utf8'
)
const marketItemsServer = readFileSync(
  new URL('../src/lib/market-items-server.ts', import.meta.url),
  'utf8'
)

test('v2 purchase route accepts subproduct and bundle purchase bodies separately from legacy assetKind', () => {
  assert.match(purchaseRoute, /purchaseType: z\.enum\(\['subproduct', 'bundle'\]\)/)
  assert.match(purchaseRoute, /subproductId: z\.string\(\)\.uuid\(\)/)
  assert.match(purchaseRoute, /bundleOptionId: z\.string\(\)\.uuid\(\)/)
  assert.match(purchaseRoute, /idempotencyKey/)
  assert.match(purchaseRoute, /handleMarketV2Purchase/)
  assert.match(purchaseRoute, /handleLegacyMarketPurchase/)
})

test('v2 purchase can be disabled without disabling existing downloads', () => {
  assert.match(marketPurchase, /export function isMarketV2PurchaseEnabled/)
  assert.match(marketPurchase, /MARKET_V2_PURCHASE_ENABLED/)
  assert.match(purchaseRoute, /V2_PURCHASE_DISABLED/)
  assert.match(purchaseRoute, /isMarketV2PurchaseEnabled\(\)/)
})

test('v2 purchase helper writes order line and entitlement records with rollback cleanup hooks', () => {
  assert.match(marketPurchase, /export async function createMarketV2PurchaseWithCompensation/)
  assert.match(marketPurchase, /createMarketPurchaseOrder/)
  assert.match(marketPurchase, /createMarketPurchaseLine/)
  assert.match(marketPurchase, /createMarketEntitlement/)
  assert.match(marketItemsServer, /market_purchase_orders/)
  assert.match(marketItemsServer, /market_purchase_lines/)
  assert.match(marketItemsServer, /market_entitlements/)
  assert.match(marketPurchase, /rollbackMarketV2PurchaseArtifacts/)
  assert.match(marketPurchase, /source_order_id/)
  assert.match(marketPurchase, /scope: input\.purchaseType === 'bundle' \? 'item' : 'subproduct'/)
})

test('v2 purchase duplicate policy blocks only the same purchase unit and charges bundle full price after partial purchases', () => {
  assert.match(marketPurchase, /ensureUserCanPurchaseMarketV2Target/)
  assert.match(marketPurchase, /purchaseType === 'bundle'/)
  assert.match(marketPurchase, /entitlement\.scope === 'item'/)
  assert.match(marketPurchase, /entitlement\.scope === 'subproduct'/)
  assert.doesNotMatch(marketPurchase, /subtract|차액|discount|discounted/i)
  assert.match(purchaseRoute, /priceCredits/)
})

test('v2 server helpers expose active subproduct and bundle purchase contexts', () => {
  assert.match(marketItemsServer, /export async function getMarketSubproductPurchaseContext/)
  assert.match(marketItemsServer, /export async function getMarketBundlePurchaseContext/)
  assert.match(marketItemsServer, /price_credits/)
  assert.match(marketItemsServer, /market_subproduct_files/)
  assert.match(marketItemsServer, /market_item_bundle_options/)
})
