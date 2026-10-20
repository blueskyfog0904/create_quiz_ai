import 'server-only'

import { timingSafeEqual } from 'node:crypto'

type PayAppOperation = 'request' | 'cancel' | 'feedback'
type PayAppOutcome = 'definite_failure' | 'outcome_unknown'

const PAYAPP_API_URL = 'https://api.payapp.kr/oapi/apiLoad.html'
const PAYAPP_REQUEST_TIMEOUT_MS = 10_000
const PAYAPP_MAX_INTEGER = 2_147_483_647

interface PayAppConfig {
  userId: string
  linkKey: string
  linkVal: string
  callbackOrigin: string
}

interface PayAppErrorInput {
  code: string
  message: string
  status: number
  operation: PayAppOperation
  outcome: PayAppOutcome
  providerErrorCode?: string | null
  providerMessage?: string | null
}

export class PayAppError extends Error {
  readonly code: string
  readonly status: number
  readonly operation: PayAppOperation
  readonly outcome: PayAppOutcome
  readonly providerErrorCode: string | null
  readonly providerMessage: string | null

  constructor(input: PayAppErrorInput) {
    super(input.message)
    this.name = 'PayAppError'
    this.code = input.code
    this.status = input.status
    this.operation = input.operation
    this.outcome = input.outcome
    this.providerErrorCode = input.providerErrorCode ?? null
    this.providerMessage = input.providerMessage ?? null
  }
}

function configurationError(operation: PayAppOperation) {
  return new PayAppError({
    code: 'PAYAPP_CONFIGURATION_INVALID',
    message: '페이앱 결제 설정을 확인할 수 없습니다.',
    status: 503,
    operation,
    outcome: 'definite_failure',
  })
}

function invalidInputError(operation: PayAppOperation) {
  return new PayAppError({
    code: 'PAYAPP_INPUT_INVALID',
    message: '결제 요청 정보를 확인할 수 없습니다.',
    status: 400,
    operation,
    outcome: 'definite_failure',
  })
}

// 통보·대사·환불·취소는 이 설정만 쓴다. PAYMENTS_ENABLED를 꺼도 이미 결제된 건은 계속 처리된다.
export function getPayAppConfig(operation: PayAppOperation): PayAppConfig {
  const userId = process.env.PAYAPP_USERID?.trim() ?? ''
  const linkKey = process.env.PAYAPP_LINKKEY?.trim() ?? ''
  const linkVal = process.env.PAYAPP_LINKVAL?.trim() ?? ''
  const callbackOrigin = process.env.PAYMENT_CALLBACK_ORIGIN?.trim() ?? ''

  if (!userId || !linkKey || !linkVal) {
    throw configurationError(operation)
  }

  let callbackUrl: URL
  try {
    callbackUrl = new URL(callbackOrigin)
  } catch {
    throw configurationError(operation)
  }

  if (
    callbackUrl.protocol !== 'https:' ||
    callbackUrl.origin !== callbackOrigin ||
    callbackUrl.username ||
    callbackUrl.password ||
    callbackUrl.pathname !== '/' ||
    callbackUrl.search ||
    callbackUrl.hash
  ) {
    throw configurationError(operation)
  }

  return {
    userId,
    linkKey,
    linkVal,
    callbackOrigin: callbackUrl.origin,
  }
}

// 새 결제 요청에만 쓴다.
export function assertPayAppReady(): PayAppConfig {
  if (process.env.PAYMENTS_ENABLED !== 'true') {
    throw new PayAppError({
      code: 'PAYAPP_DISABLED',
      message: '현재 결제 기능을 준비 중입니다.',
      status: 503,
      operation: 'request',
      outcome: 'definite_failure',
    })
  }

  return getPayAppConfig('request')
}

function limitProviderText(value: string | null) {
  const text = value?.trim()
  return text ? text.slice(0, 200) : null
}

export function parsePayAppResponse(body: string, operation: PayAppOperation) {
  const params = new URLSearchParams(body.trim())
  const state = params.get('state')

  if (state === '1') return params

  if (state === '0') {
    throw new PayAppError({
      code: 'PAYAPP_REQUEST_REJECTED',
      message: '페이앱 요청을 처리하지 못했습니다.',
      status: 502,
      operation,
      outcome: 'definite_failure',
      providerErrorCode: limitProviderText(params.get('errorCode') ?? params.get('errno')),
      providerMessage: limitProviderText(params.get('errorMessage')),
    })
  }

  throw new PayAppError({
    code: 'PAYAPP_RESPONSE_INVALID',
    message: '페이앱 처리 결과를 확인해야 합니다.',
    status: 502,
    operation,
    outcome: 'outcome_unknown',
  })
}

