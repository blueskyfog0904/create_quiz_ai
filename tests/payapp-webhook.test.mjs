import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

function loadModule(path, modules = {}) {
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

const payapp = loadModule('../src/lib/payapp-server.ts')
const { handlePayAppFeedback } = loadModule('../src/lib/payapp-webhook-server.ts', {
  '@/lib/payapp-server': payapp,
})

const ENV = {
  PAYAPP_USERID: 'seller01',
  PAYAPP_LINKKEY: 'link-key-secret',
  PAYAPP_LINKVAL: 'link-val-secret',
  PAYMENT_CALLBACK_ORIGIN: 'https://www.example.com',
}
Object.assign(process.env, ENV)

const ORDER_UUID = '00000000-0000-4000-8000-000000000001'
const USER_UUID = '00000000-0000-4000-8000-000000000002'

function feedbackBody(overrides = {}) {
  return new URLSearchParams({
    userid: 'seller01',
    linkkey: 'link-key-secret',
    linkval: 'link-val-secret',
    mul_no: '2000',
    var1: 'PAYAPP_ORDER_1',
    pay_state: '4',
    price: '9900',
    pay_type: '1',
    pay_date: '2026-10-20 14:30:05',
    feedbacktype: '0',
    ...overrides,
  }).toString()
}

// payment_webhook_events·notifications·profiles와 RPC만 흉내 내는 가짜 관리자 클라이언트.
function createFakeAdmin({ rpc = {}, insertError = null, alertThrows = false } = {}) {
  const events = new Map()
  const calls = { rpc: [], notifications: [], alerts: [] }

  const admin = {
    events,
    calls,
    from(table) {
      return {
        insert(row) {
          if (table === 'payment_webhook_events') {
            if (insertError) return Promise.resolve({ error: insertError })
            if (events.has(row.transmission_id)) {
              return Promise.resolve({ error: { code: '23505' } })
            }
            events.set(row.transmission_id, { ...row, processing_status: 'pending' })
            return Promise.resolve({ error: null })
          }
          if (table === 'notifications') {
            calls.notifications.push(...(Array.isArray(row) ? row : [row]))
          }
          return Promise.resolve({ error: null })
        },
        update(values) {
          return {
            eq(_column, value) {
              return {
                neq(column, excluded) {
                  const event = events.get(value)
                  if (event && event[column] !== excluded) Object.assign(event, values)
                  return Promise.resolve({ error: null })
                },
              }
            },
          }
        },
        select() {
          return {
            eq(column, value) {
              if (table === 'profiles' && column === 'is_admin') {
                return Promise.resolve({ data: [{ id: 'admin-1' }], error: null })
              }
              return {
                maybeSingle: () => Promise.resolve({ data: events.get(value) ?? null, error: null }),
              }
            },
          }
        },
      }
    },
    async rpc(name, args) {
      if (name === 'record_payment_alert') {
        if (alertThrows) throw new Error('alert failed')
        calls.alerts.push(args)
        return { data: true, error: null }
      }
      calls.rpc.push({ name, args })
      const handler = rpc[name]
      if (!handler) throw new Error(`unexpected rpc ${name}`)
      return handler(args, calls.rpc.filter((call) => call.name === name).length)
    },
  }
  return admin
}

const ok = (data) => ({ data, error: null })
const fail = (code) => ({ data: null, error: { code, message: code } })

test('a paid notification is applied once, answered SUCCESS and the user is notified', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'fulfilled',
        payment_order_id: ORDER_UUID,
        order_id: 'PAYAPP_ORDER_1',
        user_id: USER_UUID,
        pay_type_mismatch: false,
        paid_amount_conflict: false,
      }),
    },
  })

  assert.deepEqual(await handlePayAppFeedback(feedbackBody(), admin), { body: 'SUCCESS', status: 200 })
  assert.equal(admin.events.get('payapp:2000:4').processing_status, 'completed')
  assert.deepEqual(admin.calls.rpc[0].args, {
    p_userid: 'seller01',
    p_mul_no: '2000',
    p_orig_mul_no: null,
    p_order_id: 'PAYAPP_ORDER_1',
    p_pay_state: 4,
    p_price: 9900,
    p_orig_price: null,
    p_pay_type: 1,
    p_pay_date: '2026-10-20T05:30:05.000Z',
    p_canceldate: null,
  })
  assert.equal(admin.calls.notifications.length, 1)
  assert.equal(admin.calls.notifications[0].user_id, USER_UUID)

  // 같은 통보가 다시 와도 처리하지 않고 SUCCESS.
  assert.equal((await handlePayAppFeedback(feedbackBody({ feedbacktype: '1' }), admin)).body, 'SUCCESS')
  assert.equal(admin.calls.rpc.length, 1)
})

