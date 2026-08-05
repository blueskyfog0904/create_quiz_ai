import 'server-only'

import {
  createPaymentAdminClient,
  type PaymentOrderRow,
} from '@/lib/payment-orders-server'
import { finalizePointChargeRefund } from '@/lib/point-charge-refunds-server'
import {
  getCompletedFullCancellation,
  getTossPaymentByPaymentKey,
  isAllowedPointChargeMethod,
  type TossPayment,
} from '@/lib/toss-payments-server'

export type PaymentReconciliationOutcome =
  | 'already_completed'
  | 'payment_fulfilled'
  | 'refund_finalized'
  | 'provider_not_final'
  | 'manual_review'
  | 'not_found'

function validateReconciledPayment(
  payment: TossPayment,
  order: PaymentOrderRow
) {
  return (
    payment.paymentKey === order.payment_key &&
    payment.orderId === order.order_id &&
    payment.totalAmount === order.expected_amount &&
    payment.currency === 'KRW' &&
    payment.mId === order.mid
  )
}

async function markManualReview(
  orderId: string,
  code: string,
  message: string
) {
  const admin = createPaymentAdminClient()
  await admin
    .from('payment_orders')
    .update({
      status: 'manual_review',
      failure_code: code,
      failure_message: message,
    })
    .eq('id', orderId)
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
  if (!order.payment_key) {
    return 'provider_not_final'
  }

  const payment = await getTossPaymentByPaymentKey(order.payment_key)
  if (!validateReconciledPayment(payment, order)) {
    await markManualReview(
      order.id,
      'PAYMENT_RECONCILIATION_MISMATCH',
      'Toss 조회 결과와 저장된 주문 정보가 일치하지 않습니다.'
    )
    return 'manual_review'
  }

  if (payment.status === 'DONE') {
    if (order.status === 'completed') {
      return 'already_completed'
    }

    if (
      !payment.approvedAt ||
      !isAllowedPointChargeMethod(payment) ||
      !['confirming', 'fulfillment_pending'].includes(order.status)
    ) {
      await markManualReview(
        order.id,
        'PAYMENT_RECONCILIATION_REQUIRES_REVIEW',
        '승인 결제의 지급 조건을 자동으로 확정할 수 없습니다.'
      )
      return 'manual_review'
    }

    await admin
      .from('payment_orders')
      .update({
        status: 'fulfillment_pending',
        provider_method: payment.method,
        provider_status: payment.status,
        approved_at: payment.approvedAt,
      })
      .eq('id', order.id)

    const { data, error } = await admin.rpc('finalize_toss_payment', {
      p_payment_order_id: order.id,
      p_payment_key: payment.paymentKey,
      p_provider_method: payment.method,
      p_provider_status: payment.status,
      p_mid: order.mid,
      p_approved_at: payment.approvedAt,
    })

    if (error || !data) {
      throw new Error('PAYMENT_FULFILLMENT_RETRY_REQUIRED')
    }

    return 'payment_fulfilled'
  }

  if (payment.status === 'CANCELED') {
    if (order.status === 'refunded') {
      return 'already_completed'
    }

    const { data: refundRequest } = await admin
      .from('refund_requests')
      .select('id')
      .eq('payment_order_id', order.id)
      .in('status', [
        'pending_review',
        'processing',
        'retryable_failed',
        'manual_review',
      ])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!refundRequest) {
      await markManualReview(
        order.id,
        'PROVIDER_CANCELED_WITHOUT_REFUND_REQUEST',
        'Toss 취소 결과와 연결된 환불 요청을 찾을 수 없습니다.'
      )
      return 'manual_review'
    }

    const cancellation = getCompletedFullCancellation(
      payment,
      order.expected_amount
    )
    await finalizePointChargeRefund({
      requestId: refundRequest.id,
      cancelTransactionKey: cancellation.transactionKey,
      cancelledAt: cancellation.canceledAt,
    })
    return 'refund_finalized'
  }

  if (
    ['EXPIRED', 'ABORTED'].includes(payment.status) &&
    ['ready', 'confirming'].includes(order.status)
  ) {
    await admin
      .from('payment_orders')
      .update({
        status: 'failed',
        provider_status: payment.status,
        failure_code: `PROVIDER_${payment.status}`,
        failure_message: '결제가 승인되지 않고 종료되었습니다.',
      })
      .eq('id', order.id)
  }

  return 'provider_not_final'
}

export async function reconcilePendingPayments(limit: number) {
  const admin = createPaymentAdminClient()
  const { data: orders, error: orderError } = await admin
    .from('payment_orders')
    .select('order_id')
    .in('status', ['confirming', 'fulfillment_pending'])
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (orderError) {
    throw new Error('PAYMENT_RECONCILIATION_QUERY_FAILED')
  }

  const { data: refunds, error: refundError } = await admin
    .from('refund_requests')
    .select(
      'payment_order:payment_orders!refund_requests_payment_order_id_fkey(order_id)'
    )
    .in('status', ['processing', 'retryable_failed'])
    .order('updated_at', { ascending: true })
    .limit(limit)

  if (refundError) {
    throw new Error('REFUND_RECONCILIATION_QUERY_FAILED')
  }

  const orderIds = new Set((orders ?? []).map((order) => order.order_id))
  for (const refund of refunds ?? []) {
    const paymentOrder = Array.isArray(refund.payment_order)
      ? refund.payment_order[0]
      : refund.payment_order
    if (paymentOrder?.order_id) {
      orderIds.add(paymentOrder.order_id)
    }
  }

  const results = []
  for (const pendingOrderId of [...orderIds].slice(0, limit)) {
    try {
      results.push({
        orderId: pendingOrderId,
        outcome: await reconcilePaymentOrder(pendingOrderId),
      })
    } catch {
      results.push({
        orderId: pendingOrderId,
        outcome: 'retry_required' as const,
      })
    }
  }

  return results
}
