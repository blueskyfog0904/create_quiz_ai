import 'server-only'

import { z } from 'zod'

type KakaoPayEnvironment = 'test' | 'live'
type KakaoPayOperation = 'ready' | 'approve' | 'order' | 'cancel'
type KakaoPayOutcome = 'definite_failure' | 'outcome_unknown'

const KAKAOPAY_API_BASE_URL = 'https://open-api.kakaopay.com'
const KAKAOPAY_REQUEST_TIMEOUT_MS = 11_000

const kakaoAmountSchema = z.object({
  total: z.number().int().nonnegative(),
  tax_free: z.number().int().nonnegative(),
  vat: z.number().int().nonnegative(),
  point: z.number().int().nonnegative().optional(),
  discount: z.number().int().nonnegative().optional(),
  green_deposit: z.number().int().nonnegative().optional(),
}).passthrough()

const kakaoReadyResponseSchema = z.object({
  tid: z.string().min(1),
  next_redirect_app_url: z.string().url(),
  next_redirect_mobile_url: z.string().url(),
  next_redirect_pc_url: z.string().url(),
  created_at: z.string().min(1),
}).passthrough()

const kakaoApproveResponseSchema = z.object({
  aid: z.string().min(1),
  tid: z.string().min(1),
  cid: z.string().min(1),
  partner_order_id: z.string().min(1),
  partner_user_id: z.string().min(1),
  payment_method_type: z.enum(['MONEY', 'CARD']),
  item_name: z.string().min(1),
  quantity: z.number().int().positive(),
  amount: kakaoAmountSchema,
  created_at: z.string().min(1),
  approved_at: z.string().min(1),
}).passthrough()

const kakaoPaymentActionSchema = z.object({
  aid: z.string().min(1),
  payment_action_type: z.enum(['PAYMENT', 'CANCEL', 'ISSUED_SID']),
}).passthrough()

const kakaoOfficialPaymentStatusSchema = z.enum([
  'READY',
  'SEND_TMS',
  'OPEN_PAYMENT',
  'SELECT_METHOD',
  'ARS_WAITING',
  'AUTH_PASSWORD',
  'ISSUED_SID',
  'SUCCESS_PAYMENT',
  'PART_CANCEL_PAYMENT',
  'CANCEL_PAYMENT',
  'FAIL_AUTH_PASSWORD',
  'QUIT_PAYMENT',
  'FAIL_PAYMENT',
])
const kakaoPaymentStatusSchema = z.union([
  kakaoOfficialPaymentStatusSchema,
  z.string().min(1),
])

const kakaoOrderResponseSchema = z.object({
  tid: z.string().min(1),
  cid: z.string().min(1),
  status: kakaoPaymentStatusSchema,
  partner_order_id: z.string().min(1),
  partner_user_id: z.string().min(1),
  payment_method_type: z.enum(['MONEY', 'CARD']),
  amount: kakaoAmountSchema,
  canceled_amount: kakaoAmountSchema.optional(),
  cancel_available_amount: kakaoAmountSchema.optional(),
  item_name: z.string().min(1),
  quantity: z.number().int().positive(),
  created_at: z.string().min(1),
  approved_at: z.string().min(1).nullable().optional(),
  canceled_at: z.string().min(1).nullable().optional(),
  payment_action_details: z.array(kakaoPaymentActionSchema).optional(),
}).passthrough()

const kakaoCancelResponseSchema = kakaoOrderResponseSchema.extend({
  aid: z.string().min(1),
  status: z.enum(['PART_CANCEL_PAYMENT', 'CANCEL_PAYMENT']),
  canceled_amount: kakaoAmountSchema,
  cancel_available_amount: kakaoAmountSchema,
  canceled_at: z.string().min(1),
}).passthrough()

type KakaoReadyResponse = z.infer<typeof kakaoReadyResponseSchema>
export type KakaoApproveResponse = z.infer<typeof kakaoApproveResponseSchema>
export type KakaoOrderResponse = z.infer<typeof kakaoOrderResponseSchema>
export type KakaoCancelResponse = z.infer<typeof kakaoCancelResponseSchema>

interface KakaoPayConfig {
  cid: string
  secretKey: string
  environment: KakaoPayEnvironment
  callbackOrigin: string
}

interface KakaoPayErrorInput {
  code: string
  message: string
  status: number
  operation: KakaoPayOperation
  outcome: KakaoPayOutcome
}

export class KakaoPayError extends Error {
  readonly code: string
  readonly status: number
  readonly operation: KakaoPayOperation
  readonly outcome: KakaoPayOutcome

  constructor(input: KakaoPayErrorInput) {
    super(input.message)
    this.name = 'KakaoPayError'
    this.code = input.code
    this.status = input.status
    this.operation = input.operation
    this.outcome = input.outcome
  }
}

