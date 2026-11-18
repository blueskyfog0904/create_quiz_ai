import { createClient } from '@/lib/supabase/server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { ADMIN_WORK_ITEMS } from '@/lib/admin-alerts'
import { hasAdminPermission, type AdminAccess } from '@/lib/admin-permissions'

// 관리자가 처리해야 할 일의 건수. 대시보드·알림이 같은 숫자를 보도록 이 함수 하나만 쓴다.
// 세지 못한 항목은 0이 아니라 null이다("없음"과 "확인 불가"를 구분).
// 그 계정에 권한이 없는 항목은 세지 않고 빠진다(undefined — JSON에서 키가 없어져 화면이 그리지 않는다). 항목별 권한은 ADMIN_WORK_ITEMS.
export interface AdminWorkSummary {
  supportPending?: number | null
  marketRefundPending?: number | null
  refundPending?: number | null
  refundAttention?: number | null
  paymentOrderReview?: number | null
  paymentAlertOpen?: number | null
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
// access가 null이면(권한을 읽지 못함) 세지 않고 모든 항목을 null("확인 불가")로 돌려준다 — 권한을 모르는 채 숫자를 보이지 않는다.
export async function getAdminWorkSummary(access: AdminAccess | null): Promise<AdminWorkSummary> {
  const supabase = await createClient()
  const head = { count: 'exact', head: true } as const

  const counters: Record<keyof AdminWorkSummary, () => Promise<number | null>> = {
    supportPending: () => countOrNull('문의', () => supabase
      .from('support_tickets')
      .select('id', head)
      .eq('status', 'pending')
      .eq('is_deleted_by_user', false)),
    marketRefundPending: () => countOrNull('문제마켓 환불', () => supabase
      .from('market_refund_requests')
      .select('id', head)
      .eq('status', 'pending')),
    refundPending: () => countOrNull('충전 환불 대기', () => createPaymentAdminClient()
      .from('refund_requests')
      .select('id', head)
      .eq('status', 'pending_review')),
    refundAttention: () => countOrNull('충전 환불 확인 필요', () => createPaymentAdminClient()
      .from('refund_requests')
      .select('id', head)
      .in('status', ['retryable_failed', 'manual_review'])),
    paymentOrderReview: () => countOrNull('수동 확인 주문', () => createPaymentAdminClient()
      .from('payment_orders')
      .select('id', head)
      .eq('status', 'manual_review')),
    paymentAlertOpen: () => countOrNull('결제 경보', () => createPaymentAdminClient()
      .from('payment_reconciliation_alerts')
      .select('id', head)
      .is('resolved_at', null)),
  }

  const entries = await Promise.all(ADMIN_WORK_ITEMS.map(async (item) => {
    if (!access) return [item.key, null] as const
    if (!hasAdminPermission(access, item.requirement)) return null
    return [item.key, await counters[item.key]()] as const
  }))

  return Object.fromEntries(entries.filter((entry) => entry !== null)) as AdminWorkSummary
}
