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
const checkoutMigration = readFileSync(
  new URL('../supabase/migrations/20260930024829_market_checkout_rpc.sql', import.meta.url),
  'utf8'
)
const directMultiMigration = readFileSync(
  new URL('../supabase/migrations/20260930080434_market_checkout_direct_multi.sql', import.meta.url),
  'utf8'
)
// checkout_market_selection 전체를 재정의한 migration마다 같은 가드를 검사한다.
const checkoutFunctionMigrations = [
  ['20260930024829_market_checkout_rpc', checkoutMigration],
  ['20260930080434_market_checkout_direct_multi', directMultiMigration],
]

test('direct purchase route accepts a strict lines body and closes legacy assetKind bodies', () => {
  assert.match(purchaseRoute, /z\.discriminatedUnion\('targetKind'/)
  assert.match(purchaseRoute, /subproductId: z\.string\(\)\.uuid\(\)/)
  assert.match(purchaseRoute, /bundleOptionId: z\.string\(\)\.uuid\(\)/)
  assert.match(purchaseRoute, /lines: z\.array\(z\.object\(\{\n    target: DirectTargetSchema,/)
  assert.match(purchaseRoute, /expectedCredits: z\.number\(\)\.int\(\)/)
  assert.match(purchaseRoute, /\}\)\.strict\(\)\)\.min\(1\)\.max\(50\),\n  idempotencyKey: z\.string\(\)\.uuid\(\),\n\}\)\.strict\(\)/)
  assert.doesNotMatch(purchaseRoute, /^  target: DirectTargetSchema,/m)
  assert.match(purchaseRoute, /'assetKind' in body[\s\S]+LEGACY_PURCHASE_CLOSED[\s\S]+status: 410/)
  assert.match(purchaseRoute, /runMarketCheckout\(\{[\s\S]+mode: 'direct'/)
  assert.doesNotMatch(purchaseRoute, /handleLegacyMarketPurchase|handleMarketV2Purchase/)
})

test('v2 purchase can be disabled without disabling existing downloads', () => {
  assert.match(marketPurchase, /export function isMarketV2PurchaseEnabled/)
  assert.match(marketPurchase, /MARKET_V2_PURCHASE_ENABLED/)
  assert.match(purchaseRoute, /V2_PURCHASE_DISABLED/)
  assert.match(purchaseRoute, /isMarketV2PurchaseEnabled\(\)/)
})

test('v2 purchase writes order line and entitlement records inside the atomic checkout RPC (no compensation path)', () => {
  assert.doesNotMatch(marketPurchase, /createMarketV2PurchaseWithCompensation/)
  assert.doesNotMatch(marketItemsServer, /rollbackMarketV2PurchaseArtifacts/)
  for (const [name, sql] of checkoutFunctionMigrations) {
    assert.match(sql, /insert into public\.market_purchase_orders \(/, name)
    assert.match(sql, /insert into public\.market_purchase_lines \(/, name)
    assert.match(sql, /insert into public\.market_entitlements \(/, name)
    assert.match(sql, /case when v_kind = 'bundle' then 'item' else 'subproduct' end/, name)
    assert.match(sql, /null, v_order_id, 'active'/, name)
  }
})

test('v2 purchase duplicate policy blocks only the same purchase unit and charges bundle full price after partial purchases', () => {
  assert.doesNotMatch(marketPurchase, /ensureUserCanPurchaseMarketV2Target/)
  assert.match(checkoutMigration, /bool_or\(e\.scope = 'item'\)/)
  assert.match(checkoutMigration, /e\.scope = 'subproduct' and e\.subproduct_id = v_target_id and e\.status = 'active'/)
  assert.match(checkoutMigration, /when v_owned then 'ALREADY_OWNED'/)
  assert.match(checkoutMigration, /'code', 'ACK_REQUIRED'/)
  assert.match(purchaseRoute, /acknowledgeNoDiscount/)
})

test('v2 purchase availability is evaluated by the shared evaluate_market_targets SQL', () => {
  assert.doesNotMatch(marketItemsServer, /getMarketSubproductPurchaseContext|getMarketBundlePurchaseContext/)
  assert.match(checkoutMigration, /create or replace function public\.evaluate_market_targets\(/)
  assert.match(checkoutMigration, /s\.price_credits > 0/)
  assert.match(checkoutMigration, /b\.price_credits > 0/)
  assert.match(checkoutMigration, /public\.market_subproduct_files f/)
})
