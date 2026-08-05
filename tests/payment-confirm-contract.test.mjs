import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migration = read(
  '../supabase/migrations/20260805100000_create_payment_orders_and_atomic_fulfillment.sql'
)
const confirmRoute = read('../src/app/api/payments/confirm/route.ts')
const tossServer = read('../src/lib/toss-payments-server.ts')
const successPage = read('../src/app/checkout/success/page.tsx')

test('payment fulfillment is one service-role-only database transaction', () => {
  assert.match(
    migration,
    /create or replace function\s+public\.finalize_toss_payment/i
  )
  assert.match(migration, /for update/i)
  assert.match(migration, /insert into public\.credit_sources/i)
  assert.match(migration, /insert into public\.credit_transactions/i)
  assert.match(migration, /insert into public\.payment_history/i)
  assert.match(migration, /update public\.profiles/i)
  assert.match(migration, /status\s*=\s*'completed'/i)
  assert.match(
    migration,
    /grant execute on function public\.finalize_toss_payment[\s\S]*to service_role/i
  )
  assert.match(
    migration,
    /revoke execute on function public\.finalize_toss_payment[\s\S]*from public,\s*anon,\s*authenticated/i
  )
})

test('confirm trusts only the authenticated stored order and strict input', () => {
  assert.match(confirmRoute, /auth\.getUser\(\)/)
  assert.match(confirmRoute, /confirmPaymentSchema/)
  assert.match(confirmRoute, /\.from\('payment_orders'\)/)
  assert.match(confirmRoute, /\.eq\('user_id',\s*user\.id\)/)
  assert.match(confirmRoute, /order\.expected_amount\s*!==\s*input\.amount/)
  assert.match(confirmRoute, /order\.expires_at/)
  assert.doesNotMatch(confirmRoute, /planId/)
  assert.doesNotMatch(successPage, /planId/)
})

test('Toss response and allowed methods are verified before fulfillment', () => {
  assert.match(confirmRoute, /confirmTossPayment/)
  assert.match(confirmRoute, /validateConfirmedPayment/)
  assert.match(confirmRoute, /isAllowedPointChargeMethod/)
  assert.match(confirmRoute, /finalize_toss_payment/)
  assert.match(tossServer, /currency\s*!==\s*'KRW'/)
  assert.match(tossServer, /status\s*!==\s*'DONE'/)
  assert.match(tossServer, /totalAmount\s*!==\s*expected\.amount/)
  assert.match(tossServer, /orderId\s*!==\s*expected\.orderId/)
})

test('confirmation uses persistent idempotency and does not leak secrets', () => {
  assert.match(confirmRoute, /confirm_idempotency_key/)
  assert.match(tossServer, /Idempotency-Key/)
  assert.match(confirmRoute, /fulfillment_pending/)
  assert.match(confirmRoute, /status:\s*202/)
  assert.doesNotMatch(confirmRoute, /관리자 확인용/)
  assert.doesNotMatch(confirmRoute, /paymentKey:\s*paymentKey/)
  assert.doesNotMatch(confirmRoute, /console\.error\([^)]*confirmData/)
  assert.doesNotMatch(tossServer, /console\.(?:log|error)\([^)]*(?:secret|paymentKey)/i)
})
