import { createAdminClient } from '@/lib/supabase/bypass'
import { markWithdrawnRows } from '@/lib/withdrawn-member-redaction-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import { hasAdminPermission, type AdminAccess, type AdminPermissionKey } from '@/lib/admin-permissions'

// 관리자 대시보드의 매출·판매 지표와 최근 주문·문의. 조회만 한다.
// 권한이 없는 구역은 조회 자체를 하지 않는다. 한 항목이 실패해도 다른 항목은 그대로 보여 준다.
// 합계는 PostgREST 응답 상한에 걸리지 않게 끝까지 나눠 읽어 더한다. 테스트 환경 결제는 세지 않는다.

const RECENT_LIMIT = 5

// 한국 시간 기준 오늘·이번 달 값. 오늘은 이번 달에 포함된다.
export interface PeriodPair<T> {
  today: T
  month: T
}

// 항목이 null이면 세지 못한 것이다("확인 불가" — 0과 구분).
export interface AdminDashboardMetrics {
  // 실결제 충전 주문 중 결제가 끝난 것(뒤에 환불된 주문 포함). 기간은 결제 승인 시각 기준.
  payment: PeriodPair<{ count: number; amount: number }> | null
  // 실결제 주문의 환불 완료 금액. 기간은 환불 처리 시각 기준.
  refundAmount: PeriodPair<number> | null
  // 마켓 구매. count·credits는 지금 유효한 구매(completed)만, refundedCount는 같은 기간 구매 중 환불·회수된 건수.
  market: PeriodPair<{ count: number; credits: number; refundedCount: number }> | null
  downloads: PeriodPair<number> | null
}

// null = 권한이 없어 읽지 않음, failed = 읽지 못함("없음"과 구분)
export type DashboardSection<T> = { failed: false; data: T } | { failed: true } | null

