import { createAdminClient } from '@/lib/supabase/bypass'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { getCreditBalanceSnapshot } from '@/lib/credit-balance'
import { listMarketOrdersForAdmin, listPaymentOrdersForAdmin } from '@/lib/admin-orders-server'
import { UUID_PATTERN } from '@/lib/admin-orders'
import { refundRequiresRecovery } from '@/lib/payment-review-actions'
import { hasAdminPermission, type AdminAccess, type AdminPermissionKey } from '@/lib/admin-permissions'

// 관리자 '회원 상세'(/admin/users/[id]). 조회만 한다.
// 구역마다 권한이 있을 때만 읽는다(권한이 없으면 조회 자체를 하지 않는다). 한 구역이 실패해도 다른 구역은 그대로 보여 준다.

// null = 권한이 없어 읽지 않음, failed = 읽지 못함("없음"과 구분)
export type MemberDetailSection<T> = { failed: false; data: T } | { failed: true } | null

// 주문·환불·문의는 최근 것만 보여 주고 전체는 각 관리 화면에서 본다.
const RECENT_LIMIT = 10
const TRANSACTION_LIMIT = 50
const SOURCE_LIMIT = 50

async function readSection<T>(
  access: AdminAccess,
  permission: AdminPermissionKey,
  name: string,
  read: () => Promise<T>
): Promise<MemberDetailSection<T>> {
  if (!hasAdminPermission(access, permission)) return null
  try {
    return { failed: false, data: await read() }
  } catch (error) {
    console.error('[admin-member-detail] 구역을 읽지 못했습니다.', { section: name, message: error instanceof Error ? error.message : String(error) })
    return { failed: true }
  }
}

// 쓸 수 있는 잔액(get_credit_balance_snapshot)과 남은 수량이 있는 원천
async function readCredits(userId: string) {
  const [snapshot, sources] = await Promise.all([
    getCreditBalanceSnapshot(userId),
    createAdminClient()
      .from('credit_sources')
      .select('id, source_category, initial_credits, remaining_credits, status, expires_at, purchased_at, plan:pricing_plans!credit_sources_plan_id_fkey(name)')
      .eq('user_id', userId)
      .gt('remaining_credits', 0)
      .order('purchased_at', { ascending: false })
      .order('id', { ascending: false })
      // 상한보다 하나 더 읽어 넘쳤는지 알아낸다.
      .limit(SOURCE_LIMIT + 1),
  ])
  if (sources.error) throw new Error(sources.error.message)
  return {
    spendableBalance: snapshot.spendableBalance,
    expiredBalance: snapshot.expiredBalance,
    nextExpirationAt: snapshot.nextExpirationAt,
    // 원천이 만료됐는지는 잔액과 같은 기준 시각(DB 시각)으로 가린다.
    databaseNow: snapshot.databaseNow,
    sources: sources.data.slice(0, SOURCE_LIMIT),
    sourcesTruncated: sources.data.length > SOURCE_LIMIT,
  }
}

