import 'server-only'

type TossEnvironment = 'test' | 'live'

interface TossCard {
  issuerCode?: string | null
  issuerName?: string | null
}

interface TossEasyPay {
  provider?: string | null
}

interface TossCancel {
  transactionKey?: string | null
  cancelStatus?: string | null
  canceledAt?: string | null
  cancelAmount?: number | null
}

export interface TossPayment {
  paymentKey: string
  orderId: string
  orderName: string
  status: string
  currency: string
  totalAmount: number
  method: string
  approvedAt: string | null
  mId?: string
  card?: TossCard | null
  easyPay?: TossEasyPay | null
  cancels?: TossCancel[] | null
}

interface TossErrorBody {
  code?: string
  message?: string
}

interface TossReadyConfig {
  clientKey: string
  secretKey: string
  environment: TossEnvironment
  mid: string
  paymentVariantKey: string
  agreementVariantKey: string
}

export class TossPaymentsError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'TossPaymentsError'
    this.code = code
    this.status = status
  }
}

function getKeyEnvironment(key: string): TossEnvironment | null {
  if (key.startsWith('test_')) return 'test'
  if (key.startsWith('live_')) return 'live'
  return null
}

function getTossPaymentsConfig(): TossReadyConfig {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ?? ''
  const secretKey = process.env.TOSS_SECRET_KEY?.trim() ?? ''
  const mid = process.env.TOSS_MID?.trim() ?? ''
  const paymentVariantKey =
    process.env.NEXT_PUBLIC_TOSS_PAYMENT_WIDGET_VARIANT_KEY?.trim() ?? ''
  const agreementVariantKey =
    process.env.NEXT_PUBLIC_TOSS_AGREEMENT_VARIANT_KEY?.trim() ?? ''
  const clientEnvironment = getKeyEnvironment(clientKey)
  const secretEnvironment = getKeyEnvironment(secretKey)

  if (
    !clientEnvironment ||
    !secretEnvironment ||
    clientEnvironment !== secretEnvironment ||
    !mid ||
    !paymentVariantKey ||
    !agreementVariantKey
  ) {
    throw new TossPaymentsError(
      'PAYMENT_CONFIGURATION_INVALID',
      '결제 설정을 확인할 수 없습니다.',
      503
    )
  }

  return {
    clientKey,
    secretKey,
    environment: secretEnvironment,
    mid,
    paymentVariantKey,
    agreementVariantKey,
  }
}

export function assertTossPaymentsReady(): TossReadyConfig {
  if (
    process.env.PAYMENTS_ENABLED !== 'true' ||
    process.env.TOSS_PAYMENTS_ENABLED !== 'true'
  ) {
    throw new TossPaymentsError(
      'PAYMENTS_DISABLED',
      '현재 포인트 충전 기능을 준비 중입니다.',
      503
    )
  }

  return getTossPaymentsConfig()
}

export function getTossCheckoutConfig() {
  const config = assertTossPaymentsReady()
  return {
    clientKey: config.clientKey,
    paymentVariantKey: config.paymentVariantKey,
    agreementVariantKey: config.agreementVariantKey,
  }
}

async function parseTossResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & TossErrorBody

  if (!response.ok) {
    throw new TossPaymentsError(
      body.code ?? 'TOSS_REQUEST_FAILED',
      body.message ?? '결제사 요청을 처리하지 못했습니다.',
      response.status
    )
  }

  return body
}

export async function confirmTossPayment(input: {
  paymentKey: string
  orderId: string
  amount: number
  idempotencyKey: string
}) {
  const config = getTossPaymentsConfig()
  const response = await fetch(
    'https://api.tosspayments.com/v1/payments/confirm',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        paymentKey: input.paymentKey,
        orderId: input.orderId,
        amount: input.amount,
      }),
      cache: 'no-store',
    }
  )

  return parseTossResponse<TossPayment>(response)
}

export async function cancelTossPayment(input: {
  paymentKey: string
  cancelReason: string
  idempotencyKey: string
}) {
  const config = getTossPaymentsConfig()
  const response = await fetch(
    `https://api.tosspayments.com/v1/payments/${encodeURIComponent(input.paymentKey)}/cancel`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({ cancelReason: input.cancelReason }),
      cache: 'no-store',
    }
  )

  return parseTossResponse<TossPayment>(response)
}

export async function getTossPaymentByPaymentKey(paymentKey: string) {
  const config = getTossPaymentsConfig()
  const response = await fetch(
    `https://api.tosspayments.com/v1/payments/${encodeURIComponent(paymentKey)}`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString('base64')}`,
      },
      cache: 'no-store',
    }
  )

  return parseTossResponse<TossPayment>(response)
}

export function validateConfirmedPayment(
  payment: TossPayment,
  expected: {
    paymentKey: string
    orderId: string
    amount: number
    mid: string
  }
): asserts payment is TossPayment & { approvedAt: string } {
  if (
    payment.paymentKey !== expected.paymentKey ||
    payment.orderId !== expected.orderId ||
    payment.totalAmount !== expected.amount ||
    payment.currency !== 'KRW' ||
    payment.status !== 'DONE' ||
    !payment.approvedAt ||
    payment.mId !== expected.mid
  ) {
    throw new TossPaymentsError(
      'PAYMENT_CONFIRMATION_MISMATCH',
      '승인된 결제 정보가 주문과 일치하지 않습니다.',
      409
    )
  }
}

const ALLOWED_EASY_PAY_PROVIDERS = new Set([
  '카카오페이',
  '네이버페이',
  '페이코',
  '토스페이',
])

export function isAllowedPointChargeMethod(payment: TossPayment) {
  if (payment.method === '카드' || payment.method === 'CARD') {
    const issuer = `${payment.card?.issuerCode ?? ''} ${payment.card?.issuerName ?? ''}`
      .trim()
      .toUpperCase()
    return !issuer.includes('하나') && !issuer.includes('HANA')
  }

  if (payment.method === '간편결제' || payment.method === 'EASY_PAY') {
    return ALLOWED_EASY_PAY_PROVIDERS.has(payment.easyPay?.provider ?? '')
  }

  return false
}

export function getCompletedFullCancellation(
  payment: TossPayment,
  expectedAmount: number
) {
  const completed = payment.cancels
    ?.filter((cancel) => cancel.cancelStatus === 'DONE')
    .at(-1)

  if (
    payment.status !== 'CANCELED' ||
    !completed?.transactionKey ||
    !completed.canceledAt ||
    completed.cancelAmount !== expectedAmount
  ) {
    throw new TossPaymentsError(
      'PAYMENT_CANCEL_MISMATCH',
      '결제 취소 결과를 확인할 수 없습니다.',
      502
    )
  }

  return {
    transactionKey: completed.transactionKey,
    canceledAt: completed.canceledAt,
  }
}

export function validateTossRefundPaymentSnapshot(
  payment: TossPayment,
  expected: {
    paymentKey: string
    orderId: string
    amount: number
    mid: string
  }
) {
  if (
    payment.paymentKey !== expected.paymentKey ||
    payment.orderId !== expected.orderId ||
    payment.totalAmount !== expected.amount ||
    payment.currency !== 'KRW' ||
    payment.mId !== expected.mid
  ) {
    throw new TossPaymentsError(
      'PAYMENT_REFUND_MISMATCH',
      '환불할 결제 정보가 주문과 일치하지 않습니다.',
      409
    )
  }
}