test('a failed first attempt answers FAIL and the re-notification is processed', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: (_args, count) => count === 1
        ? fail('40P01')
        : ok({ result: 'fulfilled', payment_order_id: ORDER_UUID, user_id: USER_UUID }),
    },
  })

  assert.deepEqual(await handlePayAppFeedback(feedbackBody(), admin), { body: 'FAIL', status: 503 })
  assert.equal(admin.events.get('payapp:2000:4').processing_status, 'failed')
  assert.equal(admin.events.get('payapp:2000:4').last_error_code, 'APPLY:40P01')

  assert.equal((await handlePayAppFeedback(feedbackBody(), admin)).body, 'SUCCESS')
  assert.equal(admin.calls.rpc.length, 2)
  assert.equal(admin.events.get('payapp:2000:4').processing_status, 'completed')
})

test('every non-exception feedback result closes the event and answers SUCCESS', async () => {
  for (const result of [
    'fulfilled',
    'already_fulfilled',
    'recorded_pending',
    'cancelled_before_fulfillment',
    'request_recorded',
    'expired',
    'unchanged',
    'recorded',
  ]) {
    const admin = createFakeAdmin({
      rpc: { apply_payapp_feedback: () => ok({ result, payment_order_id: ORDER_UUID, user_id: USER_UUID }) },
    })
    assert.deepEqual(await handlePayAppFeedback(feedbackBody(), admin), { body: 'SUCCESS', status: 200 }, result)
    assert.equal(admin.events.get('payapp:2000:4').processing_status, 'completed', result)
    // 사용자 알림은 처음 지급한 통보에서만 보낸다.
    assert.equal(admin.calls.notifications.length, result === 'fulfilled' ? 1 : 0, result)
  }
})

test('a late failure does not reopen an event that another delivery completed', async () => {
  const admin = createFakeAdmin({
    rpc: {
      // 이 처리가 진행되는 동안 다른 통보(feedbacktype 1)가 먼저 완료했다.
      apply_payapp_feedback: () => {
        admin.events.get('payapp:2000:4').processing_status = 'completed'
        return fail('40001')
      },
    },
  })

  assert.equal((await handlePayAppFeedback(feedbackBody(), admin)).body, 'FAIL')
  assert.equal(admin.events.get('payapp:2000:4').processing_status, 'completed')
})

test('unauthenticated notifications are refused without touching events or RPCs', async () => {
  for (const overrides of [{ linkval: 'wrong' }, { linkkey: '' }, { userid: 'other' }]) {
    const admin = createFakeAdmin()
    assert.deepEqual(await handlePayAppFeedback(feedbackBody(overrides), admin), { body: 'FAIL', status: 401 })
    assert.equal(admin.events.size, 0)
    assert.equal(admin.calls.rpc.length, 0)
    assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_FEEDBACK_UNAUTHORIZED')
    assert.deepEqual(admin.calls.alerts[0].p_details, {})
  }
})

test('missing PayApp configuration answers FAIL with a configuration alert', async () => {
  const saved = process.env.PAYAPP_LINKVAL
  delete process.env.PAYAPP_LINKVAL
  try {
    const admin = createFakeAdmin()
    assert.deepEqual(await handlePayAppFeedback(feedbackBody(), admin), { body: 'FAIL', status: 503 })
    assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_CONFIGURATION_INVALID')
  } finally {
    process.env.PAYAPP_LINKVAL = saved
  }
})

test('notifications rejected by validation are ignored with an alert and admin notice', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'ignored',
        reason: 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH',
        payment_order_id: ORDER_UUID,
        order_id: 'PAYAPP_ORDER_1',
      }),
    },
  })

  assert.equal((await handlePayAppFeedback(feedbackBody({ price: '1000' }), admin)).body, 'SUCCESS')
  assert.equal(admin.events.get('payapp:2000:4').processing_status, 'ignored')
  assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_FEEDBACK_AMOUNT_MISMATCH')
  assert.equal(admin.calls.alerts[0].p_details.order_id, 'PAYAPP_ORDER_1')
  assert.equal(admin.calls.notifications[0].user_id, 'admin-1')
  assert.match(admin.calls.notifications[0].message, /PAYAPP_ORDER_1/)
})