async function orNull<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read()
  } catch (error) {
    console.error('[admin-dashboard] 지표를 읽지 못했습니다.', { metric: name, message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

async function readSection<T>(
  access: AdminAccess,
  permission: AdminPermissionKey,
  name: string,
  read: () => Promise<T>
): Promise<DashboardSection<T>> {
  if (!hasAdminPermission(access, permission)) return null
  try {
    return { failed: false, data: await read() }
  } catch (error) {
    console.error('[admin-dashboard] 구역을 읽지 못했습니다.', { section: name, message: error instanceof Error ? error.message : String(error) })
    return { failed: true }
  }
}

// 이번 달 행을 한 번 읽어 오늘 것과 이번 달 것으로 나눠 계산한다.
function byPeriod<Row, T>(rows: Row[], at: (row: Row) => string | null, todayStart: string, summarize: (rows: Row[]) => T): PeriodPair<T> {
  const todayMs = Date.parse(todayStart)
  return {
    today: summarize(rows.filter((row) => Date.parse(at(row) ?? '') >= todayMs)),
    month: summarize(rows),
  }
}

async function readPaymentTotals(todayStart: string, monthStart: string) {
  const rows = await readAllQueryRows((from, to) => createPaymentAdminClient()
    .from('payment_orders')
    .select('expected_amount, approved_at')
    .eq('provider_environment', 'live')
    .in('status', ['completed', 'refunded'])
    .gte('approved_at', monthStart)
    .order('id')
    .range(from, to))
  return byPeriod(rows, (row) => row.approved_at, todayStart, (list) => ({
    count: list.length,
    amount: list.reduce((sum, row) => sum + row.expected_amount, 0),
  }))
}

async function readRefundTotals(todayStart: string, monthStart: string) {
  const rows = await readAllQueryRows((from, to) => createPaymentAdminClient()
    .from('refund_requests')
    .select('refund_amount, processed_at, order:payment_orders!refund_requests_payment_order_id_fkey!inner(provider_environment)')
    .eq('status', 'completed')
    .eq('order.provider_environment', 'live')
    .gte('processed_at', monthStart)
    .order('id')
    .range(from, to))
  // 금액이 비어 있는 환불이 섞이면 합계가 실제보다 작아지므로 "확인 불가"로 둔다.
  if (rows.some((row) => row.refund_amount === null)) throw new Error('REFUND_AMOUNT_MISSING')
  return byPeriod(rows, (row) => row.processed_at, todayStart, (list) => list.reduce((sum, row) => sum + (row.refund_amount ?? 0), 0))
}

async function readMarketTotals(todayStart: string, monthStart: string) {
  const rows = await readAllQueryRows((from, to) => createAdminClient()
    .from('market_purchase_orders')
    .select('status, charged_credits, refunded_credits, created_at')
    .in('status', ['completed', 'refunded', 'revoked'])
    .gte('created_at', monthStart)
    .order('id')
    .range(from, to))
  return byPeriod(rows, (row) => row.created_at, todayStart, (list) => {
    const completed = list.filter((row) => row.status === 'completed')
    return {
      count: completed.length,
      // 8번: 일부 환불된 주문은 completed 로 남으므로 환불된 크레딧을 뺀다.
      credits: completed.reduce((sum, row) => sum + row.charged_credits - (row.refunded_credits ?? 0), 0),
      refundedCount: list.length - completed.length,
    }
  })
}

async function countDownloads(since: string) {
  const { count, error } = await createAdminClient()
    .from('market_download_events')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
  if (error || count === null) throw new Error(error?.message ?? 'DOWNLOAD_COUNT_MISSING')
  return count
}

async function readRecentPaymentOrders() {
  const { data, error } = await createPaymentAdminClient()
    .from('payment_orders')
    .select('id, order_id, user_id, status, plan_name_snapshot, expected_amount, created_at, user:profiles!payment_orders_user_id_fkey(email)')
    .eq('provider_environment', 'live')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  return data
}

// 문의는 제목·상태·시각만 읽는다(본문은 문의 관리 화면에서 본다). 회원이 삭제한 문의는 뺀다.
async function readRecentSupportTickets() {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .select('id, subject, status, created_at, user_id, user:profiles!support_tickets_user_id_profiles_fkey(email)')
    .eq('is_deleted_by_user', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  // 10번: 탈퇴 회원 문의는 제목을 '탈퇴 회원 문의'(DB 문구)로 바꿔 보낸다(본문은 원래 읽지 않음).
  return markWithdrawnRows(data, (ticket) => ticket.user_id, (ticket, title) => ({ ...ticket, subject: title, user: { email: null } }))
}

// 관리자 확인을 마친 요청에서만 부른다(service role로 읽는다). period는 getKstPeriodStarts()의 값이다.
export async function getAdminDashboard(access: AdminAccess, period: { todayStart: string; monthStart: string }) {
  const { todayStart, monthStart } = period

  const readMetrics = async (): Promise<AdminDashboardMetrics | null> => {
    if (!hasAdminPermission(access, 'orders.view')) return null
    const [payment, refundAmount, market, downloads] = await Promise.all([
      orNull('충전 결제', () => readPaymentTotals(todayStart, monthStart)),
      orNull('충전 환불', () => readRefundTotals(todayStart, monthStart)),
      orNull('마켓 판매', () => readMarketTotals(todayStart, monthStart)),
      orNull('다운로드', async () => {
        const [today, month] = await Promise.all([countDownloads(todayStart), countDownloads(monthStart)])
        return { today, month }
      }),
    ])
    return { payment, refundAmount, market, downloads }
  }

  const [metrics, recentOrders, recentTickets] = await Promise.all([
    readMetrics(),
    readSection(access, 'orders.view', '최근 충전 주문', readRecentPaymentOrders),
    readSection(access, 'support.manage', '최근 문의', readRecentSupportTickets),
  ])

  return { metrics, recentOrders, recentTickets }
}

export type AdminDashboard = Awaited<ReturnType<typeof getAdminDashboard>>