async function readCreditTransactions(userId: string) {
  const { data, error } = await createAdminClient()
    .from('credit_transactions')
    .select('id, type, amount, balance_after, description, created_at, source:credit_sources!credit_transactions_source_id_fkey(source_category)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(TRANSACTION_LIMIT)
  if (error) throw new Error(error.message)
  return data.map(({ source, ...transaction }) => ({ ...transaction, source_category: source?.source_category ?? null }))
}

async function readPaymentOrders(userId: string) {
  const result = await listPaymentOrdersForAdmin({ userId })
  return { orders: result.orders.slice(0, RECENT_LIMIT), totalCount: result.totalCount }
}

async function readMarketOrders(userId: string) {
  const result = await listMarketOrdersForAdmin({ userId })
  return {
    orders: result.orders.slice(0, RECENT_LIMIT),
    totalCount: result.totalCount,
    downloadsUnavailable: result.downloadsUnavailable,
    downloadsTruncated: result.downloadsTruncated,
  }
}

// 충전 환불 요청. 결제 표는 결제용 클라이언트로 읽는다.
async function readPaymentRefunds(userId: string) {
  const { data, count, error } = await createPaymentAdminClient()
    .from('refund_requests')
    .select(
      `id, status, origin, refund_amount, reason, last_error_code, created_at, processed_at,
      order:payment_orders!refund_requests_payment_order_id_fkey(
        order_id, plan_name_snapshot,
        transaction:payment_provider_transactions!payment_provider_transactions_payment_order_id_fkey(cancel_feedback_recorded_at, partial_cancel_feedback_recorded_at)
      )`,
      { count: 'exact' }
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  return {
    requests: data.map(({ last_error_code, order, ...request }) => ({
      ...request,
      order: order && { order_id: order.order_id, plan_name_snapshot: order.plan_name_snapshot },
      // 환불 관리 화면과 같은 기준: 부분취소 건의 완료 전 금액은 실제 환불액이 아니라 신청 기준액(전액)이다.
      amountIsRequestBasis: request.status !== 'completed' && refundRequiresRecovery({
        origin: request.origin,
        cancelMarker: Boolean(order?.transaction?.cancel_feedback_recorded_at),
        partialCancelMarker: Boolean(order?.transaction?.partial_cancel_feedback_recorded_at),
        lastErrorCode: last_error_code,
      }),
    })),
    totalCount: count ?? data.length,
  }
}

async function readMarketRefunds(userId: string) {
  const { data, count, error } = await createAdminClient()
    .from('market_refund_requests')
    .select(
      'id, status, order_id, requested_refund_credits, approved_refund_credits, reason, created_at, processed_at, item:market_items!market_refund_requests_item_id_fkey(title)',
      { count: 'exact' }
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  return { requests: data, totalCount: count ?? data.length }
}

// 문의는 제목·상태·시각만 읽는다(본문은 문의 관리 화면에서 본다). 회원이 삭제한 문의도 포함한다.
async function readSupportTickets(userId: string) {
  const { data, count, error } = await createAdminClient()
    .from('support_tickets')
    .select('id, subject, status, created_at, responded_at, is_deleted_by_user', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  return { tickets: data, totalCount: count ?? data.length }
}

// 회원이 없거나 id가 uuid 모양이 아니면 null. 기본 정보를 읽지 못하면 예외로 올린다(화면 전체가 오류).
export async function getAdminMemberDetail(access: AdminAccess, userId: string) {
  if (!UUID_PATTERN.test(userId)) return null

  const { data: profile, error } = await createAdminClient()
    .from('profiles')
    .select('id, email, display_tag, phone, created_at, provider, is_admin')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!profile) return null

  const [credits, creditTransactions, paymentOrders, marketOrders, paymentRefunds, marketRefunds, supportTickets] = await Promise.all([
    readSection(access, 'credits.view', '크레딧', () => readCredits(userId)),
    readSection(access, 'credits.view', '크레딧 거래', () => readCreditTransactions(userId)),
    readSection(access, 'orders.view', '충전 결제', () => readPaymentOrders(userId)),
    readSection(access, 'orders.view', '마켓 구매', () => readMarketOrders(userId)),
    readSection(access, 'orders.view', '충전 환불', () => readPaymentRefunds(userId)),
    readSection(access, 'orders.view', '마켓 환불', () => readMarketRefunds(userId)),
    readSection(access, 'support.manage', '문의', () => readSupportTickets(userId)),
  ])

  return { profile, credits, creditTransactions, paymentOrders, marketOrders, paymentRefunds, marketRefunds, supportTickets }
}

async function countRows(query: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await query
  if (error) throw new Error(error.message)
  return count ?? 0
}

// 문의 상세 창의 회원 요약: 건수만 센다. 회원 상세와 같이 권한이 없는 항목은 세지 않는다(null).
export async function getAdminMemberSummary(access: AdminAccess, userId: string, currentTicketId: string) {
  const head = { count: 'exact', head: true } as const
  const [paymentOrders, marketOrders, otherTickets] = await Promise.all([
    readSection(access, 'orders.view', '충전 결제 건수', () => countRows(
      createPaymentAdminClient().from('payment_orders').select('id', head).eq('user_id', userId)
    )),
    readSection(access, 'orders.view', '마켓 구매 건수', () => countRows(
      createAdminClient().from('market_purchase_orders').select('id', head).eq('user_id', userId)
    )),
    // 지금 보고 있는 문의는 빼고 센다. 회원이 삭제한 문의도 포함한다.
    readSection(access, 'support.manage', '다른 문의 건수', () => countRows(
      createAdminClient().from('support_tickets').select('id', head).eq('user_id', userId).neq('id', currentTicketId)
    )),
  ])
  return { paymentOrders, marketOrders, otherTickets }
}

export type AdminMemberSummary = Awaited<ReturnType<typeof getAdminMemberSummary>>