test('notifications with an order id but no order are recorded and alerted, admins only for paid ones', async () => {
  for (const [payState, adminNotified] of [['1', false], ['4', true]]) {
    const admin = createFakeAdmin({
      rpc: { apply_payapp_feedback: () => ok({ result: 'order_not_found' }) },
    })

    assert.equal((await handlePayAppFeedback(feedbackBody({ pay_state: payState }), admin)).body, 'SUCCESS')
    assert.equal(admin.events.get(`payapp:2000:${payState}`).processing_status, 'ignored')
    assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_FEEDBACK_ORDER_NOT_FOUND')
    assert.equal(admin.calls.alerts[0].p_details.order_id, 'PAYAPP_ORDER_1')
    assert.equal(admin.calls.notifications.length > 0, adminNotified)
  }
})

test('notifications without var1 that match no order are foreign sales: recorded without alerts', async () => {
  for (const payState of ['1', '4', '9', '70']) {
    for (const var1 of ['', '   ']) {
      const admin = createFakeAdmin({
        rpc: { apply_payapp_feedback: () => ok({ result: 'order_not_found' }) },
      })

      const body = feedbackBody({ var1, pay_state: payState, orig_mul_no: '1999' })
      assert.equal((await handlePayAppFeedback(body, admin)).body, 'SUCCESS')
      const event = admin.events.get(`payapp:2000:${payState}`)
      assert.equal(event.processing_status, 'ignored')
      assert.equal(event.last_error_code, 'PAYAPP_FOREIGN_FEEDBACK')
      assert.equal(admin.calls.alerts.length, 0)
      assert.equal(admin.calls.notifications.length, 0)
    }
  }
})

test('foreign sales with an unreadable date still leave no alert', async () => {
  const admin = createFakeAdmin({
    rpc: { apply_payapp_feedback: () => ok({ result: 'order_not_found' }) },
  })

  assert.equal((await handlePayAppFeedback(feedbackBody({ var1: '', pay_date: 'not-a-date' }), admin)).body, 'SUCCESS')
  assert.equal(admin.events.get('payapp:2000:4').last_error_code, 'PAYAPP_FOREIGN_FEEDBACK')
  assert.equal(admin.calls.alerts.length, 0)
})

test('partial cancels without var1 or orig_mul_no had no lookup key and still alert', async () => {
  for (const payState of ['70', '71']) {
    const admin = createFakeAdmin({
      rpc: { apply_payapp_feedback: () => ok({ result: 'order_not_found' }) },
    })

    assert.equal((await handlePayAppFeedback(feedbackBody({ var1: '', pay_state: payState }), admin)).body, 'SUCCESS')
    assert.equal(admin.events.get(`payapp:2000:${payState}`).processing_status, 'ignored')
    assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_FEEDBACK_ORDER_NOT_FOUND')
  }
})

test('notifications without var1 that match a site order by mul_no are still processed', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'fulfilled',
        payment_order_id: ORDER_UUID,
        order_id: 'PAYAPP_ORDER_1',
        user_id: USER_UUID,
      }),
    },
  })

  assert.equal((await handlePayAppFeedback(feedbackBody({ var1: '' }), admin)).body, 'SUCCESS')
  assert.equal(admin.events.get('payapp:2000:4').processing_status, 'completed')
  assert.equal(admin.calls.notifications[0].user_id, USER_UUID)
})

test('a cancel marker is processed in a separate call and retried after a failure', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'cancel_marker_recorded',
        marker: 'cancel',
        payment_order_id: ORDER_UUID,
        order_id: 'PAYAPP_ORDER_1',
      }),
      process_payapp_cancellation: (_args, count) => count === 1
        ? fail('40001')
        : ok({ result: 'refund_finalized', payment_order_id: ORDER_UUID, user_id: USER_UUID }),
    },
  })
  const body = feedbackBody({ pay_state: '9', canceldate: '2026-10-21 09:00:00' })

  assert.equal((await handlePayAppFeedback(body, admin)).body, 'FAIL')
  assert.equal(admin.events.get('payapp:2000:9').processing_status, 'failed')
  assert.deepEqual(admin.calls.rpc[1], {
    name: 'process_payapp_cancellation',
    args: { p_payment_order_id: ORDER_UUID },
  })

  assert.equal((await handlePayAppFeedback(body, admin)).body, 'SUCCESS')
  assert.equal(admin.events.get('payapp:2000:9').processing_status, 'completed')
  assert.equal(admin.calls.rpc[2].args.p_canceldate, '2026-10-21T00:00:00.000Z')
  assert.equal(admin.calls.notifications.at(-1).title, '환불 완료')
})

