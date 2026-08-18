import 'server-only'

import {
  createPaymentAdminClient,
  type PaymentOrderRow,
} from '@/lib/payment-orders-server'
import {
  finalizePointChargeRefund,
  quarantineExternalProviderCancellation,
} from '@/lib/point-charge-refunds-server'
import {
  getCompletedKakaoPayPayment,
  getKakaoPayOrder,
  validateCompletedKakaoPayCancellation,
  validateKakaoPayOrderSnapshot,
  type KakaoOrderResponse,
  KakaoPayError,
} from '@/lib/kakaopay-server'
import {
  getCompletedFullCancellation,
  getTossPaymentByPaymentKey,
  isAllowedPointChargeMethod,
  type TossPayment,
  TossPaymentsError,
} from '@/lib/toss-payments-server'

export type PaymentReconciliationOutcome =
  | 'already_completed'
  | 'payment_fulfilled'
  | 'refund_finalized'
  | 'payment_failed'
  | 'payment_expired'
  | 'provider_not_final'
  | 'manual_review'
  | 'not_found'

interface ProviderTransactionRow {
  provider_transaction_id: string | null
  provider_approval_id: string | null
}

interface ReconciliationRunClaim {
  acquired: boolean
  run_id: string
  backlog?: number
  lease_expires_at?: string
}

const KAKAO_PENDING_STATUSES = [
  'READY',
  'SEND_TMS',
  'OPEN_PAYMENT',
  'SELECT_METHOD',
  'ARS_WAITING',
  'AUTH_PASSWORD',
] as const

const KAKAO_FAILED_STATUSES = [
  'FAIL_AUTH_PASSWORD',
  'QUIT_PAYMENT',
  'FAIL_PAYMENT',
] as const

function isPast(value: string | null) {
  return Boolean(value && Date.parse(value) <= Date.now())
}

function validateReconciledTossPayment(
  payment: TossPayment,
  order: PaymentOrderRow
) {
  return (
    payment.paymentKey === order.payment_key &&
    payment.orderId === order.order_id &&
    payment.totalAmount === order.expected_amount &&
    payment.currency === 'KRW' &&
    payment.mId === order.provider_merchant_id
  )
}

async function markTerminal(input: {
  order: PaymentOrderRow
  status: 'failed' | 'expired' | 'manual_review'
  providerStatus: string | null
  code: string
  message: string
}) {
  const admin = createPaymentAdminClient()
  const { error } = await admin.rpc('mark_payment_reconciliation_terminal', {
    p_payment_order_id: input.order.id,
    p_status: input.status,
    p_provider_status: input.providerStatus ?? 'UNKNOWN',
    p_failure_code: input.code,
    p_failure_message: input.message,
  })

  if (error) {
    throw new Error('PAYMENT_RECONCILIATION_TERMINAL_UPDATE_FAILED')
  }
}

async function markManualReview(
  order: PaymentOrderRow,
  providerStatus: string | null,
  code: string,
  message: string
) {
  await markTerminal({
    order,
    status: 'manual_review',
    providerStatus,
    code,
    message,
  })
  return 'manual_review' as const
}

async function findRefundRequest(paymentOrderId: string) {
  const admin = createPaymentAdminClient()
  const { data, error } = await admin
    .from('refund_requests')
    .select('id')
    .eq('payment_order_id', paymentOrderId)
    .in('status', [
      'pending_review',
      'processing',
      'retryable_failed',
      'manual_review',
    ])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error('REFUND_RECONCILIATION_QUERY_FAILED')
  }

  return data
}

async function reconcileCancellation(input: {
  order: PaymentOrderRow
  transactionKey: string
  cancelledAt: string
  providerStatus: string
}) {
  if (input.order.status === 'refunded') {
    return 'already_completed' as const
  }

  const refundRequest = await findRefundRequest(input.order.id)
  if (refundRequest) {
    await finalizePointChargeRefund({
      requestId: refundRequest.id,
      cancelTransactionKey: input.transactionKey,
      cancelledAt: input.cancelledAt,
      providerStatus: input.providerStatus,
    })
    return 'refund_finalized' as const
  }

  await quarantineExternalProviderCancellation({
    paymentOrderId: input.order.id,
    cancelTransactionKey: input.transactionKey,
    cancelledAt: input.cancelledAt,
    providerStatus: input.providerStatus,
  })
  return 'manual_review' as const
}

