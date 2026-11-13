import { createClient } from '@/lib/supabase/server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'

// 관리자가 처리해야 할 일의 건수. 대시보드·알림이 같은 숫자를 보도록 이 함수 하나만 쓴다.
// 세지 못한 항목은 0이 아니라 null이다("없음"과 "확인 불가"를 구분).
export interface AdminWorkSummary {
  supportPending: number | null
  marketRefundPending: number | null
  refundPending: number | null
  refundAttention: number | null
  paymentOrderReview: number | null
  paymentAlertOpen: number | null
}

type CountResult = PromiseLike<{ count: number | null; error: unknown }>

async function countOrNull(label: string, query: () => CountResult): Promise<number | null> {
  try {
    const { count, error } = await query()
    if (error || count === null) {
      console.error(`[admin-work-summary] ${label} 건수 조회 실패`, error)
      return null
    }
    return count
  } catch (error) {
    console.error(`[admin-work-summary] ${label} 건수 조회 실패`, error)
    return null
  }
}

// 관리자 확인을 마친 요청에서만 부른다(충전 환불·결제 주문·결제 경보는 service role로 읽는다).
export async function getAdminWorkSummary(): Promise<AdminWorkSummary> {
  const supabase = await createClient()
  const head = { count: 'exact', head: true } as const

  const [
    supportPending,
    marketRefundPending,
    refundPending,
    refundAttention,
    paymentOrderReview,
    paymentAlertOpen,
  ] = await Promise.all([
    countOrNull('문의', () => supabase
      .from('support_tickets')
      .select('id', head)
      .eq('status', 'pending')
      .eq('is_deleted_by_user', false)),
    countOrNull('문제마켓 환불', () => supabase
      .from('market_refund_requests')
      .select('id', head)
      .eq('status', 'pending')),
    countOrNull('충전 환불 대기', () => createPaymentAdminClient()
      .from('refund_requests')
      .select('id', head)
      .eq('status', 'pending_review')),
    countOrNull('충전 환불 확인 필요', () => createPaymentAdminClient()
      .from('refund_requests')
      .select('id', head)
      .in('status', ['retryable_failed', 'manual_review'])),
    countOrNull('수동 확인 주문', () => createPaymentAdminClient()
      .from('payment_orders')
      .select('id', head)
      .eq('status', 'manual_review')),
    countOrNull('결제 경보', () => createPaymentAdminClient()
      .from('payment_reconciliation_alerts')
      .select('id', head)
      .is('resolved_at', null)),
  ])

  return { supportPending, marketRefundPending, refundPending, refundAttention, paymentOrderReview, paymentAlertOpen }
}
