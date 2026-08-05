import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migration = read(
  '../supabase/migrations/20260805110000_enforce_credit_expiration.sql'
)
const fulfillmentMigration = read(
  '../supabase/migrations/20260805100000_create_payment_orders_and_atomic_fulfillment.sql'
)
const balanceSource = read('../src/lib/credit-balance.ts')
const creditsSource = read('../src/lib/credits.ts')
const creditsPage = read('../src/app/(dashboard)/mypage/credits/page.tsx')
const creditsClient = read(
  '../src/app/(dashboard)/mypage/credits/credits-client.tsx'
)

test('new paid credits expire exactly one year after provider approval', () => {
  assert.match(
    fulfillmentMigration,
    /p_approved_at\s*\+\s*interval\s*'1 year'/i
  )
  assert.match(fulfillmentMigration, /purchased_at[\s\S]*p_approved_at/i)
})

test('credit consumption excludes expired and refund-frozen sources', () => {
  assert.match(migration, /create or replace function public\.consume_credits/i)
  assert.match(migration, /status\s*=\s*'active'/i)
  assert.match(
    migration,
    /\(expires_at is null or expires_at > now\(\)\)/i
  )
  assert.match(
    migration,
    /order by expires_at asc nulls last,\s*purchased_at asc,\s*id asc/i
  )
  assert.match(migration, /for update/i)
})

test('database snapshot is the single valid-balance clock', () => {
  assert.match(
    migration,
    /create or replace function public\.get_credit_balance_snapshot/i
  )
  assert.match(migration, /expired_balance/i)
  assert.match(migration, /next_expiration_at/i)
  assert.match(balanceSource, /\.rpc\('get_credit_balance_snapshot'/)
  assert.match(balanceSource, /expiredBalance/)
  assert.match(balanceSource, /nextExpirationAt/)
  assert.match(balanceSource, /displayBalance:\s*spendableBalance/)
  assert.doesNotMatch(balanceSource, /CREDIT_LEDGER_DISPLAY_ENABLED/)
})

test('server reads and user credits UI expose expiry consistently', () => {
  assert.match(
    creditsSource,
    /static async getBalance[\s\S]*getCreditBalanceSnapshot/
  )
  assert.match(creditsPage, /spendableBalance=\{snapshot\.spendableBalance\}/)
  assert.match(creditsPage, /expiredBalance=\{snapshot\.expiredBalance\}/)
  assert.match(creditsClient, /expires_at/)
  assert.match(creditsClient, /만료 크레딧/)
  assert.match(creditsClient, /사용기한/)
})

test('legacy paid-source expiry is not guessed before the policy decision', () => {
  assert.doesNotMatch(
    migration,
    /update\s+public\.credit_sources[\s\S]{0,300}purchased_at\s*\+\s*interval\s*'1 year'/i
  )
  assert.match(migration, /legacy paid source backfill requires a separate approved migration/i)
})