function configurationError(
  operation: KakaoPayOperation,
  message = '카카오페이 결제 설정을 확인할 수 없습니다.'
) {
  return new KakaoPayError({
    code: 'KAKAOPAY_CONFIGURATION_INVALID',
    message,
    status: 503,
    operation,
    outcome: 'definite_failure',
  })
}

function getKakaoPayConfig(operation: KakaoPayOperation): KakaoPayConfig {
  const environment = process.env.KAKAOPAY_ENVIRONMENT?.trim()
  const cid = process.env.KAKAOPAY_CID?.trim() ?? ''
  const secretKey = process.env.KAKAOPAY_SECRET_KEY?.trim() ?? ''
  const callbackOrigin = process.env.PAYMENT_CALLBACK_ORIGIN?.trim() ?? ''

  if (environment !== 'test' && environment !== 'live') {
    throw configurationError(operation)
  }

  if (
    !cid ||
    !secretKey ||
    (environment === 'test' && cid !== 'TC0ONETIME') ||
    (environment === 'live' && cid === 'TC0ONETIME')
  ) {
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
    cid,
    secretKey,
    environment,
    callbackOrigin: callbackUrl.origin,
  }
}

export function assertKakaoPayReady(): KakaoPayConfig {
  if (
    process.env.PAYMENTS_ENABLED !== 'true' ||
    process.env.KAKAOPAY_PAYMENTS_ENABLED !== 'true'
  ) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_DISABLED',
      message: '현재 카카오페이 충전 기능을 준비 중입니다.',
      status: 503,
      operation: 'ready',
      outcome: 'definite_failure',
    })
  }

  return getKakaoPayConfig('ready')
}

export function getKakaoPayCallbackOrigin() {
  return getKakaoPayConfig('order').callbackOrigin
}

function validateCallbackUrl(value: string, config: KakaoPayConfig) {
  let callbackUrl: URL
  try {
    callbackUrl = new URL(value)
  } catch {
    throw configurationError(
      'ready',
      '카카오페이 복귀 주소를 확인할 수 없습니다.'
    )
  }

  if (
    callbackUrl.protocol !== 'https:' ||
    callbackUrl.origin !== config.callbackOrigin ||
    callbackUrl.username ||
    callbackUrl.password ||
    callbackUrl.hash ||
    callbackUrl.href.length > 255
  ) {
    throw configurationError(
      'ready',
      '카카오페이 복귀 주소를 확인할 수 없습니다.'
    )
  }

  return callbackUrl.href
}

function validateChargeAmounts(input: {
  totalAmount: number
  taxFreeAmount: number
  vatAmount: number
}) {
  if (
    !Number.isInteger(input.totalAmount) ||
    input.totalAmount < 1 ||
    input.totalAmount > 100_000 ||
    input.taxFreeAmount !== 0 ||
    input.vatAmount !== Math.round(input.totalAmount / 11)
  ) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_AMOUNT_INVALID',
      message: '결제 금액 정보를 확인할 수 없습니다.',
      status: 400,
      operation: 'ready',
      outcome: 'definite_failure',
    })
  }
}

function getProviderErrorCode(body: unknown) {
  if (!body || typeof body !== 'object') return 'KAKAOPAY_REQUEST_FAILED'
  const value = Reflect.get(body, 'error_code')
  return typeof value === 'string' || typeof value === 'number'
    ? `KAKAOPAY_${String(value)}`
    : 'KAKAOPAY_REQUEST_FAILED'
}