async function reconcileTossPayment(order: PaymentOrderRow) {
  if (!order.payment_key) {
    if (isPast(order.checkout_expires_at)) {
      await markTerminal({
        order,
        status: 'expired',
        providerStatus: null,
        code: 'TOSS_CHECKOUT_EXPIRED',
        message: '결제 승인 없이 일반결제 유효시간이 만료되었습니다.',
      })
      return 'payment_expired' as const
    }
    return 'provider_not_final' as const
  }

  const payment = await getTossPaymentByPaymentKey(order.payment_key)
  if (!validateReconciledTossPayment(payment, order)) {
    return markManualReview(
      order,
      payment.status,
      'PAYMENT_RECONCILIATION_MISMATCH',
      'Toss 조회 결과와 저장된 주문 정보가 일치하지 않습니다.'
    )
  }

  if (payment.status === 'DONE') {
    if (order.status === 'completed') {
      return 'already_completed' as const
    }

    if (
      !payment.approvedAt ||
      !isAllowedPointChargeMethod(payment) ||
      !['confirming', 'fulfillment_pending'].includes(order.status)
    ) {
      return markManualReview(
        order,
        payment.status,
        'PAYMENT_RECONCILIATION_REQUIRES_REVIEW',
        '승인 결제의 지급 조건을 자동으로 확정할 수 없습니다.'
      )
    }

    const admin = createPaymentAdminClient()
    const { data, error } = await admin.rpc('finalize_toss_payment', {
      p_payment_order_id: order.id,
      p_payment_key: payment.paymentKey,
      p_provider_method: payment.method,
      p_provider_status: payment.status,
      p_mid: order.provider_merchant_id,
      p_approved_at: payment.approvedAt,
    })

    if (error || !data) {
      throw new Error('PAYMENT_FULFILLMENT_RETRY_REQUIRED')
    }
    return 'payment_fulfilled' as const
  }

  if (payment.status === 'CANCELED') {
    const cancellation = getCompletedFullCancellation(
      payment,
      order.expected_amount
    )
    return reconcileCancellation({
      order,
      transactionKey: cancellation.transactionKey,
      cancelledAt: cancellation.canceledAt,
      providerStatus: payment.status,
    })
  }

  if (payment.status === 'PARTIAL_CANCELED') {
    return markManualReview(
      order,
      payment.status,
      'TOSS_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
      '부분 취소된 일반결제는 수동 확인이 필요합니다.'
    )
  }

  if (payment.status === 'ABORTED') {
    await markTerminal({
      order,
      status: 'failed',
      providerStatus: payment.status,
      code: 'PROVIDER_ABORTED',
      message: '일반결제가 승인되지 않고 종료되었습니다.',
    })
    return 'payment_failed' as const
  }

  if (payment.status === 'EXPIRED') {
    await markTerminal({
      order,
      status: 'expired',
      providerStatus: payment.status,
      code: 'PROVIDER_EXPIRED',
      message: '일반결제 유효시간이 만료되었습니다.',
    })
    return 'payment_expired' as const
  }

  if (['READY', 'IN_PROGRESS'].includes(payment.status)) {
    return 'provider_not_final' as const
  }

  if (payment.status === 'WAITING_FOR_DEPOSIT') {
    return markManualReview(
      order,
      payment.status,
      'TOSS_UNSUPPORTED_VIRTUAL_ACCOUNT',
      '지원하지 않는 가상계좌 상태가 확인되었습니다.'
    )
  }

  return markManualReview(
    order,
    payment.status,
    'TOSS_UNKNOWN_STATUS',
    '알 수 없는 일반결제 상태가 확인되었습니다.'
  )
}

async function getKakaoProviderTransaction(paymentOrderId: string) {
  const admin = createPaymentAdminClient()
  const { data, error } = await admin
    .from('payment_provider_transactions')
    .select('provider_transaction_id, provider_approval_id')
    .eq('payment_order_id', paymentOrderId)
    .maybeSingle()

  if (error) {
    throw new Error('KAKAOPAY_PROVIDER_TRANSACTION_QUERY_FAILED')
  }
  return data as ProviderTransactionRow | null
}

function getKakaoExpectedSnapshot(
  order: PaymentOrderRow,
  providerTransactionId: string
) {
  if (
    !order.partner_order_id ||
    !order.partner_user_id ||
    order.vat_amount === null
  ) {
    return null
  }

  return {
    cid: order.provider_merchant_id,
    tid: providerTransactionId,
    partnerOrderId: order.partner_order_id,
    partnerUserId: order.partner_user_id,
    totalAmount: order.expected_amount,
    taxFreeAmount: order.tax_free_amount,
    vatAmount: order.vat_amount,
  }
}

