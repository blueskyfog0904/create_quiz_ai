/**
 * /admin/refunds 페이지
 * 관리자용 환불 요청 관리 페이지
 */

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { redirect } from 'next/navigation'
import { RefundsClient, type RefundRequest } from './refunds-client'
import { MarketRefundsClient, type MarketRefundRequestRow } from './market-refunds-client'
import {
    PaymentReviewClient,
    type PaymentAlert,
    type PaymentReviewOrder,
} from './payment-review-client'
import { allowedReviewActions } from '@/lib/payment-review-actions'
import { PaymentSalesPanel } from '@/components/admin/payment-sales-panel'
import { getPaymentSalesStatus } from '@/lib/payment-sales-status-server'

export const dynamic = 'force-dynamic'

export default async function AdminRefundsPage() {
    const user = await requireAuth()
    const supabase = await createClient()

    // 관리자 권한 확인
    const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()

    if (!profile?.is_admin) {
        redirect('/')
    }

    // 환불 요청 목록 조회
    // 목록을 읽지 못했는데 "없음"으로 보이면 처리할 건을 놓친다. 실패한 목록 이름을 모아 맨 위에 알린다.
    const loadErrors: string[] = []
    const paymentAdmin = createPaymentAdminClient()
    const { data: requests, error: requestsError } = await paymentAdmin
        .from('refund_requests')
        .select(`
      *,
      user:profiles!refund_requests_user_id_fkey(id, email, display_tag),
      source:credit_sources(
        id, 
        initial_credits, 
        remaining_credits, 
        purchased_at,
        plan:pricing_plans(name, price)
      ),
      processor:profiles!refund_requests_processed_by_fkey(id, email),
      order:payment_orders!refund_requests_payment_order_id_fkey(
        expected_amount,
        method:payment_methods!payment_orders_payment_method_fkey(label),
        transaction:payment_provider_transactions!payment_provider_transactions_payment_order_id_fkey(
          cancel_feedback_recorded_at,
          partial_cancel_feedback_recorded_at
        )
      )
    `)
        .order('created_at', { ascending: false })
    if (requestsError) loadErrors.push('충전 환불 요청')

    // 통계 조회
    const pendingCount = requests?.filter(r => r.status === 'pending_review').length || 0
    const completedCount = requests?.filter(r => r.status === 'completed').length || 0
    const rejectedCount = requests?.filter(r => r.status === 'rejected').length || 0
    const attentionCount = requests?.filter(r =>
        ['retryable_failed', 'manual_review'].includes(r.status)
    ).length || 0

    // 수동 확인 주문과 미해소 결제 경보(계획 6.4)
    const { data: reviewOrderRows, error: reviewOrdersError } = await paymentAdmin
        .from('payment_orders')
        .select(`
      id, order_id, provider, plan_name_snapshot, expected_amount, failure_code, failure_message, created_at,
      source_id,
      user:profiles!payment_orders_user_id_fkey(email),
      source:credit_sources!payment_orders_source_id_fkey(status),
      transaction:payment_provider_transactions!payment_provider_transactions_payment_order_id_fkey(
        provider_transaction_id,
        paid_feedback_recorded_at,
        admin_paid_confirmed_at,
        cancel_feedback_recorded_at,
        partial_cancel_feedback_recorded_at
      )
    `)
        .eq('status', 'manual_review')
        .order('created_at', { ascending: false })
    if (reviewOrdersError) loadErrors.push('수동 확인 주문')
    // DB 함수의 가드와 같은 기준으로 처리 가능 여부를 서버에서 정한다.
    const reviewOrders: PaymentReviewOrder[] = (reviewOrderRows || []).map(({ source, transaction, source_id, user: orderUser, ...order }) => ({
        ...order,
        email: orderUser?.email ?? null,
        providerTransactionId: transaction?.provider_transaction_id ?? null,
        allowedActions: allowedReviewActions({
            provider: order.provider,
            failureCode: order.failure_code,
            hasTransaction: Boolean(transaction),
            hasSource: Boolean(source_id),
            sourceRefunded: source?.status === 'refunded',
            paidRecorded: Boolean(transaction?.paid_feedback_recorded_at),
            adminPaidConfirmed: Boolean(transaction?.admin_paid_confirmed_at),
            cancelMarker: Boolean(transaction?.cancel_feedback_recorded_at),
            partialCancelMarker: Boolean(transaction?.partial_cancel_feedback_recorded_at),
        }),
    }))
    const { data: paymentAlerts, error: paymentAlertsError } = await paymentAdmin
        .from('payment_reconciliation_alerts')
        .select('id, code, severity, message, details, created_at')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
    if (paymentAlertsError) loadErrors.push('미해소 결제 경보')

    const { data: marketRefundRequests, error: marketRefundsError } = await supabase
        .from('market_refund_requests')
        .select('*, user:profiles!market_refund_requests_user_id_fkey(email, display_tag), item:market_items!market_refund_requests_item_id_fkey(title)')
        .order('created_at', { ascending: false })
    if (marketRefundsError) loadErrors.push('문제마켓 환불 요청')

    const salesStatus = await getPaymentSalesStatus()

    return (
        <div className="space-y-8">
            <PaymentSalesPanel status={salesStatus} />
            {loadErrors.length > 0 && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <p className="font-semibold">다음 목록을 불러오지 못했습니다: {loadErrors.join(', ')}</p>
                    <p className="mt-1">비어 보여도 처리할 건이 있을 수 있습니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.</p>
                </div>
            )}
            {/* 결제 경보와 수동 확인 주문을 환불 요청보다 위에 둔다(가장 먼저 봐야 하는 것). */}
            <RefundsClient
                requests={(requests || []) as RefundRequest[]}
                stats={{ pendingCount, completedCount, rejectedCount, attentionCount }}
            >
                <PaymentReviewClient
                    orders={reviewOrders}
                    alerts={(paymentAlerts || []) as PaymentAlert[]}
                />
            </RefundsClient>
            <h2 className="sr-only">문제마켓 환불</h2>
            <MarketRefundsClient requests={(marketRefundRequests || []) as MarketRefundRequestRow[]} />
        </div>
    )
}
