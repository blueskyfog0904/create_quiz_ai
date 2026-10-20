import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const status = (() => {
  const code = ts.transpileModule(
    readFileSync(new URL('../src/lib/payapp-order-status.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText
  const loaded = { exports: {} }
  new Function('exports', 'require', code)(loaded.exports, () => ({}))
  return loaded.exports
})()

const NOW = Date.parse('2026-10-20T00:00:00.000Z')
const inMinutes = (minutes) => new Date(NOW + minutes * 60_000).toISOString()

test('a repeated attempt reuses a payurl only while more than two minutes remain', () => {
  assert.equal(status.classifyExistingPayAppOrder('ready', inMinutes(10), NOW), 'reuse_payurl')
  assert.equal(status.classifyExistingPayAppOrder('ready', inMinutes(2), NOW), 'expired')
  assert.equal(status.classifyExistingPayAppOrder('ready', inMinutes(-1), NOW), 'expired')
  assert.equal(status.classifyExistingPayAppOrder('ready', null, NOW), 'expired')
})

test('orders that may have been paid send the user to the result page instead of paying again', () => {
  for (const orderStatus of [
    'completed',
    'fulfillment_pending',
    'manual_review',
    'refunded',
    'cancel_pending',
    'confirming',
  ]) {
    assert.equal(status.classifyExistingPayAppOrder(orderStatus, null, NOW), 'show_result', orderStatus)
  }
})

test('unknown and closed attempts are reported without a new payrequest', () => {
  assert.equal(status.classifyExistingPayAppOrder('ready_unknown', inMinutes(10), NOW), 'unknown')
  assert.equal(status.classifyExistingPayAppOrder('preparing', inMinutes(10), NOW), 'unknown')
  assert.equal(status.classifyExistingPayAppOrder('failed', null, NOW), 'expired')
  assert.equal(status.classifyExistingPayAppOrder('expired', null, NOW), 'expired')
})

test('public status shows payment review states as pending', () => {
  assert.deepEqual(
    Object.fromEntries([
      'completed',
      'refunded',
      'failed',
      'expired',
      'fulfillment_pending',
      'manual_review',
      'ready',
      'ready_unknown',
      'preparing',
      'cancel_pending',
    ].map((value) => [value, status.publicPayAppStatus(value)])),
    {
      completed: 'completed',
      refunded: 'refunded',
      failed: 'failed',
      expired: 'expired',
      fulfillment_pending: 'pending',
      manual_review: 'pending',
      ready: 'pending',
      ready_unknown: 'pending',
      preparing: 'pending',
      cancel_pending: 'pending',
    }
  )
})

test('profile phone numbers are saved in the hyphenated profile format', () => {
  const profileFormat = /^01[016789]-\d{3,4}-\d{4}$/
  assert.equal(status.formatProfilePhone('01012345678'), '010-1234-5678')
  assert.equal(status.formatProfilePhone('0111234567'), '011-123-4567')
  assert.match(status.formatProfilePhone('01012345678'), profileFormat)
  assert.match(status.formatProfilePhone('0111234567'), profileFormat)
})
