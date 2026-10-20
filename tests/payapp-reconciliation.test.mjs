import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadModule(path, modules) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  const stubRequire = (name) => {
    if (name === 'server-only') return {}
    if (name in modules) return modules[name]
    return require(name)
  }
  new Function('exports', 'require', code)(loaded.exports, stubRequire)
  return loaded.exports
}

class PayAppError extends Error {
  constructor(code, outcome = 'definite_failure') {
    super(code)
    this.code = code
    this.outcome = outcome
  }
}
class KakaoPayError extends Error {}
class RefundRpcError extends Error {
  constructor(code, retryable = false) {
    super(code)
    this.code = code
    this.retryable = retryable
  }
}

const ORDER_UUID = '00000000-0000-4000-8000-000000000001'
const USER_UUID = '00000000-0000-4000-8000-000000000002'
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()

// 테스트마다 DB 행·RPC 응답·결제사 응답을 바꿔 끼우는 가짜 환경.
function createWorld({ order, transaction = {}, refunds = [], rpc = {}, payapp = {}, kakao = {} }) {
  const calls = { rpc: [], cancel: [], followUps: [], kakaoRpc: [] }

  const admin = {
    from(table) {
      const filters = {}
      const query = {
        select: () => query,
        eq(column, value) {
          filters[column] = value
          return query
        },
        maybeSingle() {
          if (table === 'payment_orders') return Promise.resolve({ data: order, error: null })
          if (table === 'payment_provider_transactions') {
            return Promise.resolve({ data: { provider_transaction_id: null, ...transaction }, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
        then(resolve) {
          const rows = table === 'refund_requests'
            ? refunds.filter((row) => row.status === filters.status)
            : []
          return Promise.resolve({ data: rows, error: null }).then(resolve)
        },
      }
      return query
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args })
      const handler = rpc[name]
      if (!handler) throw new Error(`unexpected rpc ${name}`)
      return handler(args)
    },
  }

  const reconciliation = loadModule('../src/lib/payment-reconciliation-server.ts', {
    '@/lib/payment-orders-server': { createPaymentAdminClient: () => admin },
    '@/lib/payapp-server': {
      PayAppError,
      cancelPayAppPayment: async (input) => {
        calls.cancel.push(input)
        if (payapp.cancel) return payapp.cancel(input)
      },
    },
    '@/lib/payapp-webhook-server': {
      cancellationFollowUps: (details, result) => ({ alerts: [{ code: `CANCEL:${result.result}`, details }] }),
      runFollowUps: async (_admin, followUps) => {
        calls.followUps.push(followUps)
      },
    },
    '@/lib/point-charge-refunds-server': {
      RefundRpcError,
      finalizePointChargeRefund: async () => ({}),
      quarantineExternalProviderCancellation: async () => ({}),
      recordKakaoPayPartialCancelMarker: async (input) => {
        calls.kakaoRpc.push({ name: 'marker', input })
      },
      quarantineKakaoPayPartialCancellation: async (input) => {
        calls.kakaoRpc.push({ name: 'quarantine', input })
        return kakao.quarantine ?? { outcome: 'manual_review' }
      },
    },
    '@/lib/kakaopay-server': {
      KakaoPayError,
      getKakaoPayOrder: async () => {
        if (kakao.lookupFails) throw new KakaoPayError('lookup failed')
        return kakao.order
      },
      getCompletedKakaoPayPayment: () => ({}),
      validateCompletedKakaoPayCancellation: () => ({}),
      validateKakaoPayOrderSnapshot: () => {
        if (kakao.snapshotMismatch) throw new Error('mismatch')
      },
    },
  })

  return { calls, reconcile: () => reconciliation.reconcilePaymentOrder(order.order_id) }
}

const payappOrder = (overrides = {}) => ({
  id: ORDER_UUID,
  user_id: USER_UUID,
  order_id: 'PAYAPP_ORDER_1',
  provider: 'payapp',
  status: 'ready',
  ready_expires_at: minutesAgo(-10),
  checkout_expires_at: minutesAgo(-10),
  ...overrides,
})

const ok = (data) => ({ data, error: null })
const rpcError = (message) => ({ data: null, error: { message } })
const terminal = (changed = true) => ({ mark_payapp_order_terminal: () => ok({ changed }) })

test('pending cancel markers are processed first whatever the order status', async () => {
  for (const [result, outcome] of [
    ['refund_finalized', 'refund_finalized'],
    ['cancelled_before_fulfillment', 'payment_failed'],
    ['nothing_to_process', 'already_completed'],
    ['already_refunded', 'already_completed'],
    ['already_quarantined', 'already_completed'],
    ['double_refund_suspected', 'already_completed'],
    ['partial_cancel_after_cancel', 'already_completed'],
    ['deferred_refund_processing', 'provider_not_final'],
    ['external_cancel_quarantined', 'manual_review'],
    ['partial_cancel_quarantined', 'manual_review'],
    ['partial_cancel_unpaid', 'manual_review'],
    ['cancel_handling_failed', 'manual_review'],
  ]) {
    const world = createWorld({
      order: payappOrder({ status: 'fulfillment_pending' }),
      transaction: { cancel_feedback_recorded_at: minutesAgo(1), cancel_processed_at: null },
      rpc: { process_payapp_cancellation: () => ok({ result }) },
    })
    assert.equal(await world.reconcile(), outcome, result)
    assert.equal(world.calls.rpc[0].name, 'process_payapp_cancellation', result)
    assert.equal(world.calls.followUps[0].alerts[0].code, `CANCEL:${result}`)
  }

  const partial = createWorld({
    order: payappOrder({ status: 'completed' }),
    transaction: { partial_cancel_feedback_recorded_at: minutesAgo(1), partial_cancel_processed_at: null },
    rpc: { process_payapp_cancellation: () => ok({ result: 'partial_cancel_quarantined' }) },
  })
  assert.equal(await partial.reconcile(), 'manual_review')

  const lockFailure = createWorld({
    order: payappOrder({ status: 'completed' }),
    transaction: { cancel_feedback_recorded_at: minutesAgo(1), cancel_processed_at: null },
    rpc: { process_payapp_cancellation: () => ({ data: null, error: { code: '40P01', message: 'deadlock detected' } }) },
  })
  await assert.rejects(lockFailure.reconcile(), /40P01/)
})

test('a paid but unfulfilled order is retried and escalated after the limit', async () => {
  const fulfilled = createWorld({
    order: payappOrder({ status: 'fulfillment_pending' }),
    rpc: { retry_payapp_fulfillment: () => ok({ result: 'fulfilled' }) },
  })
  assert.equal(await fulfilled.reconcile(), 'payment_fulfilled')
  assert.equal(fulfilled.calls.followUps[0].userNotification.userId, USER_UUID)

  const failed = createWorld({
    order: payappOrder({ status: 'fulfillment_pending' }),
    rpc: { retry_payapp_fulfillment: () => ok({ result: 'retry_failed' }) },
  })
  await assert.rejects(failed.reconcile(), /PAYAPP_FULFILLMENT_RETRY_REQUIRED/)

  const exhausted = createWorld({
    order: payappOrder({ status: 'fulfillment_pending' }),
    rpc: { retry_payapp_fulfillment: () => ok({ result: 'retry_exhausted' }) },
  })
  assert.equal(await exhausted.reconcile(), 'manual_review')
  assert.equal(exhausted.calls.followUps[0].alerts[0].code, 'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED')
  assert.equal(exhausted.calls.followUps[0].alerts[0].notifyAdmins, true)

  const already = createWorld({
    order: payappOrder({ status: 'fulfillment_pending' }),
    rpc: { retry_payapp_fulfillment: () => ok({ result: 'already_fulfilled' }) },
  })
  assert.equal(await already.reconcile(), 'already_completed')
})

test('unsent and unknown requests expire only after their deadline', async () => {
  const fresh = createWorld({ order: payappOrder({ status: 'preparing' }) })
  assert.equal(await fresh.reconcile(), 'provider_not_final')
  assert.equal(fresh.calls.rpc.length, 0)

  const stale = createWorld({
    order: payappOrder({ status: 'preparing', ready_expires_at: minutesAgo(1) }),
    rpc: terminal(),
  })
  assert.equal(await stale.reconcile(), 'payment_expired')
  assert.equal(stale.calls.rpc[0].args.p_expected_status, 'preparing')

  const raced = createWorld({
    order: payappOrder({ status: 'preparing', ready_expires_at: minutesAgo(1) }),
    rpc: terminal(false),
  })
  assert.equal(await raced.reconcile(), 'provider_not_final')

  const unknown = createWorld({
    order: payappOrder({ status: 'ready_unknown', ready_expires_at: minutesAgo(1) }),
    transaction: { provider_transaction_id: '2000' },
    payapp: { cancel: () => Promise.reject(new PayAppError('PAYAPP_REQUEST_REJECTED')) },
    rpc: terminal(),
  })
  assert.equal(await unknown.reconcile(), 'payment_expired')
  assert.deepEqual(unknown.calls.cancel[0], { mulNo: '2000', memo: '결제 요청 만료', mode: 'ready' })

  // 결제완료가 기록된 주문은 만료하지 않고 지급 경로에 맡긴다.
  const paid = createWorld({
    order: payappOrder({ status: 'ready_unknown', ready_expires_at: minutesAgo(1) }),
    rpc: { mark_payapp_order_terminal: () => rpcError('PAYMENT_PAID_ORDER_NOT_TERMINABLE') },
  })
  assert.equal(await paid.reconcile(), 'provider_not_final')
  assert.equal(paid.calls.cancel.length, 0)
})

test('expired payment requests are cancelled at PayApp before expiring the order', async () => {
  const cancelled = createWorld({
    order: payappOrder({ status: 'ready', ready_expires_at: minutesAgo(5) }),
    transaction: { provider_transaction_id: '2000' },
    rpc: terminal(),
  })
  assert.equal(await cancelled.reconcile(), 'payment_expired')
  assert.equal(cancelled.calls.cancel[0].mode, 'ready')
  assert.equal(cancelled.calls.rpc[0].args.p_status, 'expired')

  const retry = createWorld({
    order: payappOrder({ status: 'ready', ready_expires_at: minutesAgo(5) }),
    transaction: { provider_transaction_id: '2000' },
    payapp: { cancel: () => Promise.reject(new PayAppError('PAYAPP_REQUEST_TIMEOUT', 'outcome_unknown')) },
  })
  await assert.rejects(retry.reconcile(), /PAYAPP_REQUEST_TIMEOUT/)
  assert.equal(retry.calls.rpc.length, 0)

  const escalated = createWorld({
    order: payappOrder({ status: 'ready', ready_expires_at: minutesAgo(121) }),
    transaction: { provider_transaction_id: '2000' },
    payapp: { cancel: () => Promise.reject(new PayAppError('PAYAPP_REQUEST_REJECTED')) },
    rpc: terminal(),
  })
  assert.equal(await escalated.reconcile(), 'manual_review')
  assert.equal(escalated.calls.rpc[0].args.p_failure_code, 'PAYAPP_READY_CANCEL_FAILED')

  const notExpired = createWorld({ order: payappOrder({ status: 'ready' }) })
  assert.equal(await notExpired.reconcile(), 'provider_not_final')
  assert.equal(notExpired.calls.cancel.length, 0)
})

test('stuck PayApp refunds are requeued without automatic retries', async () => {
  const stuck = createWorld({
    order: payappOrder({ status: 'completed' }),
    refunds: [{ id: 'refund-1', status: 'processing' }],
    rpc: { requeue_stuck_point_charge_refund: () => ok({ changed: true }) },
  })
  assert.equal(await stuck.reconcile(), 'already_completed')
  assert.equal(stuck.calls.rpc[0].args.p_request_id, 'refund-1')

  const recent = createWorld({
    order: payappOrder({ status: 'completed' }),
    refunds: [{ id: 'refund-1', status: 'processing' }],
    rpc: { requeue_stuck_point_charge_refund: () => ok({ changed: false }) },
  })
  assert.equal(await recent.reconcile(), 'provider_not_final')

  const idle = createWorld({ order: payappOrder({ status: 'completed' }) })
  assert.equal(await idle.reconcile(), 'already_completed')
})

const kakaoOrder = (overrides = {}) => ({
  id: ORDER_UUID,
  user_id: USER_UUID,
  order_id: 'KAKAO_ORDER_1',
  provider: 'kakaopay',
  status: 'completed',
  provider_merchant_id: 'CID',
  partner_order_id: 'KAKAO_ORDER_1',
  partner_user_id: 'usr_1',
  expected_amount: 9900,
  tax_free_amount: 0,
  vat_amount: 900,
  ready_expires_at: minutesAgo(30),
  checkout_expires_at: minutesAgo(30),
  ...overrides,
})

test('KakaoPay partial cancels record a marker and quarantine instead of a bare manual review', async () => {
  const world = createWorld({
    order: kakaoOrder(),
    transaction: { provider_transaction_id: 'T1' },
    kakao: { order: { status: 'PART_CANCEL_PAYMENT', canceled_amount: { total: 3000 } } },
  })
  assert.equal(await world.reconcile(), 'manual_review')
  assert.deepEqual(world.calls.kakaoRpc, [
    { name: 'marker', input: { paymentOrderId: ORDER_UUID, providerStatus: 'PART_CANCEL_PAYMENT' } },
    { name: 'quarantine', input: { paymentOrderId: ORDER_UUID, providerStatus: 'PART_CANCEL_PAYMENT', cancelledAmount: 3000 } },
  ])
  assert.equal(world.calls.rpc.length, 0)
})

test('a pending KakaoPay marker is quarantined whatever the provider now reports', async () => {
  for (const kakao of [
    { order: { status: 'CANCEL_PAYMENT', canceled_amount: { total: 9900 } } },
    { order: { status: 'SUCCESS_PAYMENT' }, snapshotMismatch: true },
  ]) {
    const world = createWorld({
      order: kakaoOrder(),
      transaction: {
        provider_transaction_id: 'T1',
        partial_cancel_feedback_recorded_at: minutesAgo(5),
        partial_cancel_processed_at: null,
      },
      kakao: { ...kakao, quarantine: { outcome: 'manual_review', state_unexpected: kakao.order.status === 'SUCCESS_PAYMENT' } },
    })
    assert.equal(await world.reconcile(), 'manual_review', kakao.order.status)
    assert.deepEqual(world.calls.kakaoRpc.map((call) => call.name), ['quarantine'], kakao.order.status)
    assert.equal(world.calls.kakaoRpc[0].input.providerStatus, kakao.order.status)
    assert.equal(
      world.calls.followUps[0].alerts[0].code,
      kakao.order.status === 'SUCCESS_PAYMENT'
        ? 'KAKAOPAY_PARTIAL_CANCEL_STATE_UNEXPECTED'
        : 'KAKAOPAY_PARTIAL_CANCEL_THEN_FULLY_CANCELLED'
    )
  }

  const repeated = createWorld({
    order: kakaoOrder(),
    transaction: {
      provider_transaction_id: 'T1',
      partial_cancel_feedback_recorded_at: minutesAgo(5),
      partial_cancel_processed_at: minutesAgo(1),
    },
    kakao: { order: { status: 'PART_CANCEL_PAYMENT' }, quarantine: { outcome: 'already_processed' } },
  })
  assert.equal(await repeated.reconcile(), 'already_completed')
})

test('a pending KakaoPay marker is quarantined even without a stored snapshot', async () => {
  const world = createWorld({
    order: kakaoOrder({ partner_user_id: null }),
    transaction: {
      provider_transaction_id: 'T1',
      partial_cancel_feedback_recorded_at: minutesAgo(5),
      partial_cancel_processed_at: null,
    },
    kakao: { order: { status: 'PART_CANCEL_PAYMENT', canceled_amount: { total: 3000 } } },
  })
  assert.equal(await world.reconcile(), 'manual_review')
  assert.equal(world.calls.kakaoRpc.at(-1).name, 'quarantine')
  assert.equal(world.calls.rpc.length, 0)

  const lookupFails = createWorld({
    order: kakaoOrder(),
    transaction: {
      provider_transaction_id: 'T1',
      partial_cancel_feedback_recorded_at: minutesAgo(5),
      partial_cancel_processed_at: null,
    },
    kakao: { lookupFails: true },
  })
  await assert.rejects(lookupFails.reconcile(), /lookup failed/)
  assert.equal(lookupFails.calls.kakaoRpc.length, 0)
})

test('a deferred partial cancel requeues a stuck refund so the next run can quarantine it', async () => {
  const world = createWorld({
    order: payappOrder({ status: 'completed' }),
    transaction: { partial_cancel_feedback_recorded_at: minutesAgo(30), partial_cancel_processed_at: null },
    refunds: [{ id: 'refund-1', status: 'processing' }],
    rpc: {
      process_payapp_cancellation: () => ok({ result: 'deferred_refund_processing' }),
      requeue_stuck_point_charge_refund: () => ok({ changed: true }),
    },
  })
  assert.equal(await world.reconcile(), 'provider_not_final')
  assert.deepEqual(world.calls.rpc.map((call) => call.name), [
    'process_payapp_cancellation',
    'requeue_stuck_point_charge_refund',
  ])
  assert.equal(world.calls.followUps.at(-1).alerts[0].code, 'PAYAPP_REFUND_PROCESSING_STUCK')
})

test('a paid order that cannot be fulfilled automatically goes to manual review with an alert', async () => {
  const world = createWorld({
    order: payappOrder({ status: 'fulfillment_pending' }),
    rpc: {
      retry_payapp_fulfillment: () => ok({ result: 'not_retryable' }),
      ...terminal(),
    },
  })
  assert.equal(await world.reconcile(), 'manual_review')
  assert.equal(world.calls.rpc[1].args.p_expected_status, 'fulfillment_pending')
  assert.equal(world.calls.followUps[0].alerts[0].code, 'PAYAPP_FULFILLMENT_NOT_RETRYABLE')
})

test('an expired request without a mul_no goes straight to manual review', async () => {
  const world = createWorld({
    order: payappOrder({ status: 'ready', ready_expires_at: minutesAgo(5) }),
    rpc: terminal(),
  })
  assert.equal(await world.reconcile(), 'manual_review')
  assert.equal(world.calls.cancel.length, 0)
  assert.equal(world.calls.rpc[0].args.p_failure_code, 'PAYAPP_READY_CANCEL_FAILED')
})

test('only one cancel marker is processed per run; the other stays for the next run', async () => {
  const world = createWorld({
    order: payappOrder({ status: 'completed' }),
    transaction: {
      cancel_feedback_recorded_at: minutesAgo(2),
      cancel_processed_at: null,
      partial_cancel_feedback_recorded_at: minutesAgo(3),
      partial_cancel_processed_at: null,
    },
    rpc: { process_payapp_cancellation: () => ok({ result: 'external_cancel_quarantined', marker: 'cancel' }) },
  })
  assert.equal(await world.reconcile(), 'manual_review')
  assert.equal(world.calls.rpc.filter((call) => call.name === 'process_payapp_cancellation').length, 1)
})

test('a historical Toss order is sent to manual review as an unsupported provider', async () => {
  const world = createWorld({
    order: { id: ORDER_UUID, user_id: USER_UUID, order_id: 'TOSS_ORDER_1', provider: 'toss', status: 'ready', provider_status: null },
    rpc: { mark_payment_reconciliation_terminal: () => ok(null) },
  })
  assert.equal(await world.reconcile(), 'manual_review')
  assert.equal(world.calls.rpc[0].args.p_failure_code, 'PAYMENT_PROVIDER_UNSUPPORTED')
})
