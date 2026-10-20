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
  constructor(code, outcome, providerMessage = null) {
    super('페이앱 요청을 처리하지 못했습니다.')
    this.code = code
    this.outcome = outcome
    this.status = 502
    this.providerMessage = providerMessage
  }
}
class KakaoPayError extends Error {
  constructor(code, outcome) {
    super('카카오페이 요청을 처리하지 못했습니다.')
    this.code = code
    this.outcome = outcome
    this.status = 400
  }
}
class RefundRpcError extends Error {
  constructor(code, retryable = false) {
    super('환불 요청을 처리하지 못했습니다.')
    this.code = code
    this.retryable = retryable
  }
}

function createProcessor({ claimed, payapp = {}, kakao = {}, finalize, requestStatus = 'processing', statusAfterFail, markerThrows = false }) {
  const calls = { cancel: [], finalize: [], fail: [], kakaoRpc: [], order: [] }
  let currentStatus = requestStatus
  const processor = loadModule('../src/lib/point-charge-refund-processor.ts', {
    '@/lib/payapp-server': {
      PayAppError,
      cancelPayAppPayment: async (input) => {
        calls.cancel.push(input)
        if (payapp.cancel) return payapp.cancel(input)
      },
    },
    '@/lib/payment-orders-server': {
      createPaymentAdminClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { status: currentStatus }, error: null }) }),
          }),
        }),
      }),
    },
    '@/lib/point-charge-refunds-server': {
      RefundRpcError,
      claimPointChargeRefund: async () => claimed,
      finalizePointChargeRefund: async (input) => {
        calls.finalize.push(input)
        if (finalize) return finalize(input)
        return { already_completed: false, new_balance: 0 }
      },
      failPointChargeRefund: async (input) => {
        calls.fail.push(input)
        calls.order.push('fail')
        if (statusAfterFail) currentStatus = statusAfterFail
      },
      recordKakaoPayPartialCancelMarker: async (input) => {
        calls.kakaoRpc.push({ name: 'marker', input })
        calls.order.push('marker')
        if (markerThrows) throw new RefundRpcError('40P01', true)
      },
      quarantineKakaoPayPartialCancellation: async (input) => {
        calls.kakaoRpc.push({ name: 'quarantine', input })
        calls.order.push('quarantine')
        return { outcome: 'manual_review' }
      },
    },
    '@/lib/kakaopay-server': {
      KakaoPayError,
      getKakaoPayOrder: async () => {
        kakao.lookups = (kakao.lookups ?? 0) + 1
        return kakao.orders[Math.min(kakao.lookups, kakao.orders.length) - 1]
      },
      cancelKakaoPayPayment: async () => {
        if (kakao.cancel) return kakao.cancel()
        return {}
      },
      validateCompletedKakaoPayCancellation: () => ({}),
      validateFreshKakaoPayOrder: () => undefined,
      validateFullKakaoPayCancellation: () => ({ transactionKey: 'A', canceledAt: 'now', providerStatus: 'CANCEL_PAYMENT' }),
    },
  })

  return {
    calls,
    run: () => processor.processPointChargeRefund({ requestId: 'refund-1', adminId: 'admin-1', adminNote: null }),
  }
}

const payappClaim = {
  already_completed: false,
  request_id: 'refund-1',
  user_id: 'user-1',
  provider: 'payapp',
  payment_order_id: 'order-1',
  provider_transaction_id: '2000',
  refund_amount: 9900,
}

test('a PayApp refund is a full paycancel finalized with the PayApp cancel key', async () => {
  const processor = createProcessor({ claimed: payappClaim })
  const result = await processor.run()

  assert.equal(result.alreadyCompleted, false)
  assert.deepEqual(processor.calls.cancel, [{ mulNo: '2000', memo: '환불 요청 refund-1' }])
  assert.equal(processor.calls.finalize[0].cancelTransactionKey, 'payapp-cancel:2000')
  assert.equal(processor.calls.finalize[0].providerStatus, 'CANCELED')
  assert.equal(processor.calls.fail.length, 0)
})

test('a PayApp rejection goes to manual review with the provider message kept', async () => {
  const processor = createProcessor({
    claimed: payappClaim,
    payapp: { cancel: () => Promise.reject(new PayAppError('PAYAPP_REQUEST_REJECTED', 'definite_failure', '정산 완료 건')) },
  })

  await assert.rejects(processor.run(), { code: 'PAYAPP_REQUEST_REJECTED', retryable: false })
  assert.equal(processor.calls.fail[0].retryable, false)
  assert.match(processor.calls.fail[0].message, /정산 완료 건/)
})

test('PayApp timeouts leave the refund retryable', async () => {
  const processor = createProcessor({
    claimed: payappClaim,
    payapp: { cancel: () => Promise.reject(new PayAppError('PAYAPP_REQUEST_TIMEOUT', 'outcome_unknown')) },
  })

  await assert.rejects(processor.run(), { code: 'PAYAPP_REQUEST_TIMEOUT', retryable: true })
  assert.equal(processor.calls.fail[0].retryable, true)
})

