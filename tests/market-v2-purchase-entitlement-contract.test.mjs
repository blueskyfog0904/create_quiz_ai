import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const purchaseRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url),
  'utf8'
)
const cartCheckoutRoute = readFileSync(
  new URL('../src/app/api/market/cart/checkout/route.ts', import.meta.url),
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

// 11번(계획 docs/plan-bundle11-checkout-simplify.md 7절): 상세 바로 구매는 410 만 남는다(옛 assetKind 본문 포함 모든 본문).
// 본문 검사·결제 RPC 는 장바구니 결제 route(cart 모드)에만 있다.
test('direct purchase route is closed with 410 and the cart checkout route keeps the strict body and cart-mode RPC', () => {
  assert.match(purchaseRoute, /code: 'MARKET_DIRECT_PURCHASE_CLOSED'/)
  assert.match(purchaseRoute, /status: 410/)
  assert.doesNotMatch(purchaseRoute, /runMarketCheckout|mode: 'direct'|z\.object|request\.json/)
  assert.doesNotMatch(purchaseRoute, /handleLegacyMarketPurchase|handleMarketV2Purchase/)
  assert.match(cartCheckoutRoute, /cartItemId: z\.string\(\)\.uuid\(\)/)
  assert.match(cartCheckoutRoute, /expectedCredits: z\.number\(\)\.int\(\)/)
  assert.match(cartCheckoutRoute, /\}\)\.strict\(\)\)\.min\(1\)\.max\(50\)/)
  assert.match(cartCheckoutRoute, /runMarketCheckout\(\{[\s\S]+mode: 'cart'/)
})

test('v2 purchase can be disabled without disabling existing downloads', () => {
  assert.match(marketPurchase, /export function isMarketV2PurchaseEnabled/)
  assert.match(marketPurchase, /MARKET_V2_PURCHASE_ENABLED/)
  assert.match(cartCheckoutRoute, /V2_PURCHASE_DISABLED/)
  assert.match(cartCheckoutRoute, /isMarketV2PurchaseEnabled\(\)/)
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
  assert.match(cartCheckoutRoute, /acknowledgeNoDiscount/)
})

test('v2 purchase availability is evaluated by the shared evaluate_market_targets SQL', () => {
  assert.doesNotMatch(marketItemsServer, /getMarketSubproductPurchaseContext|getMarketBundlePurchaseContext/)
  assert.match(checkoutMigration, /create or replace function public\.evaluate_market_targets\(/)
  assert.match(checkoutMigration, /s\.price_credits > 0/)
  assert.match(checkoutMigration, /b\.price_credits > 0/)
  assert.match(checkoutMigration, /public\.market_subproduct_files f/)
})