async function callKakaoPay<T>(input: {
  operation: KakaoPayOperation
  path: string
  body: Record<string, unknown>
  schema: z.ZodType<T>
  config: KakaoPayConfig
}) {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    KAKAOPAY_REQUEST_TIMEOUT_MS
  )

  try {
    const response = await fetch(`${KAKAOPAY_API_BASE_URL}${input.path}`, {
      method: 'POST',
      headers: {
        Authorization: `SECRET_KEY ${input.config.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input.body),
      cache: 'no-store',
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      throw new KakaoPayError({
        code: getProviderErrorCode(body),
        message: '카카오페이 요청을 처리하지 못했습니다.',
        status: response.status,
        operation: input.operation,
        outcome: response.status >= 500
          ? 'outcome_unknown'
          : 'definite_failure',
      })
    }

    const parsed = input.schema.safeParse(body)
    if (!parsed.success) {
      throw new KakaoPayError({
        code: 'KAKAOPAY_RESPONSE_INVALID',
        message: '카카오페이 처리 결과를 확인해야 합니다.',
        status: 502,
        operation: input.operation,
        outcome: 'outcome_unknown',
      })
    }

    return parsed.data
  } catch (error) {
    if (error instanceof KakaoPayError) throw error

    throw new KakaoPayError({
      code: error instanceof Error && error.name === 'AbortError'
        ? 'KAKAOPAY_REQUEST_TIMEOUT'
        : 'KAKAOPAY_NETWORK_ERROR',
      message: '카카오페이 처리 결과를 확인해야 합니다.',
      status: error instanceof Error && error.name === 'AbortError' ? 504 : 502,
      operation: input.operation,
      outcome: 'outcome_unknown',
    })
  } finally {
    clearTimeout(timeout)
  }
}

export async function readyKakaoPayPayment(input: {
  partnerOrderId: string
  partnerUserId: string
  itemName: string
  itemCode?: string
  totalAmount: number
  taxFreeAmount: number
  vatAmount: number
  approvalUrl: string
  cancelUrl: string
  failUrl: string
}) {
  const config = assertKakaoPayReady()
  validateChargeAmounts(input)

  return callKakaoPay<KakaoReadyResponse>({
    operation: 'ready',
    path: '/online/v1/payment/ready',
    config,
    schema: kakaoReadyResponseSchema,
    body: {
      cid: config.cid,
      partner_order_id: input.partnerOrderId,
      partner_user_id: input.partnerUserId,
      item_name: input.itemName,
      ...(input.itemCode ? { item_code: input.itemCode } : {}),
      quantity: 1,
      total_amount: input.totalAmount,
      tax_free_amount: input.taxFreeAmount,
      vat_amount: input.vatAmount,
      payment_method_type: 'MONEY',
      approval_url: validateCallbackUrl(input.approvalUrl, config),
      cancel_url: validateCallbackUrl(input.cancelUrl, config),
      fail_url: validateCallbackUrl(input.failUrl, config),
    },
  })
}

export async function approveKakaoPayPayment(input: {
  tid: string
  partnerOrderId: string
  partnerUserId: string
  pgToken: string
}) {
  const config = getKakaoPayConfig('approve')
  return callKakaoPay<KakaoApproveResponse>({
    operation: 'approve',
    path: '/online/v1/payment/approve',
    config,
    schema: kakaoApproveResponseSchema,
    body: {
      cid: config.cid,
      tid: input.tid,
      partner_order_id: input.partnerOrderId,
      partner_user_id: input.partnerUserId,
      pg_token: input.pgToken,
    },
  })
}

export async function getKakaoPayOrder(tid: string) {
  const config = getKakaoPayConfig('order')
  return callKakaoPay<KakaoOrderResponse>({
    operation: 'order',
    path: '/online/v1/payment/order',
    config,
    schema: kakaoOrderResponseSchema,
    body: {
      cid: config.cid,
      tid,
    },
  })
}

export async function cancelKakaoPayPayment(input: {
  tid: string
  cancelAmount: number
  cancelTaxFreeAmount: number
  cancelVatAmount: number
}) {
  const config = getKakaoPayConfig('cancel')
  return callKakaoPay<KakaoCancelResponse>({
    operation: 'cancel',
    path: '/online/v1/payment/cancel',
    config,
    schema: kakaoCancelResponseSchema,
    body: {
      cid: config.cid,
      tid: input.tid,
      cancel_amount: input.cancelAmount,
      cancel_tax_free_amount: input.cancelTaxFreeAmount,
      cancel_vat_amount: input.cancelVatAmount,
    },
  })
}

interface ExpectedKakaoPayment {
  cid: string
  tid: string
  approvalId: string
  partnerOrderId: string
  partnerUserId: string
  totalAmount: number
  taxFreeAmount: number
  vatAmount: number
}

function hasExpectedPaymentSnapshot(
  payment: KakaoApproveResponse | KakaoOrderResponse,
  expected: Omit<ExpectedKakaoPayment, 'approvalId'>
) {
  return payment.cid === expected.cid &&
    payment.tid === expected.tid &&
    payment.partner_order_id === expected.partnerOrderId &&
    payment.partner_user_id === expected.partnerUserId &&
    payment.payment_method_type === 'MONEY' &&
    payment.amount.total === expected.totalAmount &&
    payment.amount.tax_free === expected.taxFreeAmount &&
    payment.amount.vat === expected.vatAmount
}

export function validateKakaoPayOrderSnapshot(
  payment: KakaoOrderResponse,
  expected: Omit<ExpectedKakaoPayment, 'approvalId'>
) {
  if (!hasExpectedPaymentSnapshot(payment, expected)) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_ORDER_MISMATCH',
      message: '카카오페이 주문 정보가 저장된 결제와 일치하지 않습니다.',
      status: 409,
      operation: 'order',
      outcome: 'definite_failure',
    })
  }
}

export function getCompletedKakaoPayPayment(
  payment: KakaoOrderResponse,
  expected: Omit<ExpectedKakaoPayment, 'approvalId'>
) {
  validateKakaoPayOrderSnapshot(payment, expected)
  const approvalAction = payment.payment_action_details
    ?.filter((action) => action.payment_action_type === 'PAYMENT')
    .at(-1)

  if (
    payment.status !== 'SUCCESS_PAYMENT' ||
    !payment.approved_at ||
    !approvalAction?.aid
  ) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_ORDER_NOT_COMPLETED',
      message: '완료된 카카오페이 승인 정보를 확인할 수 없습니다.',
      status: 409,
      operation: 'order',
      outcome: 'definite_failure',
    })
  }

  return {
    approvalId: approvalAction.aid,
    approvedAt: payment.approved_at,
    paymentMethodType: payment.payment_method_type,
    providerStatus: payment.status,
  }
}

export function validateApprovedKakaoPayPayment(
  payment: KakaoApproveResponse,
  expected: ExpectedKakaoPayment
) {
  if (
    payment.aid !== expected.approvalId ||
    !hasExpectedPaymentSnapshot(payment, expected)
  ) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_APPROVAL_MISMATCH',
      message: '승인된 카카오페이 정보가 주문과 일치하지 않습니다.',
      status: 409,
      operation: 'approve',
      outcome: 'definite_failure',
    })
  }
}

export function validateFreshKakaoPayOrder(
  payment: KakaoOrderResponse,
  expected: ExpectedKakaoPayment
) {
  const completedPayment = getCompletedKakaoPayPayment(payment, expected)

  if (
    completedPayment.approvalId !== expected.approvalId
  ) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_ORDER_MISMATCH',
      message: '카카오페이 주문 상태를 확인할 수 없습니다.',
      status: 409,
      operation: 'order',
      outcome: 'definite_failure',
    })
  }
}

export function validateFullKakaoPayCancellation(
  payment: KakaoCancelResponse,
  expected: Omit<ExpectedKakaoPayment, 'approvalId'>
) {
  if (
    payment.status !== 'CANCEL_PAYMENT' ||
    payment.cid !== expected.cid ||
    payment.tid !== expected.tid ||
    payment.partner_order_id !== expected.partnerOrderId ||
    payment.partner_user_id !== expected.partnerUserId ||
    payment.payment_method_type !== 'MONEY' ||
    payment.amount.total !== expected.totalAmount ||
    payment.amount.tax_free !== expected.taxFreeAmount ||
    payment.amount.vat !== expected.vatAmount ||
    payment.canceled_amount.total !== expected.totalAmount ||
    payment.canceled_amount.tax_free !== expected.taxFreeAmount ||
    payment.canceled_amount.vat !== expected.vatAmount ||
    payment.cancel_available_amount.total !== 0
  ) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_CANCEL_MISMATCH',
      message: '카카오페이 취소 결과를 확인할 수 없습니다.',
      status: 502,
      operation: 'cancel',
      outcome: 'outcome_unknown',
    })
  }

  return {
    transactionKey: payment.aid,
    canceledAt: payment.canceled_at,
    providerStatus: payment.status,
  }
}

export function validateCompletedKakaoPayCancellation(
  payment: KakaoOrderResponse,
  expected: Omit<ExpectedKakaoPayment, 'approvalId'>
) {
  const cancelAction = payment.payment_action_details
    ?.filter((action) => action.payment_action_type === 'CANCEL')
    .at(-1)

  if (
    payment.status !== 'CANCEL_PAYMENT' ||
    !payment.canceled_at ||
    !payment.canceled_amount ||
    !payment.cancel_available_amount ||
    !cancelAction?.aid ||
    payment.cid !== expected.cid ||
    payment.tid !== expected.tid ||
    payment.partner_order_id !== expected.partnerOrderId ||
    payment.partner_user_id !== expected.partnerUserId ||
    payment.payment_method_type !== 'MONEY' ||
    payment.amount.total !== expected.totalAmount ||
    payment.amount.tax_free !== expected.taxFreeAmount ||
    payment.amount.vat !== expected.vatAmount ||
    payment.canceled_amount.total !== expected.totalAmount ||
    payment.canceled_amount.tax_free !== expected.taxFreeAmount ||
    payment.canceled_amount.vat !== expected.vatAmount ||
    payment.cancel_available_amount.total !== 0
  ) {
    throw new KakaoPayError({
      code: 'KAKAOPAY_CANCEL_MISMATCH',
      message: '카카오페이 취소 결과를 확인할 수 없습니다.',
      status: 409,
      operation: 'order',
      outcome: 'definite_failure',
    })
  }

  return {
    transactionKey: cancelAction.aid,
    canceledAt: payment.canceled_at,
    providerStatus: payment.status,
  }
}