test('a refund completed by a webhook meanwhile is reported as done without failing it', async () => {
  const processor = createProcessor({
    claimed: payappClaim,
    finalize: () => Promise.reject(new RefundRpcError('40P01', true)),
    requestStatus: 'completed',
  })

  const result = await processor.run()
  assert.equal(result.alreadyCompleted, true)
  assert.equal(processor.calls.fail.length, 0)
})

test('database error codes survive normalization so lock failures stay retryable', async () => {
  const processor = createProcessor({
    claimed: payappClaim,
    finalize: () => Promise.reject(new RefundRpcError('REFUND_REQUEST_REVALIDATION_FAILED', false)),
  })

  await assert.rejects(processor.run(), { code: 'REFUND_REQUEST_REVALIDATION_FAILED', retryable: false })

  const lock = createProcessor({
    claimed: payappClaim,
    finalize: () => Promise.reject(new RefundRpcError('40001', true)),
  })
  await assert.rejects(lock.run(), { code: '40001', retryable: true })
  assert.equal(lock.calls.fail[0].retryable, true)
})

const kakaoClaim = {
  already_completed: false,
  request_id: 'refund-2',
  provider: 'kakaopay',
  payment_order_id: 'order-2',
  provider_transaction_id: 'T1',
  provider_approval_id: 'A1',
  provider_merchant_id: 'CID',
  partner_order_id: 'K1',
  partner_user_id: 'usr_1',
  refund_amount: 9900,
  tax_free_amount: 0,
  vat_amount: 900,
}

