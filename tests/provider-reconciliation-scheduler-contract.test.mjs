import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migrationNames = readdirSync(
  new URL('../supabase/migrations', import.meta.url)
).filter(
  (name) =>
    name.includes('provider_reconciliation') ||
    name.includes('payment_reconciliation')
)

const migration = migrationNames
  .map((name) => read(`../supabase/migrations/${name}`))
  .join('\n')
const server = read('../src/lib/payment-reconciliation-server.ts')
const route = read('../src/app/api/internal/payments/reconcile/route.ts')
const webhook = read('../src/app/api/payments/webhooks/toss/route.ts')
const kakaoServer = read('../src/lib/kakaopay-server.ts')

test('reconciliation dispatches fresh provider queries from the stored provider', () => {
  assert.match(server, /order\.provider === 'toss'/)
  assert.match(server, /order\.provider === 'kakaopay'/)
  assert.match(server, /getTossPaymentByPaymentKey/)
  assert.match(server, /getKakaoPayOrder/)
  assert.match(server, /finalize_toss_payment/)
  assert.match(server, /record_kakaopay_approval/)
  assert.match(server, /finalize_kakaopay_payment/)
  assert.match(server, /quarantineExternalProviderCancellation/)
})

test('Kakao pending expiry, paid recovery, failure and unknown states fail closed', () => {
  for (const status of [
    'READY',
    'SEND_TMS',
    'OPEN_PAYMENT',
    'SELECT_METHOD',
    'ARS_WAITING',
    'AUTH_PASSWORD',
    'SUCCESS_PAYMENT',
    'CANCEL_PAYMENT',
    'PART_CANCEL_PAYMENT',
    'FAIL_AUTH_PASSWORD',
    'QUIT_PAYMENT',
    'FAIL_PAYMENT',
    'ISSUED_SID',
  ]) {
    assert.ok(server.includes(`'${status}'`), `${status} must be mapped`)
  }

  assert.match(server, /ready_expires_at/)
  assert.match(server, /KAKAOPAY_CALLBACK_NOT_RECEIVED/)
  assert.match(server, /KAKAOPAY_UNKNOWN_STATUS/)
  assert.match(kakaoServer, /getCompletedKakaoPayPayment/)
})

test('scheduler has a durable lease, oldest-first claims and bounded backoff', () => {
  assert.match(migration, /create table public\.payment_reconciliation_runs/i)
  assert.match(migration, /create table public\.payment_reconciliation_items/i)
  assert.match(migration, /create table public\.payment_reconciliation_scheduler/i)
  assert.match(migration, /start_payment_reconciliation_run/i)
  assert.match(migration, /claim_payment_reconciliation_batch/i)
  assert.match(migration, /finish_payment_reconciliation_run/i)
  assert.match(migration, /for update skip locked/i)
  assert.match(migration, /order by[\s\S]*updated_at/i)
  assert.match(migration, /reconcile_attempt_count\s*\+\s*1/i)
  assert.match(migration, /power\(2/i)
  assert.match(migration, /least\(/i)
})

test('health enforcement records alerts and can only turn Kakao new orders off', () => {
  assert.match(migration, /create table public\.payment_reconciliation_alerts/i)
  assert.match(migration, /enforce_payment_reconciliation_health/i)
  assert.match(migration, /kakaopay_accepts_new_orders\s*=\s*false/i)
  assert.doesNotMatch(
    migration,
    /set\s+kakaopay_accepts_new_orders\s*=\s*true/i
  )
  assert.match(migration, /interval '15 minutes'/i)
  assert.match(migration, /consecutive_failures\s*>=\s*3/i)
})

test('Supabase Cron is five-minute, Vault-backed and only scheduled with secrets', () => {
  assert.match(migration, /create extension if not exists pg_cron/i)
  assert.match(migration, /create extension if not exists pg_net/i)
  assert.match(migration, /\*\/5 \* \* \* \*/)
  assert.match(migration, /vault\.decrypted_secrets/i)
  assert.match(migration, /payment_reconcile_origin/)
  assert.match(migration, /payment_reconcile_cron_secret/)
  assert.match(migration, /net\.http_post/i)
  assert.match(migration, /configure_payment_reconciliation_http_cron/i)
  assert.match(migration, /payment_reconciliation_vault_secrets_missing/i)
  assert.match(
    migration,
    /revoke execute on function public\.configure_payment_reconciliation_http_cron\(\)[\s\S]*service_role/i
  )
})

test('cron endpoint owns the durable run and remains secret-protected and bounded', () => {
  assert.match(route, /CRON_SECRET/)
  assert.match(route, /Authorization/)
  assert.match(route, /\.max\(50\)/)
  assert.match(route, /reconcilePendingPayments/)
  assert.match(server, /start_payment_reconciliation_run/)
  assert.match(server, /claim_payment_reconciliation_batch/)
  assert.match(server, /record_payment_reconciliation_result/)
  assert.match(server, /finish_payment_reconciliation_run/)
})

test('Toss webhook durably ingests and returns without a provider query', () => {
  assert.match(webhook, /payment_webhook_events/)
  assert.match(webhook, /PAYMENT_STATUS_CHANGED/)
  assert.doesNotMatch(webhook, /reconcilePaymentOrder/)
  assert.match(webhook, /accepted:\s*true/)
})
