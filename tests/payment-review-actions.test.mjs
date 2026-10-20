import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const actions = (() => {
  const code = ts.transpileModule(
    readFileSync(new URL('../src/lib/payment-review-actions.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText
  const loaded = { exports: {} }
  new Function('exports', code)(loaded.exports)
  return loaded.exports
})()

const facts = (overrides = {}) => ({
  provider: 'payapp',
  failureCode: 'PAYAPP_READY_CANCEL_FAILED',
  hasTransaction: true,
  hasSource: false,
  sourceRefunded: false,
  paidRecorded: false,
  adminPaidConfirmed: false,
  cancelMarker: false,
  partialCancelMarker: false,
  ...overrides,
})

test('an unpaid PayApp order can be confirmed paid or unpaid', () => {
  assert.deepEqual(actions.allowedReviewActions(facts()), ['paid_confirmed', 'unpaid_confirmed'])
})

test('an order without a PayApp transaction cannot be confirmed paid', () => {
  assert.deepEqual(actions.allowedReviewActions(facts({ hasTransaction: false })), ['unpaid_confirmed'])
})

test('a PayApp order with a paid record cannot be closed as unpaid', () => {
  assert.deepEqual(
    actions.allowedReviewActions(facts({ failureCode: 'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED', paidRecorded: true })),
    ['paid_confirmed']
  )
})

test('cancelled or partially cancelled orders only allow cancel handling for the listed codes', () => {
  assert.deepEqual(
    actions.allowedReviewActions(facts({ failureCode: 'PAYAPP_PARTIAL_CANCEL', partialCancelMarker: true })),
    ['cancel_handled']
  )
  assert.deepEqual(
    actions.allowedReviewActions(facts({ failureCode: 'PAYAPP_CANCEL_HANDLING_FAILED', hasSource: true })),
    []
  )
  assert.deepEqual(
    actions.allowedReviewActions(facts({ failureCode: 'PAYAPP_CANCEL_HANDLING_FAILED', hasSource: true, sourceRefunded: true })),
    ['cancel_handled']
  )
  assert.deepEqual(
    actions.allowedReviewActions(facts({ failureCode: 'PAYAPP_PARTIAL_CANCEL_QUARANTINED', hasSource: true, partialCancelMarker: true })),
    []
  )
})

test('KakaoPay and Toss orders are never confirmed paid or unpaid here', () => {
  assert.deepEqual(
    actions.allowedReviewActions(facts({ provider: 'kakaopay', failureCode: 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW' })),
    ['cancel_handled']
  )
  assert.deepEqual(actions.allowedReviewActions(facts({ provider: 'kakaopay', failureCode: 'KAKAOPAY_READY_OUTCOME_UNKNOWN' })), [])
  assert.deepEqual(actions.allowedReviewActions(facts({ provider: 'toss', failureCode: 'TOSS_UNKNOWN_STATUS' })), [])
})

test('partial cancel refunds require an explicit recovery amount', () => {
  assert.equal(actions.refundRequiresRecovery({ origin: 'partial_cancel', partialCancelMarker: false, lastErrorCode: null }), true)
  assert.equal(actions.refundRequiresRecovery({ origin: 'external_cancel', partialCancelMarker: true, lastErrorCode: null }), true)
  assert.equal(actions.refundRequiresRecovery({ origin: 'user', partialCancelMarker: false, lastErrorCode: 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW' }), true)
  assert.equal(actions.refundRequiresRecovery({ origin: 'external_cancel', partialCancelMarker: false, lastErrorCode: 'EXTERNAL_PROVIDER_CANCELLATION' }), false)
})