async function reconcileCompletedKakaoPayPayment(
  order: PaymentOrderRow,
  payment: KakaoOrderResponse,
  providerTransactionId: string
) {
  if (order.status === 'completed') {
    return 'already_completed' as const
  }

  const expected = getKakaoExpectedSnapshot(order, providerTransactionId)
  if (!expected) {
    return markManualReview(
      order,
      payment.status,
      'KAKAOPAY_RECONCILIATION_SNAPSHOT_MISSING',
      '카카오페이 주문 snapshot을 확인할 수 없습니다.'
    )
  }

  let completed
  try {
    completed = getCompletedKakaoPayPayment(payment, expected)
  } catch {
    return markManualReview(
      order,
      payment.status,
      'KAKAOPAY_RECONCILIATION_MISMATCH',
      '카카오페이 승인 결과와 저장된 주문 정보가 일치하지 않습니다.'
    )
  }

  if (!['confirming', 'fulfillment_pending'].includes(order.status)) {
    return markManualReview(
      order,
      payment.status,
      'KAKAOPAY_APPROVAL_WITHOUT_CALLBACK',
      '승인 callback claim 없이 완료된 카카오페이 결제가 확인되었습니다.'
    )
  }

  const admin = createPaymentAdminClient()
  const { error: recordError } = await admin.rpc('record_kakaopay_approval', {
    p_payment_order_id: order.id,
    p_provider_transaction_id: providerTransactionId,
    p_provider_approval_id: completed.approvalId,
    p_provider_status: completed.providerStatus,
    p_payment_method_type: completed.paymentMethodType,
    p_approved_at: completed.approvedAt,
  })
  if (recordError) {
    throw new Error('KAKAOPAY_APPROVAL_RECORD_RETRY_REQUIRED')
  }

  const { data, error } = await admin.rpc('finalize_kakaopay_payment', {
    p_payment_order_id: order.id,
    p_provider_transaction_id: providerTransactionId,
    p_provider_approval_id: completed.approvalId,
    p_provider_status: completed.providerStatus,
    p_payment_method_type: completed.paymentMethodType,
    p_provider_merchant_id: order.provider_merchant_id,
    p_approved_at: completed.approvedAt,
  })
  if (error || !data) {
    throw new Error('KAKAOPAY_FULFILLMENT_RETRY_REQUIRED')
  }

  return 'payment_fulfilled' as const
}

async function reconcileKakaoPayPayment(order: PaymentOrderRow) {
  const providerTransaction = await getKakaoProviderTransaction(order.id)
  const providerTransactionId = providerTransaction?.provider_transaction_id
  const readyExpiry = order.ready_expires_at ?? order.checkout_expires_at

  if (!providerTransactionId) {
    if (!isPast(readyExpiry)) {
      return 'provider_not_final' as const
    }

    if (order.status === 'ready_unknown') {
      return markManualReview(
        order,
        null,
        'KAKAOPAY_READY_OUTCOME_UNKNOWN',
        '카카오페이 Ready 응답 유실 가능성을 수동 확인해야 합니다.'
      )
    }

    await markTerminal({
      order,
      status: 'expired',
      providerStatus: null,
      code: 'KAKAOPAY_READY_EXPIRED',
      message: '카카오페이 Ready 완료 없이 유효시간이 만료되었습니다.',
    })
    return 'payment_expired' as const
  }

  const expected = getKakaoExpectedSnapshot(order, providerTransactionId)
  if (!expected) {
    return markManualReview(
      order,
      null,
      'KAKAOPAY_RECONCILIATION_SNAPSHOT_MISSING',
      '카카오페이 주문 snapshot을 확인할 수 없습니다.'
    )
  }

  const payment = await getKakaoPayOrder(providerTransactionId)
  try {
    validateKakaoPayOrderSnapshot(payment, expected)
  } catch {
    return markManualReview(
      order,
      payment.status,
      'KAKAOPAY_RECONCILIATION_MISMATCH',
      '카카오페이 조회 결과와 저장된 주문 정보가 일치하지 않습니다.'
    )
  }

  if (payment.status === 'SUCCESS_PAYMENT') {
    return reconcileCompletedKakaoPayPayment(
      order,
      payment,
      providerTransactionId
    )
  }

  if (payment.status === 'CANCEL_PAYMENT') {
    const cancellation = validateCompletedKakaoPayCancellation(
      payment,
      expected
    )
    return reconcileCancellation({
      order,
      transactionKey: cancellation.transactionKey,
      cancelledAt: cancellation.canceledAt,
      providerStatus: cancellation.providerStatus,
    })
  }

  if (payment.status === 'PART_CANCEL_PAYMENT') {
    return markManualReview(
      order,
      payment.status,
      'KAKAOPAY_PARTIAL_CANCELLATION_REQUIRES_REVIEW',
      '부분 취소된 카카오페이 결제는 수동 확인이 필요합니다.'
    )
  }

  if (KAKAO_FAILED_STATUSES.includes(
    payment.status as (typeof KAKAO_FAILED_STATUSES)[number]
  )) {
    await markTerminal({
      order,
      status: 'failed',
      providerStatus: payment.status,
      code: `KAKAOPAY_${payment.status}`,
      message: '카카오페이 결제가 승인되지 않고 종료되었습니다.',
    })
    return 'payment_failed' as const
  }

  if (payment.status === 'ISSUED_SID') {
    return markManualReview(
      order,
      payment.status,
      'KAKAOPAY_ISSUED_SID_REQUIRES_REVIEW',
      '지원하지 않는 SID 발급 상태가 확인되었습니다.'
    )
  }

  if (KAKAO_PENDING_STATUSES.includes(
    payment.status as (typeof KAKAO_PENDING_STATUSES)[number]
  )) {
    if (!isPast(readyExpiry)) {
      return 'provider_not_final' as const
    }

    await markTerminal({
      order,
      status: 'expired',
      providerStatus: payment.status,
      code: 'KAKAOPAY_CALLBACK_NOT_RECEIVED',
      message: '카카오페이 승인 callback 없이 Ready 유효시간이 만료되었습니다.',
    })
    return 'payment_expired' as const
  }

  return markManualReview(
    order,
    payment.status,
    'KAKAOPAY_UNKNOWN_STATUS',
    '알 수 없는 카카오페이 상태가 확인되었습니다.'
  )
}

