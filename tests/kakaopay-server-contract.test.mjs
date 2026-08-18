import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const adapterUrl = new URL('../src/lib/kakaopay-server.ts', import.meta.url)
const adapter = existsSync(adapterUrl) ? readFileSync(adapterUrl, 'utf8') : ''

const section = (start, end) => {
  const startIndex = adapter.indexOf(start)
  const endIndex = adapter.indexOf(end, startIndex + start.length)
  return startIndex >= 0 && endIndex > startIndex
    ? adapter.slice(startIndex, endIndex)
    : ''
}

test('KakaoPay adapter is server-only and uses the current JSON API contract', () => {
  assert.match(adapter, /import 'server-only'/)
  assert.match(adapter, /https:\/\/open-api\.kakaopay\.com/)
  assert.match(adapter, /\/online\/v1\/payment\/ready/)
  assert.match(adapter, /\/online\/v1\/payment\/approve/)
  assert.match(adapter, /\/online\/v1\/payment\/order/)
  assert.match(adapter, /\/online\/v1\/payment\/cancel/)
  assert.match(adapter, /Authorization:\s*`SECRET_KEY \$\{input\.config\.secretKey\}`/)
  assert.match(adapter, /'Content-Type':\s*'application\/json'/)
  assert.doesNotMatch(adapter, /KakaoAK/)
})

test('configuration is fail-closed for provider flags, environment, CID and callback origin', () => {
  assert.match(adapter, /PAYMENTS_ENABLED\s*!==\s*'true'/)
  assert.match(adapter, /KAKAOPAY_PAYMENTS_ENABLED\s*!==\s*'true'/)
  assert.match(adapter, /KAKAOPAY_ENVIRONMENT/)
  assert.match(adapter, /environment === 'test' && cid !== 'TC0ONETIME'/)
  assert.match(adapter, /environment === 'live' && cid === 'TC0ONETIME'/)
  assert.match(adapter, /callbackUrl\.protocol !== 'https:'/)
  assert.match(adapter, /callbackUrl\.origin !== config\.callbackOrigin/)
  assert.match(adapter, /callbackUrl\.href\.length > 255/)
})

test('disabling new orders does not disable existing payment recovery', () => {
  const ready = section('export async function readyKakaoPayPayment', 'export async function approveKakaoPayPayment')
  const approve = section('export async function approveKakaoPayPayment', 'export async function getKakaoPayOrder')
  const order = section('export async function getKakaoPayOrder', 'export async function cancelKakaoPayPayment')
  const cancel = section('export async function cancelKakaoPayPayment', 'interface ExpectedKakaoPayment')

  assert.match(ready, /assertKakaoPayReady\(\)/)
  assert.match(approve, /getKakaoPayConfig\('approve'\)/)
  assert.match(order, /getKakaoPayConfig\('order'\)/)
  assert.match(cancel, /getKakaoPayConfig\('cancel'\)/)
})

test('ready is server-priced, VAT-inclusive and MONEY-only', () => {
  const ready = section('export async function readyKakaoPayPayment', 'export async function approveKakaoPayPayment')

  assert.match(ready, /payment_method_type:\s*'MONEY'/)
  assert.match(ready, /total_amount:\s*input\.totalAmount/)
  assert.match(ready, /tax_free_amount:\s*input\.taxFreeAmount/)
  assert.match(ready, /vat_amount:\s*input\.vatAmount/)
  assert.doesNotMatch(ready, /input\.paymentMethodType/)
})

test('approve response does not invent a status and fresh order validation is exhaustive', () => {
  const approveSchema = section('const kakaoApproveResponseSchema', 'const kakaoOrderResponseSchema')

  assert.doesNotMatch(approveSchema, /\bstatus:/)
  assert.match(adapter, /SUCCESS_PAYMENT/)
  assert.match(adapter, /PART_CANCEL_PAYMENT/)
  assert.match(adapter, /CANCEL_PAYMENT/)
  assert.match(adapter, /AUTH_PASSWORD/)
  assert.match(adapter, /FAIL_PAYMENT/)
  assert.match(adapter, /validateApprovedKakaoPayPayment/)
  assert.match(adapter, /validateFreshKakaoPayOrder/)
  assert.match(adapter, /payment_action_details/)
})

test('network outcomes are bounded and never leak provider secrets', () => {
  assert.match(adapter, /AbortController/)
  assert.match(adapter, /KAKAOPAY_REQUEST_TIMEOUT_MS\s*=\s*11_000/)
  assert.match(adapter, /outcome:\s*'outcome_unknown'/)
  assert.match(adapter, /outcome:\s*'definite_failure'/)
  assert.doesNotMatch(adapter, /console\./)
  assert.doesNotMatch(adapter, /error_message/)
})
