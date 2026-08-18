import 'server-only'

import {
  cancelKakaoPayPayment,
  getKakaoPayOrder,
  KakaoPayError,
  validateCompletedKakaoPayCancellation,
  validateFreshKakaoPayOrder,
  validateFullKakaoPayCancellation,
} from '@/lib/kakaopay-server'
import {
  claimPointChargeRefund,
  failPointChargeRefund,
  finalizePointChargeRefund,
  type ClaimedPointChargeRefund,
} from '@/lib/point-charge-refunds-server'
import {
  cancelTossPayment,
  getCompletedFullCancellation,
  getTossPaymentByPaymentKey,
  TossPaymentsError,
  validateTossRefundPaymentSnapshot,
} from '@/lib/toss-payments-server'

export class PointChargeRefundProcessingError extends Error {
  readonly code: string
  readonly status: number
  readonly retryable: boolean

  constructor(input: {
    code: string
    message: string
    status: number
    retryable: boolean
  }) {
    super(input.message)
    this.name = 'PointChargeRefundProcessingError'
    this.code = input.code
    this.status = input.status
    this.retryable = input.retryable
  }
}

function invalidRefundSnapshot(message = '환불할 원 결제 정보를 확인할 수 없습니다.') {
  return new PointChargeRefundProcessingError({
    code: 'REFUND_PAYMENT_SNAPSHOT_INVALID',
    message,
    status: 409,
    retryable: false,
  })
}

function normalizeRefundError(error: unknown) {
  if (error instanceof PointChargeRefundProcessingError) return error

  if (error instanceof KakaoPayError) {
    return new PointChargeRefundProcessingError({
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.outcome === 'outcome_unknown',
    })
  }

  if (error instanceof TossPaymentsError) {
    return new PointChargeRefundProcessingError({
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.status === 408 || error.status === 429 || error.status >= 500,
    })
  }

  return new PointChargeRefundProcessingError({
    code: 'REFUND_PROCESSING_FAILED',
    message:
      error instanceof Error
        ? error.message
        : '환불 처리 결과를 확인해야 합니다.',
    status: 502,
    retryable: true,
  })
}

async function processTossRefund(
  claimed: ClaimedPointChargeRefund,
  cancelReason: string
) {
  if (
    !claimed.payment_key ||
    !claimed.provider_order_id ||
    !claimed.provider_merchant_id ||
    !claimed.cancel_idempotency_key ||
    !claimed.refund_amount
  ) {
    throw invalidRefundSnapshot()
  }

  const expected = {
    paymentKey: claimed.payment_key,
    orderId: claimed.provider_order_id,
    amount: claimed.refund_amount,
    mid: claimed.provider_merchant_id,
  }
  const currentPayment = await getTossPaymentByPaymentKey(claimed.payment_key)
  validateTossRefundPaymentSnapshot(currentPayment, expected)

  if (currentPayment.status === 'CANCELED') {
    return {
      ...getCompletedFullCancellation(currentPayment, claimed.refund_amount),
      providerStatus: 'CANCELED',
    }
  }

  if (currentPayment.status !== 'DONE') {
    throw invalidRefundSnapshot('환불할 일반결제 상태를 확인할 수 없습니다.')
  }

  const canceledPayment = await cancelTossPayment({
    paymentKey: claimed.payment_key,
    cancelReason,
    idempotencyKey: claimed.cancel_idempotency_key,
  })
  validateTossRefundPaymentSnapshot(canceledPayment, expected)

  return {
    ...getCompletedFullCancellation(canceledPayment, claimed.refund_amount),
    providerStatus: 'CANCELED',
  }
}

async function processKakaoPayRefund(claimed: ClaimedPointChargeRefund) {
  if (
    !claimed.provider_transaction_id ||
    !claimed.provider_approval_id ||
    !claimed.provider_merchant_id ||
    !claimed.partner_order_id ||
    !claimed.partner_user_id ||
    !claimed.refund_amount ||
    claimed.tax_free_amount === undefined ||
    claimed.vat_amount === undefined
  ) {
    throw invalidRefundSnapshot()
  }

  const expected = {
    cid: claimed.provider_merchant_id,
    tid: claimed.provider_transaction_id,
    approvalId: claimed.provider_approval_id,
    partnerOrderId: claimed.partner_order_id,
    partnerUserId: claimed.partner_user_id,
    totalAmount: claimed.refund_amount,
    taxFreeAmount: claimed.tax_free_amount,
    vatAmount: claimed.vat_amount,
  }
  const currentPayment = await getKakaoPayOrder(claimed.provider_transaction_id)

  if (currentPayment.status === 'CANCEL_PAYMENT') {
    return validateCompletedKakaoPayCancellation(currentPayment, expected)
  }

  if (currentPayment.status === 'PART_CANCEL_PAYMENT') {
    throw new PointChargeRefundProcessingError({
      code: 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
      message: '부분 취소된 카카오페이 결제는 수동 확인이 필요합니다.',
      status: 409,
      retryable: false,
    })
  }

  if (currentPayment.status !== 'SUCCESS_PAYMENT') {
    throw invalidRefundSnapshot('환불할 카카오페이 결제 상태를 확인할 수 없습니다.')
  }

  validateFreshKakaoPayOrder(currentPayment, expected)
  const canceledPayment = await cancelKakaoPayPayment({
    tid: claimed.provider_transaction_id,
    cancelAmount: claimed.refund_amount,
    cancelTaxFreeAmount: claimed.tax_free_amount,
    cancelVatAmount: claimed.vat_amount,
  })

  return validateFullKakaoPayCancellation(canceledPayment, expected)
}

export async function processPointChargeRefund(input: {
  requestId: string
  adminId: string
  adminNote: string | null
}) {
  let claimed: ClaimedPointChargeRefund | null = null

  try {
    claimed = await claimPointChargeRefund(input)
    if (claimed.already_completed) {
      return { alreadyCompleted: true, claimed, newBalance: null }
    }

    const cancellation = claimed.provider === 'toss'
      ? await processTossRefund(
          claimed,
          input.adminNote || '충전 크레딧 환불 승인'
        )
      : claimed.provider === 'kakaopay'
        ? await processKakaoPayRefund(claimed)
        : (() => {
            throw invalidRefundSnapshot('지원하지 않는 결제수단입니다.')
          })()

    const result = await finalizePointChargeRefund({
      requestId: input.requestId,
      cancelTransactionKey: cancellation.transactionKey,
      cancelledAt: cancellation.canceledAt,
      providerStatus: cancellation.providerStatus,
    })

    return {
      alreadyCompleted: false,
      claimed,
      newBalance: result.new_balance,
    }
  } catch (error) {
    const normalized = normalizeRefundError(error)
    if (claimed && !claimed.already_completed) {
      await failPointChargeRefund({
        requestId: input.requestId,
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      }).catch(() => undefined)
    }
    throw normalized
  }
}
