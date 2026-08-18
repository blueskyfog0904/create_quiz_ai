import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (path) => {
  const url = new URL(path, import.meta.url)
  return existsSync(url) ? readFileSync(url, 'utf8') : ''
}

const migration = read(
  '../supabase/migrations/20260818071513_add_kakaopay_checkout_state_machine.sql'
)
const orderRoute = read('../src/app/api/payments/kakaopay/orders/route.ts')
const callbackServer = read('../src/lib/kakaopay-callback-server.ts')
const approveRoute = read(
  '../src/app/api/payments/kakaopay/callback/approve/route.ts'
)
const cancelRoute = read(
  '../src/app/api/payments/kakaopay/callback/cancel/route.ts'
)
const failRoute = read(
  '../src/app/api/payments/kakaopay/callback/fail/route.ts'
)
const statusRoute = read('../src/app/api/payments/kakaopay/status/route.ts')
const resultPage = read('../src/app/checkout/kakaopay/result/page.tsx')

test('Kakao ready route is authenticated, server-priced and attempt-idempotent', () => {
  assert.match(orderRoute, /auth\.getUser\(\)/)
  assert.match(orderRoute, /checkoutAttemptId/)
  assert.match(orderRoute, /\.from\('pricing_plans'\)/)
  assert.match(orderRoute, /prepare_payment_order/)
  assert.match(orderRoute, /p_provider:\s*'kakaopay'/)
  assert.match(orderRoute, /begin_kakaopay_ready/)
  assert.match(orderRoute, /store_kakaopay_ready/)
  assert.match(orderRoute, /readyKakaoPayPayment/)
  assert.match(orderRoute, /payment_method_type|MONEY/)
  assert.match(orderRoute, /PAYMENT_ATTEMPT_PAYLOAD_CONFLICT/)
  assert.doesNotMatch(orderRoute, /amount:\s*(?:body|parsed\.data)\./)
})

test('database owns one ready claim and stores only callback/result hashes', () => {
  assert.match(migration, /create or replace function public\.begin_kakaopay_ready/i)
  assert.match(migration, /create or replace function public\.store_kakaopay_ready/i)
  assert.match(migration, /create or replace function public\.claim_kakaopay_callback/i)
  assert.match(migration, /create or replace function public\.record_kakaopay_approval/i)
  assert.match(migration, /for update/i)
  assert.match(migration, /callback_state_hash/i)
  assert.match(migration, /callback_state_consumed_at/i)
  assert.match(migration, /result_token_hash/i)
  assert.match(migration, /status\s*=\s*'ready_unknown'/i)
  assert.match(migration, /status\s*=\s*'ready'/i)
  assert.doesNotMatch(migration, /pg_token\s+(?:text|varchar)/i)
  assert.match(migration, /revoke execute[\s\S]*anon, authenticated/i)
})

test('callback routes share one state-machine handler', () => {
  assert.match(approveRoute, /handleKakaoPayCallback\(request,\s*'approve'\)/)
  assert.match(cancelRoute, /handleKakaoPayCallback\(request,\s*'cancel'\)/)
  assert.match(failRoute, /handleKakaoPayCallback\(request,\s*'fail'\)/)
  assert.match(callbackServer, /claim_kakaopay_callback/)
  assert.match(callbackServer, /approveKakaoPayPayment/)
  assert.match(callbackServer, /getKakaoPayOrder/)
  assert.match(callbackServer, /validateApprovedKakaoPayPayment/)
  assert.match(callbackServer, /validateFreshKakaoPayOrder/)
  assert.match(callbackServer, /record_kakaopay_approval/)
  assert.match(callbackServer, /finalize_kakaopay_payment/)
})

test('callback capability is separated from result capability and never persisted raw', () => {
  assert.match(callbackServer, /createOpaqueToken/)
  assert.match(callbackServer, /hashOpaqueToken/)
  assert.match(callbackServer, /httpOnly:\s*true/)
  assert.match(callbackServer, /secure:\s*true/)
  assert.match(callbackServer, /sameSite:\s*'lax'/)
  assert.match(callbackServer, /status:\s*303/)
  assert.match(callbackServer, /Cache-Control/)
  assert.match(callbackServer, /Referrer-Policy/)
  assert.doesNotMatch(callbackServer, /pg_token[^\n]*(?:insert|update|console)/i)
  assert.doesNotMatch(callbackServer, /searchParams\.set\(['"](?:state|pg_token|token)/)
})

test('result status reads only an HttpOnly capability and returns public fields', () => {
  assert.match(statusRoute, /cookies\(\)/)
  assert.match(statusRoute, /KAKAOPAY_RESULT_COOKIE/)
  assert.match(statusRoute, /hashOpaqueToken/)
  assert.match(statusRoute, /payment_provider_transactions/)
  assert.match(statusRoute, /Cache-Control/)
  assert.doesNotMatch(statusRoute, /provider_transaction_id[\s\S]*NextResponse\.json/)
  assert.doesNotMatch(statusRoute, /provider_approval_id[\s\S]*NextResponse\.json/)
  assert.doesNotMatch(statusRoute, /partner_user_id[\s\S]*NextResponse\.json/)
})

test('result page uses the Studio frame without exposing callback secrets', () => {
  assert.match(resultPage, /studio-theme/)
  assert.match(resultPage, /StudioContainer/)
  assert.match(resultPage, /var\(--studio-/)
  assert.doesNotMatch(resultPage, /searchParams.*(?:state|pg_token|token)/)
  assert.doesNotMatch(resultPage, /#[0-9a-f]{3,8}/i)
})
