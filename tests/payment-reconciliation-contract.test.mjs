import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migration = read(
  '../supabase/migrations/20260805130000_create_payment_webhook_events.sql'
)
const webhookRoute = read(
  '../src/app/api/payments/webhooks/payapp/route.ts'
)
const webhookHandler = read('../src/lib/payapp-webhook-server.ts')
const reconcileRoute = read(
  '../src/app/api/internal/payments/reconcile/route.ts'
)
const reconciliationServer = read(
  '../src/lib/payment-reconciliation-server.ts'
)
const payappServer = read('../src/lib/payapp-server.ts')

test('webhook transmissions are durable, deduplicated, and private', () => {
  assert.match(migration, /create table public\.payment_webhook_events/i)
  assert.match(migration, /transmission_id text not null unique/i)
  assert.match(migration, /enable row level security/i)
  assert.match(
    migration,
    /revoke all on table public\.payment_webhook_events\s+from anon,\s*authenticated/i
  )
})

test('PayApp payment webhook is authenticated and durably recorded', () => {
  assert.match(webhookRoute, /handlePayAppFeedback/)
  assert.match(payappServer, /timingSafeEqual/)
  assert.match(payappServer, /PAYAPP_LINKVAL/)
  assert.match(webhookHandler, /verifyPayAppFeedback/)
  assert.match(webhookHandler, /\.from\('payment_webhook_events'\)/)
  assert.doesNotMatch(webhookHandler, /reconcilePaymentOrder/)
})

test('reconciliation uses stored PayApp records and fresh KakaoPay lookups', () => {
  assert.match(reconciliationServer, /retry_payapp_fulfillment/)
  assert.match(reconciliationServer, /mark_payapp_order_terminal/)
  assert.match(reconciliationServer, /getKakaoPayOrder/)
  assert.match(reconciliationServer, /finalizePointChargeRefund/)
  assert.match(reconciliationServer, /manual_review/)
  assert.doesNotMatch(reconciliationServer, /getTossPaymentByPaymentKey|finalize_toss_payment/)
})

test('internal reconcile job is secret-protected and bounded', () => {
  assert.match(reconcileRoute, /CRON_SECRET/)
  assert.match(reconcileRoute, /Authorization/)
  assert.match(reconcileRoute, /z\.object/)
  assert.match(reconcileRoute, /\.max\(50\)/)
  assert.match(reconcileRoute, /reconcilePendingPayments/)
  assert.match(reconciliationServer, /start_payment_reconciliation_run/)
  assert.match(reconciliationServer, /finish_payment_reconciliation_run/)
})