async function callPayApp(
  operation: PayAppOperation,
  body: Record<string, string>
) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    PAYAPP_REQUEST_TIMEOUT_MS
  )

  try {
    const response = await fetch(PAYAPP_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams(body).toString(),
      cache: 'no-store',
      // 다른 주소로 이동하면 linkkey가 담긴 본문이 다시 전송되므로 따라가지 않는다.
      redirect: 'error',
      signal: controller.signal,
    })

    // 페이앱이 처리했는지 알 수 없으므로 HTTP 오류는 모두 결과 확인이 필요한 실패로 둔다.
    // 확정 실패는 state=0 응답뿐이다.
    if (!response.ok) {
      throw new PayAppError({
        code: 'PAYAPP_HTTP_ERROR',
        message: '페이앱 처리 결과를 확인해야 합니다.',
        status: response.status,
        operation,
        outcome: 'outcome_unknown',
      })
    }

    return parsePayAppResponse(await response.text(), operation)
  } catch (error) {
    if (error instanceof PayAppError) throw error

    const timedOut = error instanceof Error && error.name === 'AbortError'
    throw new PayAppError({
      code: timedOut ? 'PAYAPP_REQUEST_TIMEOUT' : 'PAYAPP_NETWORK_ERROR',
      message: '페이앱 처리 결과를 확인해야 합니다.',
      status: timedOut ? 504 : 502,
      operation,
      outcome: 'outcome_unknown',
    })
  } finally {
    clearTimeout(timeout)
  }
}

const MUL_NO_PATTERN = /^[0-9]+$/
const PHONE_PATTERN = /^01[016789][0-9]{7,8}$/
const OPEN_PAY_TYPE_PATTERN = /^[a-z]+$/

export async function requestPayAppPayment(input: {
  orderId: string
  goodName: string
  price: number
  vatAmount: number
  recvPhone: string
  openPayType: string
}) {
  const config = assertPayAppReady()
  const goodName = input.goodName.trim()

  if (
    !input.orderId ||
    !goodName ||
    !Number.isInteger(input.price) ||
    input.price < 1 ||
    input.price > 100_000 ||
    input.vatAmount !== Math.round(input.price / 11) ||
    !PHONE_PATTERN.test(input.recvPhone) ||
    !OPEN_PAY_TYPE_PATTERN.test(input.openPayType)
  ) {
    throw invalidInputError('request')
  }

  const returnUrl = new URL('/api/payments/payapp/return', config.callbackOrigin)
  returnUrl.searchParams.set('orderId', input.orderId)

  // 회원 식별값(buyerid)·이메일은 보내지 않는다(개인정보 최소 제공).
  const response = await callPayApp('request', {
    cmd: 'payrequest',
    userid: config.userId,
    goodname: goodName,
    price: String(input.price),
    recvphone: input.recvPhone,
    feedbackurl: `${config.callbackOrigin}/api/payments/webhooks/payapp`,
    returnurl: returnUrl.href,
    var1: input.orderId,
    smsuse: 'n',
    openpaytype: input.openPayType,
    checkretry: 'y',
    skip_cstpage: 'y',
    amount_taxable: String(input.price - input.vatAmount),
    amount_vat: String(input.vatAmount),
    amount_taxfree: '0',
  })

  const mulNo = response.get('mul_no') ?? ''
  const payUrl = response.get('payurl') ?? ''
  let parsedPayUrl: URL | null = null
  try {
    parsedPayUrl = new URL(payUrl)
  } catch {
    parsedPayUrl = null
  }

  if (!MUL_NO_PATTERN.test(mulNo) || parsedPayUrl?.protocol !== 'https:') {
    throw new PayAppError({
      code: 'PAYAPP_RESPONSE_INVALID',
      message: '페이앱 처리 결과를 확인해야 합니다.',
      status: 502,
      operation: 'request',
      outcome: 'outcome_unknown',
    })
  }

  return { mulNo, payUrl: parsedPayUrl.href }
}

