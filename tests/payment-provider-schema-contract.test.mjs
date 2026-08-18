import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync } from 'node:fs'

function readMigration(suffix) {
  const migrationsUrl = new URL('../supabase/migrations/', import.meta.url)
  const filename = readdirSync(migrationsUrl).find((name) =>
    name.endsWith(`_${suffix}.sql`)
  )

  return filename
    ? readFileSync(new URL(filename, migrationsUrl), 'utf8')
    : ''
}

const schemaMigration = readMigration('extend_payment_provider_schema')
const fulfillmentMigration = readMigration(
  'guard_payment_environment_and_add_kakaopay_fulfillment'
)
const orderRoute = readFileSync(
  new URL('../src/app/api/payments/orders/route.ts', import.meta.url),
  'utf8'
)
const paymentServer = readFileSync(
  new URL('../src/lib/payment-orders-server.ts', import.meta.url),
  'utf8'
)
const envExample = readFileSync(
  new URL('../env.local.example', import.meta.url),
  'utf8'
)

test('provider schema owns one immutable checkout attempt and private provider identifiers', () => {
  assert.match(schemaMigration, /create table public\.checkout_attempts/i)
  assert.match(schemaMigration, /unique\s*\(user_id,\s*checkout_attempt_id\)/i)
  assert.match(schemaMigration, /request_fingerprint\s+text\s+not null/i)
  assert.match(
    schemaMigration,
    /create table public\.payment_provider_transactions/i
  )
  assert.match(schemaMigration, /provider_transaction_id\s+text/i)
  assert.match(schemaMigration, /provider_approval_id\s+text/i)
  assert.match(schemaMigration, /callback_state_hash\s+text/i)
  assert.match(schemaMigration, /result_token_hash\s+text/i)
  assert.doesNotMatch(schemaMigration, /pg_token\s+(?:text|varchar)/i)
})

test('payment orders support both providers with server-owned tax and reconciliation snapshots', () => {
  assert.match(schemaMigration, /provider\s+in\s*\('toss',\s*'kakaopay'\)/i)
  assert.match(schemaMigration, /provider_merchant_id\s+text/i)
  assert.match(schemaMigration, /tax_free_amount\s+integer/i)
  assert.match(schemaMigration, /vat_amount\s+integer/i)
  assert.match(schemaMigration, /ready_unknown/i)
  assert.match(schemaMigration, /expired/i)
  assert.match(schemaMigration, /reconcile_attempt_count/i)
  assert.match(schemaMigration, /prevent_payment_order_snapshot_update/i)
})

test('runtime configuration is fail-closed and service role cannot mutate it', () => {
  assert.match(schemaMigration, /create table public\.payment_runtime_config/i)
  assert.match(
    schemaMigration,
    /accepted_provider_environment[\s\S]*'disabled'[\s\S]*'test'[\s\S]*'live'/i
  )
  assert.match(schemaMigration, /master_accepts_new_orders/i)
  assert.match(schemaMigration, /toss_accepts_new_orders/i)
  assert.match(schemaMigration, /kakaopay_accepts_new_orders/i)
  assert.match(
    schemaMigration,
    /revoke all on table public\.payment_runtime_config[\s\S]*service_role/i
  )
  assert.match(
    schemaMigration,
    /grant select on table public\.payment_runtime_config to service_role/i
  )
  assert.doesNotMatch(
    schemaMigration,
    /grant\s+(?:all|insert|update|delete)[\s\S]*payment_runtime_config[\s\S]*service_role/i
  )
})

test('browser payment reads use safe RPCs instead of private table grants', () => {
  assert.match(schemaMigration, /create or replace function public\.get_my_payment_history/i)
  assert.match(schemaMigration, /create or replace function public\.get_my_refund_requests/i)
  assert.match(
    schemaMigration,
    /revoke all on table public\.payment_orders[\s\S]*anon, authenticated/i
  )
  assert.match(
    schemaMigration,
    /revoke all on table public\.payment_history[\s\S]*anon, authenticated/i
  )
  assert.match(
    schemaMigration,
    /revoke all on table public\.refund_requests[\s\S]*anon, authenticated/i
  )
})

test('order preparation claims the checkout attempt through one service-role RPC', () => {
  assert.match(orderRoute, /checkoutAttemptId/)
  assert.match(orderRoute, /prepare_payment_order/)
  assert.match(orderRoute, /requestFingerprint/)
  assert.match(orderRoute, /PAYMENT_ATTEMPT_PAYLOAD_CONFLICT/)
  assert.doesNotMatch(orderRoute, /\.from\('payment_orders'\)\s*\.insert/)
})

test('provider finalizers enforce runtime environment and merchant identity', () => {
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.finalize_toss_payment/i
  )
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.finalize_kakaopay_payment/i
  )
  assert.match(fulfillmentMigration, /payment_runtime_config/i)
  assert.match(fulfillmentMigration, /PAYMENT_RUNTIME_ENVIRONMENT_MISMATCH/i)
  assert.match(fulfillmentMigration, /PAYMENT_RUNTIME_MERCHANT_MISMATCH/i)
  assert.match(fulfillmentMigration, /SUCCESS_PAYMENT/i)
  assert.match(fulfillmentMigration, /payment_method_type[\s\S]*MONEY/i)
})

test('refund database boundary is provider-neutral without exposing provider identifiers', () => {
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.get_point_charge_refund_eligibility/i
  )
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.request_point_charge_refund/i
  )
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.claim_point_charge_refund/i
  )
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.finalize_point_charge_refund/i
  )
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.fail_point_charge_refund/i
  )
  assert.match(
    fulfillmentMigration,
    /create or replace function public\.reject_point_charge_refund/i
  )
  assert.match(fulfillmentMigration, /provider\s+in\s*\('toss',\s*'kakaopay'\)/i)
})

test('payment admin client uses generated database types and documents server secrets', () => {
  assert.match(paymentServer, /createSupabaseClient<Database>/)
  assert.match(envExample, /^TOSS_PAYMENTS_ENABLED=/m)
  assert.match(envExample, /^KAKAOPAY_PAYMENTS_ENABLED=false$/m)
  assert.match(envExample, /^KAKAOPAY_CID=TC0ONETIME$/m)
  assert.match(envExample, /^KAKAOPAY_SECRET_KEY=/m)
  assert.match(envExample, /^PAYMENT_CALLBACK_ORIGIN=/m)
  assert.match(envExample, /^PAYMENT_PARTNER_USER_SECRET=/m)
  assert.match(envExample, /^CRON_SECRET=/m)
})
