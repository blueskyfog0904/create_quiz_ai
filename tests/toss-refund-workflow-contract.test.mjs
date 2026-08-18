import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migration = read(
  '../supabase/migrations/20260805120000_create_toss_refund_workflow.sql'
)
const requestRoute = read('../src/app/api/refunds/request/route.ts')
const adminRoute = read('../src/app/api/admin/refunds/route.ts')
const refundServer = read('../src/lib/point-charge-refunds-server.ts')
const refundProcessor = read('../src/lib/point-charge-refund-processor.ts')
const creditService = read('../src/lib/credits.ts')

test('refund request is atomically validated and freezes one paid source', () => {
  assert.match(migration, /create or replace function public\.request_toss_refund/i)
  assert.match(migration, /for update/i)
  assert.match(
    migration,
    /remaining_credits\s*<>\s*(?:v_source\.)?initial_credits/i
  )
  assert.match(migration, /approved_at\s*\+\s*interval\s*'7 days'/i)
  assert.match(
    migration,
    /expires_at\s+is not null[\s\S]*expires_at\s*<=\s*now\(\)/i
  )
  assert.match(migration, /status\s*=\s*'pending_refund'/i)
  assert.match(migration, /refund_requests_one_open_source/i)
})

test('refund completion is a single idempotent local transaction', () => {
  assert.match(migration, /create or replace function public\.claim_toss_refund/i)
  assert.match(migration, /create or replace function public\.finalize_toss_refund/i)
  assert.match(migration, /provider_cancel_transaction_key/i)
  assert.match(migration, /status\s*=\s*'refunded'/i)
  assert.match(migration, /remaining_credits\s*=\s*0/i)
  assert.match(migration, /insert into public\.credit_transactions/i)
  assert.match(migration, /update public\.profiles/i)
  assert.match(
    migration,
    /revoke execute on function public\.finalize_toss_refund[\s\S]*from public,\s*anon,\s*authenticated/i
  )
})

test('user refund route uses strict input and the database eligibility decision', () => {
  assert.match(requestRoute, /z\.object/)
  assert.match(requestRoute, /auth\.getUser\(\)/)
  assert.match(requestRoute, /requestPointChargeRefund/)
  assert.doesNotMatch(requestRoute, /canRequestRefund/)
  assert.doesNotMatch(requestRoute, /CreditService/)
})

test('admin approval delegates to a processor that cancels Toss before local completion', () => {
  const claimIndex = refundProcessor.indexOf('claimed = await claimPointChargeRefund')
  const cancelIndex = refundProcessor.indexOf(
    'const canceledPayment = await cancelTossPayment'
  )
  const finalizeIndex = refundProcessor.indexOf(
    'const result = await finalizePointChargeRefund'
  )

  assert.ok(claimIndex >= 0)
  assert.ok(finalizeIndex > cancelIndex)
  assert.match(adminRoute, /processPointChargeRefund/)
  assert.match(refundProcessor, /cancel_idempotency_key/)
  assert.match(refundProcessor, /failPointChargeRefund/)
  assert.doesNotMatch(adminRoute, /CreditService\.approveRefund/)
})

test('refund server owns the provider-neutral service-role RPC boundary', () => {
  assert.match(refundServer, /import 'server-only'/)
  assert.match(refundServer, /get_point_charge_refund_eligibility/)
  assert.match(refundServer, /request_point_charge_refund/)
  assert.match(refundServer, /claim_point_charge_refund/)
  assert.match(refundServer, /finalize_point_charge_refund/)
  assert.match(refundServer, /reject_point_charge_refund/)
  assert.doesNotMatch(creditService, /static async approveRefund/)
  assert.doesNotMatch(creditService, /static async requestRefund/)
})
