import 'server-only'

import {
  createPaymentAdminClient,
  type PaymentOrderRow,
} from '@/lib/payment-orders-server'
import { cancelPayAppPayment, PayAppError } from '@/lib/payapp-server'
import type { Json } from '@/types/supabase'
import {
  cancellationFollowUps,
  runFollowUps,
  type Alert,
  type PayAppRpcResult,
} from '@/lib/payapp-webhook-server'
import {
  finalizePointChargeRefund,
  quarantineExternalProviderCancellation,
  quarantineKakaoPayPartialCancellation,
  recordKakaoPayPartialCancelMarker,
  RefundRpcError,
} from '@/lib/point-charge-refunds-server'
import {
  getCompletedKakaoPayPayment,
  getKakaoPayOrder,
  validateCompletedKakaoPayCancellation,
  validateKakaoPayOrderSnapshot,
  type KakaoOrderResponse,
  KakaoPayError,
} from '@/lib/kakaopay-server'

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
  partial_cancel_feedback_recorded_at: string | null
  partial_cancel_processed_at: string | null
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
    .select('id, user_id')
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
    const finalized = await finalizePointChargeRefund({
      requestId: refundRequest.id,
      cancelTransactionKey: input.transactionKey,
      cancelledAt: input.cancelledAt,
      providerStatus: input.providerStatus,
    })
    // 대사가 끝낸 환불도 사용자에게 완료를 알린다(관리자 처리기가 끝낸 경우는 처리기 쪽이 알린다).
    if (!finalized.already_completed) {
      await runFollowUps(createPaymentAdminClient(), {
        alerts: [],
        userNotification: {
          userId: refundRequest.user_id,
          title: '환불 완료',
          message: '결제 취소가 확인되어 환불이 완료되었습니다.',
          link: '/mypage/payments',
        },
      })
    }
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

