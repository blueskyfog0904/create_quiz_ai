import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('../src/lib/payapp-server.ts', import.meta.url), 'utf8')

const payapp = (() => {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  const stubRequire = (name) => (name === 'server-only' ? {} : require(name))
  new Function('exports', 'require', code)(loaded.exports, stubRequire)
  return loaded.exports
})()

const ENV = {
  PAYAPP_USERID: 'seller01',
  PAYAPP_LINKKEY: 'link-key-secret',
  PAYAPP_LINKVAL: 'link-val-secret',
  PAYMENT_CALLBACK_ORIGIN: 'https://www.example.com',
  PAYMENTS_ENABLED: 'true',
}

const PAYMENT_INPUT = {
  orderId: 'order-123',
  goodName: 'Basic',
  price: 9900,
  vatAmount: 900,
  recvPhone: '01012345678',
  openPayType: 'card',
}

function withEnv(overrides, fn) {
  const keys = Object.keys({ ...ENV, ...overrides })
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  for (const key of keys) {
    const value = key in overrides ? overrides[key] : ENV[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const restore = () => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
  try {
    const result = fn()
    if (result && typeof result.then === 'function') return result.finally(restore)
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

function withFetch(handler, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: new URLSearchParams(init.body) })
    return handler(url, init)
  }
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original
  })
}

const textResponse = (body, status = 200) => new Response(body, { status })

async function rejectsWith(promise, expected) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.name, 'PayAppError')
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(error[key], value, key)
    }
    return true
  })
}

test('configuration requires all PayApp secrets and an https callback origin', () => {
  withEnv({}, () => {
    const config = payapp.getPayAppConfig('feedback')
    assert.equal(config.userId, 'seller01')
    assert.equal(config.callbackOrigin, 'https://www.example.com')
  })

  for (const overrides of [
    { PAYAPP_USERID: undefined },
    { PAYAPP_LINKKEY: '' },
    { PAYAPP_LINKVAL: '  ' },
    { PAYMENT_CALLBACK_ORIGIN: 'http://www.example.com' },
    { PAYMENT_CALLBACK_ORIGIN: 'https://www.example.com/path' },
  ]) {
    withEnv(overrides, () => {
      assert.throws(() => payapp.getPayAppConfig('feedback'), { code: 'PAYAPP_CONFIGURATION_INVALID' })
    })
  }
})

test('PAYMENTS_ENABLED gates new requests only', () => {
  withEnv({ PAYMENTS_ENABLED: 'false' }, () => {
    assert.throws(() => payapp.assertPayAppReady(), { code: 'PAYAPP_DISABLED' })
    assert.equal(payapp.getPayAppConfig('cancel').userId, 'seller01')
    assert.equal(payapp.getPayAppConfig('feedback').userId, 'seller01')
  })
})

test('payrequest sends server-priced form parameters without secrets or buyer identity', () =>
  withEnv({}, () =>
    withFetch(
      () => textResponse('state=1&errorMessage=&mul_no=2000&payurl=https%3A%2F%2Fpayapp.kr%2Fabc'),
      async (calls) => {
        const result = await payapp.requestPayAppPayment(PAYMENT_INPUT)

        assert.deepEqual(result, { mulNo: '2000', payUrl: 'https://payapp.kr/abc' })
        assert.equal(calls.length, 1)
        assert.equal(calls[0].url, 'https://api.payapp.kr/oapi/apiLoad.html')
        assert.equal(calls[0].init.method, 'POST')
        assert.match(calls[0].init.headers['Content-Type'], /^application\/x-www-form-urlencoded/)
        assert.equal(calls[0].init.redirect, 'error')

        const body = Object.fromEntries(calls[0].body)
        assert.deepEqual(body, {
          cmd: 'payrequest',
          userid: 'seller01',
          goodname: 'Basic',
          price: '9900',
          recvphone: '01012345678',
          feedbackurl: 'https://www.example.com/api/payments/webhooks/payapp',
          returnurl: 'https://www.example.com/api/payments/payapp/return?orderId=order-123',
          var1: 'order-123',
          smsuse: 'n',
          openpaytype: 'card',
          checkretry: 'y',
          skip_cstpage: 'y',
          amount_taxable: '9000',
          amount_vat: '900',
          amount_taxfree: '0',
        })
      }
    )
  )
)

test('payrequest state=0 is a definite failure that keeps the provider message', () =>
  withEnv({}, () =>
    withFetch(
      () => textResponse('state=0&errorMessage=%EC%98%A4%EB%A5%98&errorCode=70'),
      () =>
        rejectsWith(payapp.requestPayAppPayment(PAYMENT_INPUT), {
          code: 'PAYAPP_REQUEST_REJECTED',
          outcome: 'definite_failure',
          providerMessage: '오류',
          providerErrorCode: '70',
        })
    )
  )
)

