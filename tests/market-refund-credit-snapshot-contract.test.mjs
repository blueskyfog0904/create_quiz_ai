import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const purchaseRoute = readFileSync(
  new URL('../src/app/api/market/items/[itemId]/purchase/route.ts', import.meta.url),
  'utf8'
)
const marketItemsServer = readFileSync(new URL('../src/lib/market-items-server.ts', import.meta.url), 'utf8')
const marketRefunds = readFileSync(new URL('../src/lib/market-refunds.ts', import.meta.url), 'utf8')
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

test('legacy market purchase rows keep credit consumption snapshots while new legacy purchases are closed', () => {
  assert.match(purchaseRoute, /LEGACY_PURCHASE_CLOSED/)
  assert.doesNotMatch(purchaseRoute, /deductCredits/)
  assert.match(marketItemsServer, /MarketPurchaseInsert/)
  // 기존 legacy 구매 행의 소비 스냅샷은 환불 경로가 계속 읽는다
  assert.match(marketRefunds, /parseCreditConsumptions\(purchase\.credit_consumptions\)/)
})

test('v2 market purchase stores each child consume_credits result on its purchase order', () => {
  for (const [name, sql] of checkoutFunctionMigrations) {
    assert.match(sql, /v_consume := public\.consume_credits\(/, name)
    assert.match(sql, /original_price_credits, charged_credits, credit_consumptions, status, checkout_batch_id/, name)
    assert.match(sql, /v_consume->'consumptions', 'completed', v_batch_id/, name)
  }
})