async function getKakaoProviderTransaction(paymentOrderId: string) {
  const admin = createPaymentAdminClient()
  const { data, error } = await admin
    .from('payment_provider_transactions')
    .select(`
      provider_transaction_id,
      provider_approval_id,
      partial_cancel_feedback_recorded_at,
      partial_cancel_processed_at
    `)
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

async function quarantineKakaoPayPartialCancel(
  order: PaymentOrderRow,
  payment: KakaoOrderResponse
) {
  if (payment.status === 'PART_CANCEL_PAYMENT') {
    await recordKakaoPayPartialCancelMarker({
      paymentOrderId: order.id,
      providerStatus: payment.status,
    })
  }

  const result = await quarantineKakaoPayPartialCancellation({
    paymentOrderId: order.id,
    providerStatus: payment.status,
    cancelledAmount: payment.canceled_amount?.total ?? null,
  })

  const details = { order_id: order.order_id, payment_order_id: order.id, provider_status: payment.status }
  const alerts: Alert[] = []
  if (result.state_unexpected) {
    alerts.push({
      code: 'KAKAOPAY_PARTIAL_CANCEL_STATE_UNEXPECTED',
      severity: 'warning',
      message: '부분취소 표식이 있는 카카오페이 결제의 조회 상태가 예상과 다릅니다.',
      details,
    })
  }
  // 부분취소 뒤 잔액까지 취소됐으면 수동 완료 때 전액 환불 기준으로 처리해야 한다.
  if (payment.status === 'CANCEL_PAYMENT' && result.outcome === 'manual_review') {
    alerts.push({
      code: 'KAKAOPAY_PARTIAL_CANCEL_THEN_FULLY_CANCELLED',
      severity: 'critical',
      message: '부분취소된 카카오페이 결제가 잔액까지 취소되었습니다. 전액 환불 기준으로 처리하세요.',
      details,
      notifyAdmins: true,
    })
  } else if (result.cancelled_amount_invalid && payment.status === 'PART_CANCEL_PAYMENT') {
    alerts.push({
      code: 'KAKAOPAY_PARTIAL_CANCEL_AMOUNT_UNKNOWN',
      severity: 'warning',
      message: '카카오페이 부분취소 금액을 확인하지 못했습니다. 결제사 관리자에서 실제 취소 금액을 확인하세요.',
      details,
    })
  }
  if (alerts.length) {
    await runFollowUps(createPaymentAdminClient(), { alerts })
  }

  return result.outcome === 'manual_review'
    ? 'manual_review' as const
    : 'already_completed' as const
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

  // 부분취소는 표식을 먼저 남기고 격리한다. 미처리 표식이 있으면 조회 상태·스냅샷과 무관하게 격리로 끝낸다.
  const partialCancelPending = Boolean(
    providerTransaction?.partial_cancel_feedback_recorded_at &&
    !providerTransaction.partial_cancel_processed_at
  )
  const expected = getKakaoExpectedSnapshot(order, providerTransactionId)
  if (!expected && !partialCancelPending) {
    return markManualReview(
      order,
      null,
      'KAKAOPAY_RECONCILIATION_SNAPSHOT_MISSING',
      '카카오페이 주문 snapshot을 확인할 수 없습니다.'
    )
  }

  const payment = await getKakaoPayOrder(providerTransactionId)
  if (partialCancelPending || payment.status === 'PART_CANCEL_PAYMENT' || !expected) {
    return quarantineKakaoPayPartialCancel(order, payment)
  }

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

interface PayAppTransactionRow {
  provider_transaction_id: string | null
  cancel_feedback_recorded_at: string | null
  cancel_processed_at: string | null
  partial_cancel_feedback_recorded_at: string | null
  partial_cancel_processed_at: string | null
}

// 결제 전 요청이 결제 만료 뒤 이 시간 넘게 취소되지 않으면 수동 확인으로 넘긴다(계획 6.3).
const PAYAPP_READY_CANCEL_GRACE_MS = 2 * 60 * 60 * 1000

async function getPayAppTransaction(paymentOrderId: string) {
  const admin = createPaymentAdminClient()
  const { data, error } = await admin
    .from('payment_provider_transactions')
    .select(`
      provider_transaction_id,
      cancel_feedback_recorded_at,
      cancel_processed_at,
      partial_cancel_feedback_recorded_at,
      partial_cancel_processed_at
    `)
    .eq('payment_order_id', paymentOrderId)
    .maybeSingle()

  if (error) {
    throw new Error('PAYAPP_PROVIDER_TRANSACTION_QUERY_FAILED')
  }
  return data as PayAppTransactionRow | null
}

// 페이앱 RPC는 jsonb를 돌려준다. 오류는 RPC가 던진 코드로 남긴다.
function readPayAppRpc(response: {
  data: Json | null
  error: { code?: string; message?: string } | null
}) {
  if (response.error) {
    throw new Error(
      response.error.message?.match(/^[A-Z][A-Z0-9_]{3,}/)?.[0] ??
        response.error.code ??
        'PAYAPP_RPC_FAILED'
    )
  }
  return (response.data ?? {}) as PayAppRpcResult & { changed?: boolean }
}

// 대사 전용 종료 처리. 기대 상태가 아니면 아무것도 바꾸지 않고 다음 회차로 넘긴다.
async function markPayAppTerminal(input: {
  order: PaymentOrderRow
  expectedStatus: PaymentOrderRow['status']
  status: 'expired' | 'manual_review'
  code: string
  message: string
}) {
  try {
    const result = readPayAppRpc(await createPaymentAdminClient().rpc('mark_payapp_order_terminal', {
      p_payment_order_id: input.order.id,
      p_expected_status: input.expectedStatus,
      p_status: input.status,
      p_failure_code: input.code,
      p_failure_message: input.message,
    }))
    if (!result.changed) return 'provider_not_final' as const
  } catch (error) {
    // 결제완료가 기록된 주문은 만료하지 않는다. 지급 경로가 처리한다.
    if (error instanceof Error && error.message === 'PAYMENT_PAID_ORDER_NOT_TERMINABLE') {
      return 'provider_not_final' as const
    }
    throw error
  }
  return input.status === 'expired' ? 'payment_expired' as const : 'manual_review' as const
}

async function processPayAppCancellation(order: PaymentOrderRow) {
  const result = readPayAppRpc(await createPaymentAdminClient().rpc('process_payapp_cancellation', {
    p_payment_order_id: order.id,
  }))
  await runFollowUps(
    createPaymentAdminClient(),
    cancellationFollowUps(
      { order_id: order.order_id, payment_order_id: order.id, source: 'reconciliation' },
      result
    )
  )

  switch (result.result) {
    case 'refund_finalized':
      return 'refund_finalized' as const
    case 'cancelled_before_fulfillment':
      return 'payment_failed' as const
    // 주문 상태가 바뀌지 않은 결과(이미 환불·격리됨, 경보만 남김).
    case 'nothing_to_process':
    case 'already_refunded':
    case 'already_quarantined':
    case 'double_refund_suspected':
    case 'partial_cancel_after_cancel':
      return 'already_completed' as const
    case 'partial_cancel_quarantined':
      return result.outcome === 'absorbed_by_refund'
        ? 'already_completed' as const
        : 'manual_review' as const
    // 환불 처리 중인 부분취소는 환불이 끝난 뒤 다시 집는다. 처리가 멈췄으면 재큐잉해 격리로 이어지게 한다.
    case 'deferred_refund_processing':
      await requeueStuckPayAppRefunds(order)
      return 'provider_not_final' as const
    default:
      return 'manual_review' as const
  }
}

async function retryPayAppFulfillment(order: PaymentOrderRow) {
  const result = readPayAppRpc(await createPaymentAdminClient().rpc('retry_payapp_fulfillment', {
    p_payment_order_id: order.id,
  }))

  switch (result.result) {
    case 'fulfilled':
      await runFollowUps(createPaymentAdminClient(), {
        alerts: [],
        userNotification: {
          userId: order.user_id,
          title: '크레딧 충전 완료',
          message: '결제가 확인되어 크레딧이 충전되었습니다.',
          link: '/mypage/credits',
        },
      })
      return 'payment_fulfilled' as const
    case 'already_fulfilled':
      return 'already_completed' as const
    case 'retry_exhausted':
      await runFollowUps(createPaymentAdminClient(), {
        alerts: [{
          code: 'PAYAPP_FULFILLMENT_RETRY_EXHAUSTED',
          severity: 'critical',
          message: '결제된 페이앱 주문의 크레딧 지급이 3회 실패해 수동 확인으로 보냈습니다.',
          details: { order_id: order.order_id, payment_order_id: order.id },
          notifyAdmins: true,
        }],
      })
      return 'manual_review' as const
    case 'retry_failed':
      // 짧은 백오프(2·4분)로 다시 시도한다. 결제완료 처리가 백오프를 지워 두었다.
      throw new Error('PAYAPP_FULFILLMENT_RETRY_REQUIRED')
    case 'not_retryable': {
      // 지급 대기인데 다시 지급할 수 없는 상태(금액 불일치·취소 표식 등)는 수동 확인으로 보낸다.
      const outcome = await markPayAppTerminal({
        order,
        expectedStatus: 'fulfillment_pending',
        status: 'manual_review',
        code: 'PAYAPP_FULFILLMENT_NOT_RETRYABLE',
        message: '지급 대기 주문을 자동으로 다시 지급할 수 없습니다. 결제 내역을 확인하세요.',
      })
      if (outcome === 'manual_review') {
        await runFollowUps(createPaymentAdminClient(), {
          alerts: [{
            code: 'PAYAPP_FULFILLMENT_NOT_RETRYABLE',
            severity: 'critical',
            message: '지급 대기 페이앱 주문을 자동으로 다시 지급할 수 없어 수동 확인으로 보냈습니다.',
            details: { order_id: order.order_id, payment_order_id: order.id },
            notifyAdmins: true,
          }],
        })
      }
      return outcome
    }
    default:
      return 'provider_not_final' as const
  }
}

async function requeueStuckPayAppRefunds(order: PaymentOrderRow) {
  const admin = createPaymentAdminClient()
  const { data, error } = await admin
    .from('refund_requests')
    .select('id')
    .eq('payment_order_id', order.id)
    .eq('provider', 'payapp')
    .eq('status', 'processing')

  if (error) {
    throw new Error('REFUND_RECONCILIATION_QUERY_FAILED')
  }
  if (!data?.length) return 'already_completed' as const

  let requeued = false
  for (const request of data) {
    const result = readPayAppRpc(await admin.rpc('requeue_stuck_point_charge_refund', {
      p_request_id: request.id,
    }))
    requeued ||= Boolean(result.changed)
  }
  if (requeued) {
    await runFollowUps(admin, {
      alerts: [{
        code: 'PAYAPP_REFUND_PROCESSING_STUCK',
        severity: 'warning',
        message: '10분 넘게 끝나지 않은 페이앱 환불을 재처리 대기로 돌렸습니다. 페이앱 관리자에서 취소 여부를 확인하세요. 부분취소가 있으면 다음 대사에서 수동 확인으로 넘어가고, 없으면 다시 승인하면 됩니다.',
        details: { order_id: order.order_id, payment_order_id: order.id },
        notifyAdmins: true,
      }],
    })
  }

  // 10분이 안 된 처리 중 환불은 다음 회차에 다시 본다. 재큐잉된 환불은 관리자 재승인으로만 다시 처리한다.
  return requeued ? 'already_completed' as const : 'provider_not_final' as const
}

async function reconcilePayAppPayment(order: PaymentOrderRow) {
  const transaction = await getPayAppTransaction(order.id)

  // 미처리 취소 표식을 가장 먼저 처리한다(주문 상태 무관).
  if (
    transaction &&
    ((transaction.cancel_feedback_recorded_at && !transaction.cancel_processed_at) ||
      (transaction.partial_cancel_feedback_recorded_at && !transaction.partial_cancel_processed_at))
  ) {
    return processPayAppCancellation(order)
  }

  const readyExpiry = order.ready_expires_at ?? order.checkout_expires_at
  const mulNo = transaction?.provider_transaction_id ?? null

  switch (order.status) {
    case 'fulfillment_pending':
      return retryPayAppFulfillment(order)

    case 'preparing':
      if (!isPast(readyExpiry)) return 'provider_not_final' as const
      return markPayAppTerminal({
        order,
        expectedStatus: 'preparing',
        status: 'expired',
        code: 'PAYAPP_REQUEST_NOT_SENT',
        message: '페이앱 결제 요청 없이 유효시간이 만료되었습니다.',
      })

    case 'ready_unknown':
      if (!isPast(readyExpiry)) return 'provider_not_final' as const
      if (mulNo) {
        // 결제 전 요청이면 취소된다. 결제됐으면 실패하고, 만료 처리도 결제완료 기록이 있으면 거부된다.
        await cancelPayAppPayment({ mulNo, memo: '결제 요청 만료', mode: 'ready' }).catch(() => undefined)
      }
      return markPayAppTerminal({
        order,
        expectedStatus: 'ready_unknown',
        status: 'expired',
        code: 'PAYAPP_REQUEST_OUTCOME_EXPIRED',
        message: '결제 요청 결과를 확인하지 못한 채 유효시간이 만료되었습니다.',
      })

    case 'ready':
      if (!isPast(readyExpiry)) return 'provider_not_final' as const
      if (!mulNo) {
        return markPayAppTerminal({
          order,
          expectedStatus: 'ready',
          status: 'manual_review',
          code: 'PAYAPP_READY_CANCEL_FAILED',
          message: '결제요청번호가 없어 만료된 페이앱 요청을 취소하지 못했습니다.',
        })
      }
      try {
        await cancelPayAppPayment({ mulNo, memo: '결제 요청 만료', mode: 'ready' })
      } catch (error) {
        const expiredAt = readyExpiry ? Date.parse(readyExpiry) : Date.now()
        if (Date.now() - expiredAt < PAYAPP_READY_CANCEL_GRACE_MS) {
          throw error
        }
        // 관리자가 페이앱 콘솔에서 바로 대조할 수 있게 마지막 오류 코드를 남긴다.
        const lastErrorCode = [
          getReconciliationError(error).code,
          error instanceof PayAppError ? error.providerErrorCode : null,
        ].filter(Boolean).join('/') || '알 수 없음'
        return markPayAppTerminal({
          order,
          expectedStatus: 'ready',
          status: 'manual_review',
          code: 'PAYAPP_READY_CANCEL_FAILED',
          message: `만료된 페이앱 결제 요청을 2시간 동안 취소하지 못했습니다. 결제 여부를 확인하세요. (마지막 오류: ${lastErrorCode})`,
        })
      }
      return markPayAppTerminal({
        order,
        expectedStatus: 'ready',
        status: 'expired',
        code: 'PAYAPP_READY_EXPIRED',
        message: '페이앱 결제 없이 유효시간이 만료되었습니다.',
      })

    case 'completed':
      return requeueStuckPayAppRefunds(order)

    default:
      return 'provider_not_final' as const
  }
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
  if (order.provider === 'kakaopay') {
    return reconcileKakaoPayPayment(order)
  }
  if (order.provider === 'payapp') {
    return reconcilePayAppPayment(order)
  }
  return markManualReview(
    order,
    order.provider_status,
    'PAYMENT_PROVIDER_UNSUPPORTED',
    '지원하지 않는 결제 provider입니다.'
  )
}

function getReconciliationError(error: unknown) {
  if (
    error instanceof KakaoPayError ||
    error instanceof PayAppError ||
    error instanceof RefundRpcError
  ) {
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
