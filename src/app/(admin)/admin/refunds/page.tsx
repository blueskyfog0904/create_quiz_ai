/**
 * /admin/refunds 페이지
 * 관리자용 환불 요청 관리 페이지
 */

import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { createClient } from '@/lib/supabase/server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
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
import { markWithdrawnRows, readWithdrawnMarketRefundRequests } from '@/lib/withdrawn-member-redaction-server'
import { readMemberWithdrawalPolicy, readWithdrawnHeldOrderIds } from '@/lib/member-withdrawal-server'
import { MEMBER_WITHDRAWAL_ERRORS, withdrawalText } from '@/lib/member-withdrawal'

// 판정 실패는 화면 오류 안내라 코드에 둔다(정책 문구 자리는 판정 성공 때의 안내다).
const HELD_ORDER_CHECK_FAILED_NOTICE = '탈퇴 회원 보류 주문인지 확인하지 못해 지금은 처리할 수 없습니다. 새로고침해 주세요.'

export const dynamic = 'force-dynamic'

export default async function AdminRefundsPage() {
    // 충전 환불(refunds.payment)·마켓 환불(refunds.market) 중 하나라도 있으면 열린다.
    // 권한이 없는 구역은 조회하지 않고 그리지도 않는다.
    const access = await requireAdminPagePermission(['refunds.payment', 'refunds.market'])
    const canPayment = hasAdminPermission(access, 'refunds.payment')
    const canMarket = hasAdminPermission(access, 'refunds.market')
    const notLoaded = { data: null, error: null }
    const supabase = await createClient()

    // 환불 요청 목록 조회
    // 목록을 읽지 못했는데 "없음"으로 보이면 처리할 건을 놓친다. 실패한 목록 이름을 모아 맨 위에 알린다.
    const loadErrors: string[] = []
    const paymentAdmin = createPaymentAdminClient()
    const { data: requests, error: requestsError } = !canPayment ? notLoaded : await paymentAdmin
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
    // 10번: 탈퇴 회원의 충전 환불은 사유·메모를 가린다(서버 키로 읽으므로 코드가 가림). 가리지 못하면 목록을 비우고 알린다.
    let paymentRefundRows: Array<NonNullable<typeof requests>[number] & { memberWithdrawn: boolean }> = []
    try {
        paymentRefundRows = await markWithdrawnRows(requests ?? [], (row) => row.user_id, (row) => ({ ...row, reason: null, admin_note: null }))
    } catch (error) {
        console.error('[admin-refunds] 탈퇴 회원 가림 실패', { message: error instanceof Error ? error.message : String(error) })
        if (!requestsError) loadErrors.push('충전 환불 요청')
    }

    // 통계 조회
    const pendingCount = requests?.filter(r => r.status === 'pending_review').length || 0
    const completedCount = requests?.filter(r => r.status === 'completed').length || 0
    const rejectedCount = requests?.filter(r => r.status === 'rejected').length || 0
    const attentionCount = requests?.filter(r =>
        ['retryable_failed', 'manual_review'].includes(r.status)
    ).length || 0

    // 수동 확인 주문과 미해소 결제 경보(계획 6.4)
    const { data: reviewOrderRows, error: reviewOrdersError } = !canPayment ? notLoaded : await paymentAdmin
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
    // 탈퇴 회원 보류 주문(늦은 결제 기록 있음 — 부분취소·취소 처리 실패 뒤 포함)은 동작 대신 안내(DB 정책 문구)를 보인다.
    // 정책을 읽지 못하면 고정 오류 안내를 보인다(버튼은 그대로 비운다).
    // 판정을 읽지 못하면 어느 주문이 보류 주문인지 모르므로 모든 수동 확인 주문의 버튼을 비운다(처리하지 않는 쪽으로 닫음).
    let heldOrderIds = new Set<string>()
    let heldOrderCheckFailed = false
    try {
        heldOrderIds = await readWithdrawnHeldOrderIds((reviewOrderRows ?? []).map((order) => order.id))
    } catch (error) {
        console.error('[admin-refunds] 탈퇴 회원 보류 주문 판정 실패', { message: error instanceof Error ? error.message : String(error) })
        loadErrors.push('탈퇴 회원 보류 주문 판정')
        heldOrderCheckFailed = true
    }
    const heldOrderNotice = heldOrderIds.size > 0
        ? withdrawalText(await readMemberWithdrawalPolicy(), 'paymentReviewHeldOrder') ?? MEMBER_WITHDRAWAL_ERRORS.MEMBER_WITHDRAW_POLICY_UNAVAILABLE.message
        : null
    const reviewOrders: PaymentReviewOrder[] = (reviewOrderRows || []).map(({ source, transaction, source_id, user: orderUser, ...order }) => ({
        ...order,
        email: orderUser?.email ?? null,
        providerTransactionId: transaction?.provider_transaction_id ?? null,
        heldOrderNotice: heldOrderCheckFailed
            ? HELD_ORDER_CHECK_FAILED_NOTICE
            : heldOrderIds.has(order.id) ? heldOrderNotice : null,
        allowedActions: heldOrderCheckFailed ? [] : allowedReviewActions({
            provider: order.provider,
            failureCode: order.failure_code,
            hasTransaction: Boolean(transaction),
            hasSource: Boolean(source_id),
            sourceRefunded: source?.status === 'refunded',
            paidRecorded: Boolean(transaction?.paid_feedback_recorded_at),
            adminPaidConfirmed: Boolean(transaction?.admin_paid_confirmed_at),
            cancelMarker: Boolean(transaction?.cancel_feedback_recorded_at),
            partialCancelMarker: Boolean(transaction?.partial_cancel_feedback_recorded_at),
            withdrawnHeldOrder: heldOrderIds.has(order.id),
        }),
    }))
    const { data: paymentAlerts, error: paymentAlertsError } = !canPayment ? notLoaded : await paymentAdmin
        .from('payment_reconciliation_alerts')
        .select('id, code, severity, message, details, created_at')
        .is('resolved_at', null)
        .order('created_at', { ascending: false })
    if (paymentAlertsError) loadErrors.push('미해소 결제 경보')

    const { data: marketRefundRequests, error: marketRefundsError } = !canMarket ? notLoaded : await supabase
        .from('market_refund_requests')
        .select('*, user:profiles!market_refund_requests_user_id_fkey(email, display_tag), item:market_items!market_refund_requests_item_id_fkey(title)')
        .order('created_at', { ascending: false })
    if (marketRefundsError) loadErrors.push('문제마켓 환불 요청')
    // 10번: 화면 세션 목록에서는 RLS 로 탈퇴 회원 행이 빠진다. 서버 키로 읽어 사유·메모를 가린 채 '탈퇴 회원'으로 붙인다.
    let withdrawnMarketRefunds: Awaited<ReturnType<typeof readWithdrawnMarketRefundRequests>> = []
    if (canMarket) {
        try {
            withdrawnMarketRefunds = await readWithdrawnMarketRefundRequests()
        } catch (error) {
            console.error('[admin-refunds] 탈퇴 회원 자료 환불 조회 실패', { message: error instanceof Error ? error.message : String(error) })
            loadErrors.push('탈퇴 회원 문제마켓 환불 요청')
        }
    }
    const marketRefundRows = [...(marketRefundRequests || []), ...withdrawnMarketRefunds]
        .sort((a, b) => b.created_at.localeCompare(a.created_at))

    const salesStatus = canPayment ? await getPaymentSalesStatus() : null

    return (
        <div className="space-y-8">
            {canPayment && <PaymentSalesPanel status={salesStatus} canStopSales={hasAdminPermission(access, 'owner')} />}
            {loadErrors.length > 0 && (
                <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                    <p className="font-semibold">다음 목록을 불러오지 못했습니다: {loadErrors.join(', ')}</p>
                    <p className="mt-1">비어 보여도 처리할 건이 있을 수 있습니다. 새로고침해도 같으면 개발 담당자에게 알려 주세요.</p>
                </div>
            )}
            {/* 결제 경보와 수동 확인 주문을 환불 요청보다 위에 둔다(가장 먼저 봐야 하는 것). */}
            {canPayment && (
            <RefundsClient
                requests={paymentRefundRows as RefundRequest[]}
                stats={{ pendingCount, completedCount, rejectedCount, attentionCount }}
            >
                <PaymentReviewClient
                    orders={reviewOrders}
                    alerts={(paymentAlerts || []) as PaymentAlert[]}
                />
            </RefundsClient>
            )}
            {canMarket && <h2 className="sr-only">문제마켓 환불</h2>}
            {canMarket && <MarketRefundsClient requests={marketRefundRows as MarketRefundRequestRow[]} isOwner={access.role === 'owner'} />}
        </div>
    )
}
