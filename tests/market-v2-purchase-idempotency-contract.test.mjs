import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const marketPurchase = readFileSync(
  new URL('../src/lib/market-purchase.ts', import.meta.url),
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
const migration = readFileSync(
  new URL('../supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql', import.meta.url),
  'utf8'
)

test('v2 purchase checks idempotency before any cart/price read or credit deduction', () => {
  for (const [name, sql] of checkoutFunctionMigrations) {
    const idempotencyCheck = sql.indexOf('-- 3. 멱등 확인')
    assert.notEqual(idempotencyCheck, -1, name)
    assert.ok(idempotencyCheck < sql.indexOf('-- 4. 대상 확정'), `${name}: idempotency before cart read`)
    assert.ok(idempotencyCheck < sql.indexOf('public.consume_credits('), `${name}: idempotency before credit deduction`)
    assert.match(sql, /v_batch\.result_payload \|\| jsonb_build_object\('alreadyCompleted', true\)/, name)
    assert.match(sql, /'IDEMPOTENCY_CONFLICT'/, name)
  }
})

test('v2 purchase has a database uniqueness guard for idempotency keys', () => {
  assert.match(migration, /uq_market_purchase_orders_user_idempotency/)
  assert.match(migration, /on public\.market_purchase_orders\(user_id, idempotency_key\)/)
  assert.match(migration, /where idempotency_key is not null/)
})

test('v2 purchase rolls back credit deduction atomically instead of compensating', () => {
  assert.doesNotMatch(marketPurchase, /createMarketV2PurchaseWithCompensation|CreditService\.refundCredits/)
  for (const [name, sql] of checkoutFunctionMigrations) {
    assert.doesNotMatch(sql, /when others/i, name)
    assert.match(sql, /when raise_exception then\s+if sqlerrm = 'INSUFFICIENT_CREDITS' then\s+raise exception using errcode = 'P0402', message = 'INSUFFICIENT_CREDITS';\s+else\s+raise;/, name)
  }
})

