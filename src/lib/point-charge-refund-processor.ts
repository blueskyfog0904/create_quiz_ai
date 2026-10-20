import 'server-only'

import {
  cancelKakaoPayPayment,
  getKakaoPayOrder,
  KakaoPayError,
  validateCompletedKakaoPayCancellation,
  validateFreshKakaoPayOrder,
  validateFullKakaoPayCancellation,
} from '@/lib/kakaopay-server'
import { cancelPayAppPayment, PayAppError } from '@/lib/payapp-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import {
  claimPointChargeRefund,
  failPointChargeRefund,
  finalizePointChargeRefund,
  quarantineKakaoPayPartialCancellation,
  recordKakaoPayPartialCancelMarker,
  RefundRpcError,
  type ClaimedPointChargeRefund,
} from '@/lib/point-charge-refunds-server'

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

  if (error instanceof RefundRpcError) {
    return new PointChargeRefundProcessingError({
      code: error.code,
      message: error.message,
      status: error.retryable ? 503 : 409,
      retryable: error.retryable,
    })
  }

  // 수동 처리로 넘기는 것은 페이앱이 취소를 거절한 경우(state=0)뿐이다.
  // 설정·입력 오류는 취소를 보내지 않은 것이므로 고친 뒤 다시 승인할 수 있게 둔다.
  if (error instanceof PayAppError) {
    const provider = [error.providerErrorCode, error.providerMessage].filter(Boolean).join(': ')
    return new PointChargeRefundProcessingError({
      code: error.code,
      message: provider ? `${error.message} (${provider})` : error.message,
      status: error.status,
      retryable: error.code !== 'PAYAPP_REQUEST_REJECTED',
    })
  }

  if (error instanceof KakaoPayError) {
    return new PointChargeRefundProcessingError({
      code: error.code,
      message: error.message,
      status: error.status,
      retryable: error.outcome === 'outcome_unknown',
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

// 페이앱은 전취소만 한다. state=0(정산 후·휴대폰 당월 경과 등)은 수동 처리로 넘어간다.
async function processPayAppRefund(claimed: ClaimedPointChargeRefund) {
  if (!claimed.provider_transaction_id || !claimed.refund_amount) {
    throw invalidRefundSnapshot()
  }

  await cancelPayAppPayment({
    mulNo: claimed.provider_transaction_id,
    memo: `환불 요청 ${claimed.request_id}`,
  })

  return {
    transactionKey: `payapp-cancel:${claimed.provider_transaction_id}`,
    canceledAt: new Date().toISOString(),
    providerStatus: 'CANCELED',
  }
}

// 카카오 부분취소를 확인하면 표식을 먼저 남기고 격리한다. 실패해도 표식이 남아 대사가 이어받는다.
async function quarantineKakaoPayPartialCancel(
  claimed: ClaimedPointChargeRefund,
  knownStatus?: string,
  knownCancelledAmount?: number | null
) {
  if (!claimed.payment_order_id || !claimed.provider_transaction_id) return

  try {
    let status = knownStatus
    let cancelledAmount = knownCancelledAmount ?? null
    if (!status) {
      const payment = await getKakaoPayOrder(claimed.provider_transaction_id)
      status = payment.status
      cancelledAmount = payment.canceled_amount?.total ?? null
    }
    if (status !== 'PART_CANCEL_PAYMENT') return

    await recordKakaoPayPartialCancelMarker({
      paymentOrderId: claimed.payment_order_id,
      providerStatus: status,
    })
    await quarantineKakaoPayPartialCancellation({
      paymentOrderId: claimed.payment_order_id,
      providerStatus: status,
      cancelledAmount,
    })
  } catch (error) {
    console.error('[PointChargeRefund] KakaoPay partial cancel quarantine deferred', {
      requestId: claimed.request_id,
      errorCode: error instanceof RefundRpcError || error instanceof KakaoPayError
        ? error.code
        : 'UNKNOWN',
    })
  }
}

class KakaoPayPartialCancelDetected extends PointChargeRefundProcessingError {
  readonly cancelledAmount: number | null

  constructor(cancelledAmount: number | null) {
    super({
      code: 'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
      message: '부분 취소된 카카오페이 결제는 수동 확인이 필요합니다.',
      status: 409,
      retryable: false,
    })
    this.cancelledAmount = cancelledAmount
  }
}

async function processKakaoPayRefund(
  claimed: ClaimedPointChargeRefund,
  onCancelAttempt: () => void
) {
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
    throw new KakaoPayPartialCancelDetected(currentPayment.canceled_amount?.total ?? null)
  }

  if (currentPayment.status !== 'SUCCESS_PAYMENT') {
    throw invalidRefundSnapshot('환불할 카카오페이 결제 상태를 확인할 수 없습니다.')
  }

  validateFreshKakaoPayOrder(currentPayment, expected)
  onCancelAttempt()
  const canceledPayment = await cancelKakaoPayPayment({
    tid: claimed.provider_transaction_id,
    cancelAmount: claimed.refund_amount,
    cancelTaxFreeAmount: claimed.tax_free_amount,
    cancelVatAmount: claimed.vat_amount,
  })

  return validateFullKakaoPayCancellation(canceledPayment, expected)
}

async function isRefundRequestCompleted(requestId: string) {
  const admin = createPaymentAdminClient()
  const { data } = await admin
    .from('refund_requests')
    .select('status')
    .eq('id', requestId)
    .maybeSingle()
  return data?.status === 'completed'
}

export async function processPointChargeRefund(input: {
  requestId: string
  adminId: string
  adminNote: string | null
}) {
  let claimed: ClaimedPointChargeRefund | null = null
  let kakaoCancelAttempted = false

  try {
    claimed = await claimPointChargeRefund(input)
    if (claimed.already_completed) {
      return { alreadyCompleted: true, claimed, newBalance: null }
    }

    const cancellation = claimed.provider === 'kakaopay'
      ? await processKakaoPayRefund(claimed, () => {
          kakaoCancelAttempted = true
        })
      : claimed.provider === 'payapp'
        ? await processPayAppRefund(claimed)
        : (() => {
            throw invalidRefundSnapshot('지원하지 않는 결제수단입니다.')
          })()

    const result = await finalizePointChargeRefund({
      requestId: input.requestId,
      cancelTransactionKey: cancellation.transactionKey,
      cancelledAt: cancellation.canceledAt,
      providerStatus: cancellation.providerStatus,
    })

    // 그사이 통보가 같은 환불을 완료했으면 알림은 통보 쪽이 이미 보냈다.
    return {
      alreadyCompleted: result.already_completed,
      claimed,
      newBalance: result.new_balance,
    }
  } catch (error) {
    const normalized = normalizeRefundError(error)

    // 그사이 통보·대사가 같은 환불을 완료했으면(교착으로 이쪽만 롤백된 경우 등) 성공으로 응답한다.
    if (claimed && !claimed.already_completed && await isRefundRequestCompleted(input.requestId)) {
      return { alreadyCompleted: true, claimed, newBalance: null }
    }

    if (claimed && !claimed.already_completed) {
      await failPointChargeRefund({
        requestId: input.requestId,
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      }).catch(() => undefined)

      // 실패 기록 직전에 통보가 완료했으면 실패 기록은 아무것도 바꾸지 않는다.
      if (await isRefundRequestCompleted(input.requestId)) {
        return { alreadyCompleted: true, claimed, newBalance: null }
      }

      if (claimed.provider === 'kakaopay') {
        if (error instanceof KakaoPayPartialCancelDetected) {
          await quarantineKakaoPayPartialCancel(claimed, 'PART_CANCEL_PAYMENT', error.cancelledAmount)
        } else if (kakaoCancelAttempted && !normalized.retryable) {
          // 취소가 확정 실패하면 결제사 상태를 다시 보고 부분취소면 격리한다.
          await quarantineKakaoPayPartialCancel(claimed)
        }
      }
    }
    throw normalized
  }
}