test('partial cancels use their own mul_no for the event and pass the original fields', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'cancel_marker_recorded',
        marker: 'partial_cancel',
        payment_order_id: ORDER_UUID,
        partial_cancel_amount_mismatch: true,
      }),
      process_payapp_cancellation: () => ok({ result: 'partial_cancel_quarantined', payment_order_id: ORDER_UUID }),
    },
  })

  const body = feedbackBody({ pay_state: '70', mul_no: '2005', orig_mul_no: '2000', price: '3000', orig_price: '9900' })
  assert.equal((await handlePayAppFeedback(body, admin)).body, 'SUCCESS')
  assert.ok(admin.events.has('payapp:2005:70'))
  assert.equal(admin.calls.rpc[0].args.p_orig_mul_no, '2000')
  assert.equal(admin.calls.rpc[0].args.p_orig_price, 9900)
  assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_PARTIAL_CANCEL_AMOUNT_CONFLICT')
})

test('every cancellation result closes the event with the alerts it needs', async () => {
  const cases = [
    { marker: 'cancel', result: { result: 'cancelled_before_fulfillment' }, alerts: [] },
    { marker: 'cancel', result: { result: 'already_refunded' }, alerts: [] },
    { marker: 'cancel', result: { result: 'double_refund_suspected' }, alerts: ['PAYAPP_DOUBLE_REFUND_SUSPECTED'], admins: true },
    { marker: 'cancel', result: { result: 'already_quarantined' }, alerts: ['PAYAPP_CANCEL_AFTER_QUARANTINE'], admins: true },
    { marker: 'cancel', result: { result: 'refund_finalized', user_id: USER_UUID }, alerts: [], userNotified: true },
    { marker: 'cancel', result: { result: 'external_cancel_quarantined' }, alerts: [] },
    { marker: 'cancel', result: { result: 'cancel_handling_failed' }, alerts: ['PAYAPP_CANCEL_HANDLING_FAILED'], admins: true },
    { marker: 'cancel', result: { result: 'nothing_to_process' }, alerts: [] },
    { marker: 'partial_cancel', result: { result: 'partial_cancel_after_cancel' }, alerts: ['PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL'], admins: true },
    { marker: 'partial_cancel', result: { result: 'partial_cancel_unpaid' }, alerts: [] },
    { marker: 'partial_cancel', result: { result: 'partial_cancel_quarantined', outcome: 'quarantined' }, alerts: [] },
    {
      marker: 'partial_cancel',
      result: { result: 'partial_cancel_quarantined', outcome: 'absorbed_by_refund', partial_cancel_amount: 3000, actual_refund_amount: 6900 },
      alerts: ['PAYAPP_PARTIAL_CANCEL_ABSORBED'],
      admins: true,
    },
    { marker: 'partial_cancel', result: { result: 'deferred_refund_processing' }, alerts: ['PAYAPP_PARTIAL_CANCEL_DEFERRED'] },
    { marker: 'partial_cancel', result: { result: 'already_quarantined' }, alerts: [] },
  ]

  for (const item of cases) {
    const label = `${item.marker}:${item.result.result}:${item.result.outcome ?? ''}`
    const admin = createFakeAdmin({
      rpc: {
        apply_payapp_feedback: () => ok({ result: 'cancel_marker_recorded', marker: item.marker, payment_order_id: ORDER_UUID }),
        process_payapp_cancellation: () => ok({ ...item.result, marker: item.marker, payment_order_id: ORDER_UUID }),
      },
    })
    const payState = item.marker === 'cancel' ? '9' : '70'
    const body = feedbackBody(item.marker === 'cancel'
      ? { pay_state: payState }
      : { pay_state: payState, mul_no: '2005', orig_mul_no: '2000', price: '3000', orig_price: '9900' })

    assert.equal((await handlePayAppFeedback(body, admin)).body, 'SUCCESS', label)
    assert.equal([...admin.events.values()][0].processing_status, 'completed', label)
    assert.deepEqual(admin.calls.alerts.map((alert) => alert.p_code), item.alerts, label)
    assert.equal(admin.calls.notifications.some((row) => row.user_id === 'admin-1'), Boolean(item.admins), label)
    assert.equal(admin.calls.notifications.some((row) => row.user_id === USER_UUID), Boolean(item.userNotified), label)
  }

  const absorbed = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({ result: 'cancel_marker_recorded', marker: 'partial_cancel', payment_order_id: ORDER_UUID }),
      process_payapp_cancellation: () => ok({
        result: 'partial_cancel_quarantined',
        outcome: 'absorbed_by_refund',
        marker: 'partial_cancel',
        partial_cancel_amount: 3000,
        actual_refund_amount: 6900,
      }),
    },
  })
  await handlePayAppFeedback(feedbackBody({ pay_state: '70', mul_no: '2005', orig_mul_no: '2000' }), absorbed)
  assert.equal(absorbed.calls.alerts[0].p_details.actual_refund_amount, 6900)
})