test('a KakaoPay partial cancel found before cancelling fails the refund then quarantines it', async () => {
  const processor = createProcessor({
    claimed: kakaoClaim,
    kakao: { orders: [{ status: 'PART_CANCEL_PAYMENT', canceled_amount: { total: 3000 } }] },
  })

  await assert.rejects(processor.run(), { code: 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW' })
  assert.equal(processor.calls.fail[0].retryable, false)
  assert.deepEqual(processor.calls.order, ['fail', 'marker', 'quarantine'])
  assert.deepEqual(processor.calls.kakaoRpc, [
    { name: 'marker', input: { paymentOrderId: 'order-2', providerStatus: 'PART_CANCEL_PAYMENT' } },
    { name: 'quarantine', input: { paymentOrderId: 'order-2', providerStatus: 'PART_CANCEL_PAYMENT', cancelledAmount: 3000 } },
  ])
})

test('a definite KakaoPay cancel failure re-reads the order and quarantines a partial cancel', async () => {
  const processor = createProcessor({
    claimed: kakaoClaim,
    kakao: {
      orders: [
        { status: 'SUCCESS_PAYMENT' },
        { status: 'PART_CANCEL_PAYMENT', canceled_amount: { total: 3000 } },
      ],
      cancel: () => Promise.reject(new KakaoPayError('KAKAOPAY_-780', 'definite_failure')),
    },
  })

  await assert.rejects(processor.run(), { code: 'KAKAOPAY_-780', retryable: false })
  assert.deepEqual(processor.calls.kakaoRpc.map((call) => call.name), ['marker', 'quarantine'])

  // 결과를 알 수 없는 실패는 다시 조회하지 않는다(재시도로 처리).
  const unknown = createProcessor({
    claimed: kakaoClaim,
    kakao: {
      orders: [{ status: 'SUCCESS_PAYMENT' }],
      cancel: () => Promise.reject(new KakaoPayError('KAKAOPAY_REQUEST_TIMEOUT', 'outcome_unknown')),
    },
  })
  await assert.rejects(unknown.run(), { retryable: true })
  assert.equal(unknown.calls.kakaoRpc.length, 0)
})

test('refund RPC errors keep their database code alongside the friendly message', async () => {
  const responses = []
  const refunds = loadModule('../src/lib/point-charge-refunds-server.ts', {
    '@/lib/payment-orders-server': {
      createPaymentAdminClient: () => ({ rpc: async () => responses.shift() }),
    },
  })

  responses.push({ data: null, error: { code: 'P0001', message: 'REFUND_REJECT_CONFIRMATION_REQUIRED' } })
  await assert.rejects(
    refunds.rejectPointChargeRefund({ requestId: 'r', adminId: 'a', adminNote: null, providerNotCancelledConfirmed: false }),
    (error) => {
      assert.equal(error.code, 'REFUND_REJECT_CONFIRMATION_REQUIRED')
      assert.equal(error.retryable, false)
      assert.match(error.message, /미취소 확인과 처리 메모/)
      return true
    }
  )

  responses.push({ data: null, error: { code: '40P01', message: 'deadlock detected' } })
  await assert.rejects(
    refunds.finalizePointChargeRefund({ requestId: 'r', cancelTransactionKey: 'k', cancelledAt: 'now', providerStatus: 'CANCELED' }),
    { code: '40P01', retryable: true, message: '환불 요청을 처리하지 못했습니다.' }
  )
})

test('a refund already finalized by the notification is reported as already completed', async () => {
  const processor = createProcessor({
    claimed: payappClaim,
    finalize: () => ({ already_completed: true, new_balance: 0 }),
  })
  assert.equal((await processor.run()).alreadyCompleted, true)
  assert.equal(processor.calls.cancel.length, 1)
})

test('a completion that lands between the re-read and the failure record is still a success', async () => {
  const processor = createProcessor({
    claimed: payappClaim,
    finalize: () => Promise.reject(new RefundRpcError('REFUND_REQUEST_REVALIDATION_FAILED', false)),
    statusAfterFail: 'completed',
  })
  assert.equal((await processor.run()).alreadyCompleted, true)
})

test('PayApp configuration and input errors stay retryable; only a rejection needs manual handling', async () => {
  for (const code of ['PAYAPP_CONFIGURATION_INVALID', 'PAYAPP_INPUT_INVALID']) {
    const processor = createProcessor({
      claimed: payappClaim,
      payapp: { cancel: () => Promise.reject(new PayAppError(code, 'definite_failure')) },
    })
    await assert.rejects(processor.run(), { code, retryable: true })
    assert.equal(processor.calls.fail[0].retryable, true)
  }

  const rejected = createProcessor({
    claimed: payappClaim,
    payapp: {
      cancel: () => Promise.reject(Object.assign(
        new PayAppError('PAYAPP_REQUEST_REJECTED', 'definite_failure', '정산 완료'),
        { providerErrorCode: '70' }
      )),
    },
  })
  await assert.rejects(rejected.run(), { retryable: false })
  assert.match(rejected.calls.fail[0].message, /\(70: 정산 완료\)/)
})

test('a permanent finalize failure after a successful paycancel does not cancel twice', async () => {
  const processor = createProcessor({
    claimed: payappClaim,
    finalize: () => Promise.reject(new RefundRpcError('REFUND_REQUEST_REVALIDATION_FAILED', false)),
  })
  await assert.rejects(processor.run(), { retryable: false })
  assert.equal(processor.calls.cancel.length, 1)
  assert.equal(processor.calls.fail.length, 1)
})

test('KakaoPay quarantine helpers never mask the original refund error', async () => {
  const processor = createProcessor({
    claimed: kakaoClaim,
    kakao: { orders: [{ status: 'PART_CANCEL_PAYMENT', canceled_amount: { total: 3000 } }] },
    markerThrows: true,
  })
  await assert.rejects(processor.run(), { code: 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW' })
  assert.deepEqual(processor.calls.order, ['fail', 'marker'])

  for (const status of ['CANCEL_PAYMENT', 'SUCCESS_PAYMENT']) {
    const requery = createProcessor({
      claimed: kakaoClaim,
      kakao: {
        orders: [{ status: 'SUCCESS_PAYMENT' }, { status }],
        cancel: () => Promise.reject(new KakaoPayError('KAKAOPAY_-780', 'definite_failure')),
      },
    })
    await assert.rejects(requery.run(), { code: 'KAKAOPAY_-780' })
    assert.equal(requery.calls.kakaoRpc.length, 0, status)
  }
})

test('refund RPC errors that are not business errors are retryable', async () => {
  const responses = []
  const refunds = loadModule('../src/lib/point-charge-refunds-server.ts', {
    '@/lib/payment-orders-server': {
      createPaymentAdminClient: () => ({ rpc: async () => responses.shift() }),
    },
  })
  const finalize = () => refunds.finalizePointChargeRefund({
    requestId: 'r', cancelTransactionKey: 'k', cancelledAt: 'now', providerStatus: 'CANCELED',
  })

  for (const [error, code, retryable] of [
    [{ code: '', message: 'TypeError: fetch failed' }, 'REFUND_RPC_FAILED', true],
    [{ code: '57014', message: 'canceling statement due to statement timeout' }, '57014', true],
    [{ code: '08006', message: 'connection failure' }, '08006', true],
    [{ code: 'PGRST301', message: 'jwt expired' }, 'PGRST301', true],
    [{ code: 'P0001', message: 'REFUND_REQUEST_REVALIDATION_FAILED' }, 'REFUND_REQUEST_REVALIDATION_FAILED', false],
    [{ code: '23505', message: 'duplicate key value violates unique constraint' }, '23505', false],
  ]) {
    responses.push({ data: null, error })
    await assert.rejects(finalize(), { code, retryable }, error.message)
  }
})

test('a historical Toss refund claim fails closed to manual review without calling any provider', async () => {
  const processor = createProcessor({
    claimed: { already_completed: false, request_id: 'refund-toss', provider: 'toss', refund_amount: 9900 },
  })
  await assert.rejects(processor.run(), { code: 'REFUND_PAYMENT_SNAPSHOT_INVALID', retryable: false })
  assert.equal(processor.calls.cancel.length, 0)
  assert.equal(processor.calls.fail.length, 1)
  assert.equal(processor.calls.fail[0].retryable, false)
})