export async function reconcilePaymentOrder(
  orderId: string
): Promise<PaymentReconciliationOutcome> {
  const admin = createPaymentAdminClient()
  const { data: orderData, error: orderError } = await admin
    .from('payment_orders')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle()

  if (orderError || !orderData) {
    return 'not_found'
  }

  const order = orderData as PaymentOrderRow
  if (order.provider === 'toss') {
    return reconcileTossPayment(order)
  }
  if (order.provider === 'kakaopay') {
    return reconcileKakaoPayPayment(order)
  }
  return markManualReview(
    order,
    order.provider_status,
    'PAYMENT_PROVIDER_UNSUPPORTED',
    '지원하지 않는 결제 provider입니다.'
  )
}

function getReconciliationError(error: unknown) {
  if (error instanceof KakaoPayError || error instanceof TossPaymentsError) {
    return { code: error.code, message: error.message }
  }
  return {
    code: error instanceof Error ? error.message : 'PAYMENT_RECONCILIATION_FAILED',
    message: '결제 대사를 다시 시도해야 합니다.',
  }
}

export async function reconcilePendingPayments(limit: number) {
  const admin = createPaymentAdminClient()
  const { data: startData, error: startError } = await admin.rpc(
    'start_payment_reconciliation_run',
    { p_limit: limit }
  )
  if (startError || !startData) {
    throw new Error('PAYMENT_RECONCILIATION_START_FAILED')
  }

  const claim = startData as unknown as ReconciliationRunClaim
  if (!claim.acquired) {
    return {
      acquired: false,
      runId: claim.run_id,
      backlog: claim.backlog ?? 0,
      results: [],
    }
  }

  try {
    const { data: batch, error: batchError } = await admin.rpc(
      'claim_payment_reconciliation_batch',
      { p_run_id: claim.run_id, p_limit: limit }
    )
    if (batchError) {
      throw new Error('PAYMENT_RECONCILIATION_CLAIM_FAILED')
    }

    const results: Array<{
      orderId: string
      outcome: PaymentReconciliationOutcome | 'retry_required'
    }> = []

    for (const candidate of batch ?? []) {
      let outcome: PaymentReconciliationOutcome | 'retry_required'
      let errorCode = ''
      let errorMessage = ''
      try {
        outcome = await reconcilePaymentOrder(candidate.order_id)
      } catch (error) {
        const normalized = getReconciliationError(error)
        outcome = 'retry_required'
        errorCode = normalized.code
        errorMessage = normalized.message
      }

      const { error: recordError } = await admin.rpc(
        'record_payment_reconciliation_result',
        {
          p_run_id: claim.run_id,
          p_order_id: candidate.order_id,
          p_outcome: outcome,
          p_error_code: errorCode,
          p_error_message: errorMessage,
        }
      )
      if (recordError) {
        throw new Error('PAYMENT_RECONCILIATION_RESULT_RECORD_FAILED')
      }
      results.push({ orderId: candidate.order_id, outcome })
    }

    const { data: finishData, error: finishError } = await admin.rpc(
      'finish_payment_reconciliation_run',
      {
        p_run_id: claim.run_id,
        p_success: true,
        p_error_code: '',
        p_error_message: '',
      }
    )
    if (finishError) {
      throw new Error('PAYMENT_RECONCILIATION_FINISH_FAILED')
    }

    return {
      acquired: true,
      runId: claim.run_id,
      backlog: claim.backlog ?? 0,
      results,
      finish: finishData,
    }
  } catch (error) {
    const normalized = getReconciliationError(error)
    await admin.rpc('finish_payment_reconciliation_run', {
      p_run_id: claim.run_id,
      p_success: false,
      p_error_code: normalized.code,
      p_error_message: normalized.message,
    })
    throw error
  }
}