test('a pending cancel marker processed first is followed by this notification\'s marker', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({ result: 'cancel_marker_recorded', marker: 'partial_cancel', payment_order_id: ORDER_UUID }),
      process_payapp_cancellation: (_args, count) => ok(count === 1
        ? { result: 'external_cancel_quarantined', marker: 'cancel' }
        : { result: 'partial_cancel_after_cancel', marker: 'partial_cancel' }),
    },
  })

  const body = feedbackBody({ pay_state: '70', mul_no: '2005', orig_mul_no: '2000' })
  assert.equal((await handlePayAppFeedback(body, admin)).body, 'SUCCESS')
  assert.equal(admin.calls.rpc.filter((call) => call.name === 'process_payapp_cancellation').length, 2)
  assert.deepEqual(admin.calls.alerts.map((alert) => alert.p_code), ['PAYAPP_PARTIAL_CANCEL_AFTER_CANCEL'])
})

test('a second partial cancel with a new mul_no is alerted even when the amount matches', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'cancel_marker_recorded',
        marker: 'partial_cancel',
        already_recorded: true,
        payment_order_id: ORDER_UUID,
      }),
      process_payapp_cancellation: () => ok({ result: 'nothing_to_process' }),
    },
  })

  const body = feedbackBody({ pay_state: '70', mul_no: '2006', orig_mul_no: '2000', price: '3000', orig_price: '9900' })
  assert.equal((await handlePayAppFeedback(body, admin)).body, 'SUCCESS')
  assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_PARTIAL_CANCEL_REPEATED')
  assert.equal(admin.calls.alerts[0].p_details.mul_no, '2006')

  // 같은 통보가 다시 오면(feedbacktype 0·1) 처리하지 않는다.
  assert.equal((await handlePayAppFeedback(body, admin)).body, 'SUCCESS')
  assert.equal(admin.calls.alerts.length, 1)
})

test('the repeated partial cancel alert survives a failed first attempt', async () => {
  // 취소 처리가 실패해도 첫 전달에서 경보가 나간다.
  const processFails = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'cancel_marker_recorded',
        marker: 'partial_cancel',
        already_recorded: true,
        payment_order_id: ORDER_UUID,
      }),
      process_payapp_cancellation: () => fail('40001'),
    },
  })
  const body = feedbackBody({ pay_state: '70', mul_no: '2006', orig_mul_no: '2000', price: '3000', orig_price: '9900' })
  assert.equal((await handlePayAppFeedback(body, processFails)).body, 'FAIL')
  assert.deepEqual(processFails.calls.alerts.map((alert) => alert.p_code), ['PAYAPP_PARTIAL_CANCEL_REPEATED'])

  // 표식 기록이 실패했으면 재통보를 첫 처리로 본다.
  const applyFails = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: (_args, count) => count === 1
        ? fail('40P01')
        : ok({ result: 'cancel_marker_recorded', marker: 'partial_cancel', already_recorded: true, payment_order_id: ORDER_UUID }),
      process_payapp_cancellation: () => ok({ result: 'nothing_to_process' }),
    },
  })
  assert.equal((await handlePayAppFeedback(body, applyFails)).body, 'FAIL')
  assert.equal((await handlePayAppFeedback(body, applyFails)).body, 'SUCCESS')
  assert.deepEqual(applyFails.calls.alerts.map((alert) => alert.p_code), ['PAYAPP_PARTIAL_CANCEL_REPEATED'])
})