// 전취소만 한다(partcancel을 보내지 않으면 전취소). mode='ready'는 결제 전 요청만 취소한다.
export async function cancelPayAppPayment(input: {
  mulNo: string
  memo: string
  mode?: 'ready'
}) {
  const config = getPayAppConfig('cancel')
  const memo = input.memo.trim()

  if (!MUL_NO_PATTERN.test(input.mulNo) || !memo) {
    throw invalidInputError('cancel')
  }

  await callPayApp('cancel', {
    cmd: 'paycancel',
    userid: config.userId,
    linkkey: config.linkKey,
    mul_no: input.mulNo,
    cancelmemo: memo,
    ...(input.mode === 'ready' ? { cancelmode: 'ready' } : {}),
  })
}

function safeEqual(actual: string | null, expected: string) {
  const actualBuffer = Buffer.from(actual ?? '', 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')

  if (actualBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer)
    return false
  }

  return timingSafeEqual(actualBuffer, expectedBuffer)
}

function parsePayAppInteger(value: string | null) {
  const text = value?.trim() ?? ''
  if (!/^[0-9]+$/.test(text)) return null

  const parsed = Number(text)
  return parsed <= PAYAPP_MAX_INTEGER ? parsed : null
}

function parsePayAppMulNo(value: string | null) {
  const text = value?.trim() ?? ''
  return MUL_NO_PATTERN.test(text) ? text : null
}

// 페이앱 일시에는 시간대가 없으므로 한국 시간으로 해석한다.
function parsePayAppKstDate(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(
    value?.trim() ?? ''
  )
  if (!match) return null

  const [year, month, day, hour, minute, second] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, hour - 9, minute, second))
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000)

  if (
    kst.getUTCFullYear() !== year ||
    kst.getUTCMonth() !== month - 1 ||
    kst.getUTCDate() !== day ||
    kst.getUTCHours() !== hour ||
    kst.getUTCMinutes() !== minute ||
    kst.getUTCSeconds() !== second
  ) {
    return null
  }

  return date.toISOString()
}

export interface PayAppFeedback {
  userId: string
  mulNo: string | null
  origMulNo: string | null
  orderId: string | null
  payState: number | null
  price: number | null
  origPrice: number | null
  payType: number | null
  payDate: string | null
  cancelDate: string | null
  // 일시 값이 왔는데 형식을 읽지 못했다. route가 경보를 남긴다.
  dateParseFailed: boolean
  feedbackType: number | null
}

// 통보 원문에는 비밀값이 있으므로 저장하거나 로그에 남기지 않는다.
export function verifyPayAppFeedback(form: URLSearchParams): PayAppFeedback {
  const config = getPayAppConfig('feedback')
  const userIdMatches = safeEqual(form.get('userid'), config.userId)
  const linkKeyMatches = safeEqual(form.get('linkkey'), config.linkKey)
  const linkValMatches = safeEqual(form.get('linkval'), config.linkVal)

  if (!userIdMatches || !linkKeyMatches || !linkValMatches) {
    throw new PayAppError({
      code: 'PAYAPP_FEEDBACK_UNAUTHORIZED',
      message: '페이앱 통보를 인증하지 못했습니다.',
      status: 401,
      operation: 'feedback',
      outcome: 'definite_failure',
    })
  }

  const payDateText = form.get('pay_date')?.trim() || null
  const cancelDateText = form.get('canceldate')?.trim() || null
  const payDate = parsePayAppKstDate(payDateText)
  const cancelDate = parsePayAppKstDate(cancelDateText)

  return {
    userId: config.userId,
    mulNo: parsePayAppMulNo(form.get('mul_no')),
    origMulNo: parsePayAppMulNo(form.get('orig_mul_no')),
    orderId: form.get('var1')?.trim() || null,
    payState: parsePayAppInteger(form.get('pay_state')),
    price: parsePayAppInteger(form.get('price')),
    origPrice: parsePayAppInteger(form.get('orig_price')),
    payType: parsePayAppInteger(form.get('pay_type')),
    payDate,
    cancelDate,
    dateParseFailed: (payDateText !== null && payDate === null) ||
      (cancelDateText !== null && cancelDate === null),
    feedbackType: parsePayAppInteger(form.get('feedbacktype')),
  }
}