// 요청 시간 제한 타이머를 바로 실행하고, fetch는 signal이 abort될 때까지 기다린다.
function withImmediateTimeout(fn) {
  const original = globalThis.setTimeout
  globalThis.setTimeout = (callback) => {
    queueMicrotask(callback)
    return 0
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.setTimeout = original
    })
}

const waitForAbort = (_url, init) => new Promise((_resolve, reject) => {
  const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  if (init.signal.aborted) abort()
  else init.signal.addEventListener('abort', abort)
})

test('timeouts, network errors and HTTP errors are retryable unknown outcomes', () =>
  withEnv({}, async () => {
    await withImmediateTimeout(() =>
      withFetch(
        waitForAbort,
        () => rejectsWith(payapp.requestPayAppPayment(PAYMENT_INPUT), {
          code: 'PAYAPP_REQUEST_TIMEOUT',
          outcome: 'outcome_unknown',
        })
      )
    )
    await withFetch(
      () => Promise.reject(new TypeError('fetch failed')),
      () => rejectsWith(payapp.requestPayAppPayment(PAYMENT_INPUT), {
        code: 'PAYAPP_NETWORK_ERROR',
        outcome: 'outcome_unknown',
      })
    )
    for (const status of [400, 408, 429, 503]) {
      await withFetch(
        () => textResponse('error', status),
        () => rejectsWith(payapp.requestPayAppPayment(PAYMENT_INPUT), {
          code: 'PAYAPP_HTTP_ERROR',
          outcome: 'outcome_unknown',
        })
      )
    }
    await withFetch(
      () => textResponse('<html>bad gateway</html>'),
      () => rejectsWith(payapp.requestPayAppPayment(PAYMENT_INPUT), {
        code: 'PAYAPP_RESPONSE_INVALID',
        outcome: 'outcome_unknown',
      })
    )
  })
)

test('a successful payrequest without a usable mul_no or https payurl is an unknown outcome', () =>
  withEnv({}, async () => {
    for (const body of [
      'state=1&errorMessage=&mul_no=&payurl=https%3A%2F%2Fpayapp.kr%2Fabc',
      'state=1&errorMessage=&mul_no=20a0&payurl=https%3A%2F%2Fpayapp.kr%2Fabc',
      'state=1&errorMessage=&mul_no=2000&payurl=http%3A%2F%2Fpayapp.kr%2Fabc',
      'state=1&errorMessage=&mul_no=2000',
    ]) {
      await withFetch(
        () => textResponse(body),
        () => rejectsWith(payapp.requestPayAppPayment(PAYMENT_INPUT), {
          code: 'PAYAPP_RESPONSE_INVALID',
          outcome: 'outcome_unknown',
        })
      )
    }
  })
)

test('invalid payment input is rejected before calling PayApp', () =>
  withEnv({}, () =>
    withFetch(
      () => textResponse('state=1'),
      async (calls) => {
        for (const overrides of [
          { recvPhone: '0212345678' },
          { recvPhone: '010-1234-5678' },
          { vatAmount: 0 },
          { price: 0 },
          { price: 9900.5 },
          { vatAmount: 899 },
          { vatAmount: 901 },
          { price: 100_001, vatAmount: 9091 },
          { openPayType: 'card,phone' },
          { goodName: ' ' },
          { orderId: '' },
        ]) {
          await rejectsWith(payapp.requestPayAppPayment({ ...PAYMENT_INPUT, ...overrides }), {
            code: 'PAYAPP_INPUT_INVALID',
            outcome: 'definite_failure',
          })
        }
        assert.equal(calls.length, 0)
      }
    )
  )
)

test('paycancel sends a full cancel with linkkey and optional ready mode', () =>
  withEnv({ PAYMENTS_ENABLED: 'false' }, () =>
    withFetch(
      () => textResponse('state=1&errorMessage='),
      async (calls) => {
        await payapp.cancelPayAppPayment({ mulNo: '2000', memo: '환불 승인' })
        await payapp.cancelPayAppPayment({ mulNo: '2001', memo: '결제 만료', mode: 'ready' })

        assert.deepEqual(Object.fromEntries(calls[0].body), {
          cmd: 'paycancel',
          userid: 'seller01',
          linkkey: 'link-key-secret',
          mul_no: '2000',
          cancelmemo: '환불 승인',
        })
        assert.equal(calls[1].body.get('cancelmode'), 'ready')
        assert.equal(calls[0].body.has('linkval'), false)
      }
    )
  )
)

test('paycancel timeouts, HTTP errors and unreadable responses are unknown outcomes', () =>
  withEnv({}, async () => {
    const input = { mulNo: '2000', memo: '환불' }

    await withImmediateTimeout(() =>
      withFetch(waitForAbort, () => rejectsWith(payapp.cancelPayAppPayment(input), {
        code: 'PAYAPP_REQUEST_TIMEOUT',
        operation: 'cancel',
        outcome: 'outcome_unknown',
      }))
    )
    await withFetch(() => textResponse('error', 502), () => rejectsWith(payapp.cancelPayAppPayment(input), {
      code: 'PAYAPP_HTTP_ERROR',
      outcome: 'outcome_unknown',
    }))
    await withFetch(() => textResponse(''), () => rejectsWith(payapp.cancelPayAppPayment(input), {
      code: 'PAYAPP_RESPONSE_INVALID',
      outcome: 'outcome_unknown',
    }))
  })
)