test('marker alerts are sent once even when two cancellation calls run', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'cancel_marker_recorded',
        marker: 'partial_cancel',
        partial_cancel_amount_mismatch: true,
        payment_order_id: ORDER_UUID,
      }),
      process_payapp_cancellation: (_args, count) => ok(count === 1
        ? { result: 'external_cancel_quarantined', marker: 'cancel' }
        : { result: 'partial_cancel_quarantined', outcome: 'quarantined', marker: 'partial_cancel' }),
    },
  })

  await handlePayAppFeedback(feedbackBody({ pay_state: '70', mul_no: '2005', orig_mul_no: '2000' }), admin)
  assert.deepEqual(admin.calls.alerts.map((alert) => alert.p_code), ['PAYAPP_PARTIAL_CANCEL_AMOUNT_CONFLICT'])
})

test('the fulfillment error of a recorded-only payment is kept on the event', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'recorded_pending',
        payment_order_id: ORDER_UUID,
        fulfillment_error_state: '23514',
      }),
    },
  })

  assert.equal((await handlePayAppFeedback(feedbackBody(), admin)).body, 'SUCCESS')
  assert.equal(admin.events.get('payapp:2000:4').last_error_code, '23514')
})

test('pay type and paid amount anomalies are alerted after a successful payment', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({
        result: 'fulfilled',
        payment_order_id: ORDER_UUID,
        user_id: USER_UUID,
        pay_type_mismatch: true,
      }),
    },
  })

  assert.equal((await handlePayAppFeedback(feedbackBody({ pay_type: '16' }), admin)).body, 'SUCCESS')
  assert.equal(admin.calls.alerts[0].p_code, 'PAYAPP_PAY_TYPE_MISMATCH')
  assert.equal(admin.calls.alerts[0].p_details.pay_type, 16)
})

test('malformed and undated notifications are handled without breaking the reply', async () => {
  const malformed = createFakeAdmin()
  assert.equal((await handlePayAppFeedback(feedbackBody({ mul_no: '' }), malformed)).body, 'SUCCESS')
  assert.equal(malformed.calls.rpc.length, 0)
  assert.equal(malformed.calls.alerts[0].p_code, 'PAYAPP_FEEDBACK_MALFORMED')

  const undated = createFakeAdmin({
    rpc: { apply_payapp_feedback: () => ok({ result: 'fulfilled', payment_order_id: ORDER_UUID }) },
  })
  assert.equal((await handlePayAppFeedback(feedbackBody({ pay_date: '2026/10/20' }), undated)).body, 'SUCCESS')
  assert.equal(undated.calls.rpc[0].args.p_pay_date, null)
  assert.equal(undated.calls.alerts[0].p_code, 'PAYAPP_FEEDBACK_DATE_UNPARSED')

  const alertFailure = createFakeAdmin({
    alertThrows: true,
    rpc: { apply_payapp_feedback: () => ok({ result: 'ignored', reason: 'X', payment_order_id: ORDER_UUID }) },
  })
  assert.equal((await handlePayAppFeedback(feedbackBody(), alertFailure)).body, 'SUCCESS')
})

test('event storage failures and unknown results answer FAIL', async () => {
  const storage = createFakeAdmin({ insertError: { code: '57014' } })
  assert.equal((await handlePayAppFeedback(feedbackBody(), storage)).body, 'FAIL')
  assert.equal(storage.calls.rpc.length, 0)

  const unknown = createFakeAdmin({
    rpc: { apply_payapp_feedback: () => ok({ result: 'something_new' }) },
  })
  assert.equal((await handlePayAppFeedback(feedbackBody(), unknown)).body, 'FAIL')
  assert.equal(unknown.calls.alerts[0].p_code, 'PAYAPP_FEEDBACK_RESULT_UNKNOWN')
})

test('secrets never reach events, RPC arguments, alerts or notifications', async () => {
  const admin = createFakeAdmin({
    rpc: {
      apply_payapp_feedback: () => ok({ result: 'ignored', reason: 'X', payment_order_id: ORDER_UUID }),
    },
  })
  await handlePayAppFeedback(feedbackBody(), admin)
  await handlePayAppFeedback(feedbackBody({ linkval: 'bad' }), admin)

  const stored = JSON.stringify({ events: [...admin.events.values()], calls: admin.calls })
  assert.equal(stored.includes('link-key-secret'), false)
  assert.equal(stored.includes('link-val-secret'), false)
})
