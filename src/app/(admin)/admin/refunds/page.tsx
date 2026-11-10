/**
 * /admin/refunds 페이지
 * 관리자용 환불 요청 관리 페이지
 */

import { requireAuth } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { redirect } from 'next/navigation'
import { RefundsClient, type RefundRequest } from './refunds-client'
import { MarketRefundsClient } from './market-refunds-client'
import {
    PaymentReviewClient,
    type PaymentAlert,
    type PaymentReviewOrder,
} from './payment-review-client'
import { allowedReviewActions } from '@/lib/payment-review-actions'

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
    const paymentAdmin = createPaymentAdminClient()
    const { data: requests } = await paymentAdmin
        .from('refund_requests')
        .select(`
      *,
      user:profiles!refund_requests_user_id_fkey(id, email),
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

    // 통계 조회
    const pendingCount = requests?.filter(r => r.status === 'pending_review').length || 0
    const completedCount = requests?.filter(r => r.status === 'completed').length || 0
    const rejectedCount = requests?.filter(r => r.status === 'rejected').length || 0
    const attentionCount = requests?.filter(r =>
        ['retryable_failed', 'manual_review'].includes(r.status)
    ).length || 0

    // 수동 확인 주문과 미해소 결제 경보(계획 6.4)
    const { data: reviewOrderRows } = await paymentAdmin
        .from('payment_orders')
        .select(`
      id, order_id, provider, plan_name_snapshot, expected_amount, failure_code, failure_message, created_at,
      source_id,
      source:credit_sources!payment_orders_source_id_fkey(status),
      transaction:payment_provider_transactions!payment_provider_transactions_payment_order_id_fkey(
        paid_feedback_recorded_at,
        admin_paid_confirmed_at,
        cancel_feedback_recorded_at,
        partial_cancel_feedback_recorded_at
      )
    `)
        .eq('status', 'manual_review')
        .order('created_at', { ascending: false })
    // DB 함수의 가드와 같은 기준으로 처리 가능 여부를 서버에서 정한다.
    const reviewOrders: PaymentReviewOrder[] = (reviewOrderRows || []).map(({ source, transaction, source_id, ...order }) => ({
        ...order,
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
    const { data: paymentAlerts } = await paymentAdmin
        .from('payment_reconciliation_alerts')
        .select('id, code, severity, message, details, created_at')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })

    const { data: marketRefundRequests } = await supabase
        .from('market_refund_requests')
        .select('*')
        .order('created_at', { ascending: false })

    return (
        <div className="space-y-8">
            <RefundsClient
                requests={(requests || []) as RefundRequest[]}
                stats={{ pendingCount, completedCount, rejectedCount, attentionCount }}
            />
            <PaymentReviewClient
                orders={reviewOrders}
                alerts={(paymentAlerts || []) as PaymentAlert[]}
            />
            <h2 className="sr-only">문제마켓 환불</h2>
            <MarketRefundsClient requests={marketRefundRequests || []} />
        </div>
    )
}
