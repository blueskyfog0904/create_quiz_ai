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
  '../src/app/api/payments/webhooks/toss/route.ts'
)
const reconcileRoute = read(
  '../src/app/api/internal/payments/reconcile/route.ts'
)
const reconciliationServer = read(
  '../src/lib/payment-reconciliation-server.ts'
)
const tossServer = read('../src/lib/toss-payments-server.ts')

test('webhook transmissions are durable, deduplicated, and private', () => {
  assert.match(migration, /create table public\.payment_webhook_events/i)
  assert.match(migration, /transmission_id text not null unique/i)
  assert.match(migration, /enable row level security/i)
  assert.match(
    migration,
    /revoke all on table public\.payment_webhook_events\s+from anon,\s*authenticated/i
  )
})

test('Toss payment webhook persists for asynchronous provider reconciliation', () => {
  assert.match(webhookRoute, /tosspayments-webhook-transmission-id/i)
  assert.match(webhookRoute, /TOSS_WEBHOOK_TOKEN/)
  assert.match(webhookRoute, /timingSafeEqual/)
  assert.match(webhookRoute, /PAYMENT_STATUS_CHANGED/)
  assert.match(webhookRoute, /z\.object/)

  assert.match(webhookRoute, /\.from\('payment_webhook_events'\)/)
  assert.match(webhookRoute, /accepted:\s*true/)
  assert.doesNotMatch(webhookRoute, /reconcilePaymentOrder/)
})

test('reconciliation trusts a fresh Toss lookup, not webhook payment state', () => {
  assert.match(tossServer, /getTossPaymentByPaymentKey/)
  assert.match(reconciliationServer, /getTossPaymentByPaymentKey/)
  assert.match(reconciliationServer, /validateReconciledTossPayment/)
  assert.match(reconciliationServer, /finalize_toss_payment/)
  assert.match(reconciliationServer, /finalizePointChargeRefund/)
  assert.match(reconciliationServer, /manual_review/)
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
