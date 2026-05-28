import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const marketPurchase = readFileSync(
  new URL('../src/lib/market-purchase.ts', import.meta.url),
  'utf8'
)
const migration = readFileSync(
  new URL('../supabase/migrations/20260528010000_create_market_subproduct_v2_schema.sql', import.meta.url),
  'utf8'
)

test('v2 purchase checks idempotency before any credit deduction', () => {
  const helperStart = marketPurchase.indexOf('export async function createMarketV2PurchaseWithCompensation')
  assert.notEqual(helperStart, -1)
  const helperSource = marketPurchase.slice(helperStart)
  assert.ok(
    helperSource.indexOf('findCompletedMarketV2OrderByIdempotencyKey') < helperSource.indexOf('deductCreditsForMarketV2Purchase'),
    'idempotency lookup must happen before credit deduction'
  )
  assert.match(helperSource, /alreadyCompleted: true/)
  assert.match(helperSource, /deductionResult: null/)
})

test('v2 purchase has a database uniqueness guard for idempotency keys', () => {
  assert.match(migration, /uq_market_purchase_orders_user_idempotency/)
  assert.match(migration, /on public\.market_purchase_orders\(user_id, idempotency_key\)/)
  assert.match(migration, /where idempotency_key is not null/)
})

test('v2 purchase compensates credit deduction when order or entitlement creation fails', () => {
  const helperStart = marketPurchase.indexOf('export async function createMarketV2PurchaseWithCompensation')
  const helperSource = marketPurchase.slice(helperStart)
  assert.match(helperSource, /try \{/)
  assert.match(helperSource, /rollbackMarketV2PurchaseArtifacts\(order\.id, item\.workspace_subject\)/)
  assert.match(helperSource, /CreditService\.refundCredits/)
  assert.match(helperSource, /input\.balanceBefore/)
})