test('paycancel state=0 is a definite failure', () =>
  withEnv({}, () =>
    withFetch(
      () => textResponse('state=0&errorMessage=already'),
      () => rejectsWith(payapp.cancelPayAppPayment({ mulNo: '2000', memo: '환불' }), {
        code: 'PAYAPP_REQUEST_REJECTED',
        operation: 'cancel',
        outcome: 'definite_failure',
        providerMessage: 'already',
      })
    )
  )
)

const feedbackForm = (overrides = {}) => new URLSearchParams({
  userid: 'seller01',
  linkkey: 'link-key-secret',
  linkval: 'link-val-secret',
  mul_no: '2000',
  var1: 'order-123',
  pay_state: '4',
  price: '9900',
  pay_type: '1',
  pay_date: '2026-10-20 14:30:05',
  feedbacktype: '0',
  ...overrides,
})

test('feedback is authenticated against userid, linkkey and linkval', () =>
  withEnv({}, () => {
    for (const overrides of [
      { userid: 'other' },
      { linkkey: 'link-key-secreT' },
      { linkval: '' },
      { linkval: 'link-val-secret-longer' },
    ]) {
      assert.throws(() => payapp.verifyPayAppFeedback(feedbackForm(overrides)), {
        code: 'PAYAPP_FEEDBACK_UNAUTHORIZED',
      })
    }

    const missing = feedbackForm()
    missing.delete('linkval')
    assert.throws(() => payapp.verifyPayAppFeedback(missing), { code: 'PAYAPP_FEEDBACK_UNAUTHORIZED' })
  })
)

test('feedback verification fails closed when PayApp secrets are not configured', () =>
  withEnv({ PAYAPP_LINKVAL: undefined }, () => {
    assert.throws(() => payapp.verifyPayAppFeedback(feedbackForm()), {
      code: 'PAYAPP_CONFIGURATION_INVALID',
    })
  })
)

test('feedback fields are parsed strictly and dates are read as KST', () =>
  withEnv({}, () => {
    assert.deepEqual(payapp.verifyPayAppFeedback(feedbackForm()), {
      userId: 'seller01',
      mulNo: '2000',
      origMulNo: null,
      orderId: 'order-123',
      payState: 4,
      price: 9900,
      origPrice: null,
      payType: 1,
      payDate: '2026-10-20T05:30:05.000Z',
      cancelDate: null,
      dateParseFailed: false,
      feedbackType: 0,
    })

    const partial = payapp.verifyPayAppFeedback(feedbackForm({
      pay_state: '70',
      mul_no: '2005',
      orig_mul_no: '2000',
      price: '3000',
      orig_price: '9900',
      canceldate: '2026-01-01 00:10:00',
    }))
    assert.equal(partial.origMulNo, '2000')
    assert.equal(partial.origPrice, 9900)
    assert.equal(partial.cancelDate, '2025-12-31T15:10:00.000Z')
    assert.equal(partial.dateParseFailed, false)

    const withoutDates = feedbackForm()
    withoutDates.delete('pay_date')
    assert.equal(payapp.verifyPayAppFeedback(withoutDates).dateParseFailed, false)
    assert.equal(payapp.verifyPayAppFeedback(feedbackForm({ pay_date: '2026-10-20 14:30' })).dateParseFailed, true)

    const malformed = payapp.verifyPayAppFeedback(feedbackForm({
      price: '9,900',
      pay_state: '-4',
      pay_type: '1.0',
      mul_no: '20 00',
      pay_date: '2026-02-30 10:00:00',
      canceldate: '2026-10-20T14:30:05+09:00',
      var1: '   ',
    }))
    assert.equal(malformed.price, null)
    assert.equal(malformed.payState, null)
    assert.equal(malformed.payType, null)
    assert.equal(malformed.mulNo, null)
    assert.equal(malformed.payDate, null)
    assert.equal(malformed.cancelDate, null)
    assert.equal(malformed.orderId, null)
    assert.equal(malformed.dateParseFailed, true)

    assert.equal(payapp.verifyPayAppFeedback(feedbackForm({ price: '2147483648' })).price, null)
  })
)

test('the adapter is server-only and never logs or returns secrets', () => {
  assert.match(source, /^import 'server-only'/)
  assert.doesNotMatch(source, /console\./)

  withEnv({}, () => {
    const feedback = payapp.verifyPayAppFeedback(feedbackForm())
    assert.equal(JSON.stringify(feedback).includes('link-'), false)
  })
})
