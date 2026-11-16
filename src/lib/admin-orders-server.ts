import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { extractAdminLoginId } from '@/lib/admin-accounts-shared'
import { getKstDateStart } from '@/lib/kst-period'
import { getListPagination } from '@/lib/list-pagination'
import {
  PAYMENT_ENVIRONMENT_LABELS,
  PAYMENT_ORDER_STATUS_LABELS,
  PAYMENT_PROVIDER_LABELS,
  buildPaymentOrderSearchFilter,
  escapeIlike,
  normalizeOrderFilter,
} from '@/lib/admin-orders'

// 관리자 '주문 조회 › 충전 결제'. 조회만 한다. 결제 표는 service role 전용이라 결제용 클라이언트로 읽는다.

export interface AdminPaymentOrderAction {
  id: string
  action: string
  note: string
  externalMethod: string | null
  recoveredCredits: number | null
  unrecoveredCredits: number | null
  createdAt: string
  // 조치한 관리자(관리자 아이디 또는 이메일). 찾지 못하면 null
  actor: string | null
}

export interface AdminPaymentOrder {
  id: string
  orderId: string
  provider: string
  environment: string
  status: string
  planName: string
  amount: number
  credits: number
  failureCode: string | null
  failureMessage: string | null
  createdAt: string
  approvedAt: string | null
  fulfilledAt: string | null
  canceledAt: string | null
  user: { email: string | null; display_tag: string } | null
  methodLabel: string | null
  transaction: {
    provider_transaction_id: string | null
    provider_status: string | null
    paid_amount: number | null
    paid_feedback_recorded_at: string | null
    admin_paid_confirmed_at: string | null
    cancel_feedback_recorded_at: string | null
    cancel_processed_at: string | null
    partial_cancel_feedback_recorded_at: string | null
    partial_cancel_processed_at: string | null
    partial_cancel_amount: number | null
  } | null
  source: {
    id: string
    initial_credits: number
    remaining_credits: number
    status: string
    expires_at: string | null
  } | null
  refunds: Array<{
    id: string
    status: string
    origin: string
    refund_amount: number | null
    created_at: string
    processed_at: string | null
  }>
  actions: AdminPaymentOrderAction[]
}

export interface AdminPaymentOrderListResult {
  orders: AdminPaymentOrder[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  // 조치 기록만 읽지 못했다(주문 목록은 정상). 화면에서 "기록 없음"과 구분한다.
  actionsUnavailable: boolean
  // 검색어에 맞는 회원이 상한을 넘어 일부 회원의 주문만 찾았다. 화면에서 검색어를 좁히라고 안내한다.
  searchTruncated: boolean
}

// FK가 양방향인 관계(payment_orders ↔ credit_sources)가 있어 관계마다 FK 이름을 적는다.
const ORDER_COLUMNS = `
  id, order_id, provider, environment, status, plan_name_snapshot, expected_amount, expected_credits,
  failure_code, failure_message, created_at, approved_at, fulfilled_at, canceled_at,
  user:profiles!payment_orders_user_id_fkey(email, display_tag),
  method:payment_methods!payment_orders_payment_method_fkey(label),
  transaction:payment_provider_transactions!payment_provider_transactions_payment_order_id_fkey(
    provider_transaction_id, provider_status, paid_amount,
    paid_feedback_recorded_at, admin_paid_confirmed_at,
    cancel_feedback_recorded_at, cancel_processed_at,
    partial_cancel_feedback_recorded_at, partial_cancel_processed_at, partial_cancel_amount
  ),
  source:credit_sources!payment_orders_source_id_fkey(id, initial_credits, remaining_credits, status, expires_at),
  refunds:refund_requests!refund_requests_payment_order_id_fkey(id, status, origin, refund_amount, created_at, processed_at)
` as const

// 검색어로 찾는 회원·거래 수 상한(조건에 넣는 id가 너무 많아지지 않게)
const SEARCH_MATCH_LIMIT = 50

export async function listPaymentOrdersForAdmin(input: {
  q?: string | null
  provider?: unknown
  status?: unknown
  environment?: unknown
  from?: string | null
  to?: string | null
  page?: unknown
  pageSize?: unknown
}): Promise<AdminPaymentOrderListResult> {
  const supabase = createPaymentAdminClient()
  const query = (input.q ?? '').trim()
  const provider = normalizeOrderFilter(PAYMENT_PROVIDER_LABELS, input.provider)
  const status = normalizeOrderFilter(PAYMENT_ORDER_STATUS_LABELS, input.status)
  const environment = normalizeOrderFilter(PAYMENT_ENVIRONMENT_LABELS, input.environment)
  // 기간은 한국 날짜 기준: 시작일 00:00 이상, 종료일 다음 날 00:00 미만. 시작과 종료가 뒤바뀌어 들어오면 바로잡는다.
  const [fromDate, toDate] = input.from && input.to && input.from > input.to ? [input.to, input.from] : [input.from, input.to]
  const createdFrom = getKstDateStart(fromDate)
  const createdBefore = getKstDateStart(toDate, 1)

  let searchFilter: string | null = null
  let searchTruncated = false
  if (query) {
    // PostgREST는 ilike 값의 *를 와일드카드로 바꾸고 이를 막을 방법이 없다. 이메일에는 쓰지 않는 글자라 빼고 찾는다.
    const emailKeyword = query.replaceAll('*', '')
    const [usersResult, transactionsResult] = await Promise.all([
      emailKeyword
        // 상한보다 하나 더 읽어 넘쳤는지 알아낸다. 쪽을 넘겨도 같은 회원들이 잡히게 id 순으로 읽는다.
        ? supabase.from('profiles').select('id').ilike('email', `%${escapeIlike(emailKeyword)}%`).order('id').limit(SEARCH_MATCH_LIMIT + 1)
        : { data: [], error: null },
      supabase
        .from('payment_provider_transactions')
        .select('payment_order_id')
        .eq('provider_transaction_id', query)
        .limit(SEARCH_MATCH_LIMIT),
    ])
    if (usersResult.error) throw new Error(usersResult.error.message)
    if (transactionsResult.error) throw new Error(transactionsResult.error.message)
    const matchedUsers = usersResult.data ?? []
    searchTruncated = matchedUsers.length > SEARCH_MATCH_LIMIT
    searchFilter = buildPaymentOrderSearchFilter(
      query,
      matchedUsers.slice(0, SEARCH_MATCH_LIMIT).map((user) => user.id),
      (transactionsResult.data ?? []).map((transaction) => transaction.payment_order_id)
    )
  }

  // 페이지가 총 페이지를 넘으면 range가 실패하므로, 건수를 먼저 세고 페이지를 맞춘다.
  let countQuery = supabase.from('payment_orders').select('id', { count: 'exact', head: true })
  let dataQuery = supabase.from('payment_orders').select(ORDER_COLUMNS)
  if (provider !== 'all') {
    countQuery = countQuery.eq('provider', provider)
    dataQuery = dataQuery.eq('provider', provider)
  }
  if (status !== 'all') {
    countQuery = countQuery.eq('status', status)
    dataQuery = dataQuery.eq('status', status)
  }
  if (environment !== 'all') {
    countQuery = countQuery.eq('environment', environment)
    dataQuery = dataQuery.eq('environment', environment)
  }
  if (createdFrom) {
    countQuery = countQuery.gte('created_at', createdFrom)
    dataQuery = dataQuery.gte('created_at', createdFrom)
  }
  if (createdBefore) {
    countQuery = countQuery.lt('created_at', createdBefore)
    dataQuery = dataQuery.lt('created_at', createdBefore)
  }
  if (searchFilter) {
    countQuery = countQuery.or(searchFilter)
    dataQuery = dataQuery.or(searchFilter)
  }

  const { count, error: countError } = await countQuery
  if (countError) throw new Error(countError.message)
  const pagination = getListPagination(count ?? 0, input.page, input.pageSize)
  const emptyResult = {
    totalCount: pagination.totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
  }
  if (pagination.totalCount === 0) return { orders: [], ...emptyResult, actionsUnavailable: false, searchTruncated }

  const { data, error } = await dataQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1)
  if (error) throw new Error(error.message)
  const rows = data ?? []

  // 관리자 조치 기록은 FK가 없는 추가 전용 표라 주문 id로 따로 읽는다.
  const orderIds = rows.map((row) => row.id)
  const actionsResult = orderIds.length > 0
    ? await supabase
        .from('payment_admin_actions')
        .select('id, actor_id, action, payment_order_id, note, external_method, recovered_credits, unrecovered_credits, created_at')
        .in('payment_order_id', orderIds)
        .order('created_at', { ascending: false })
    : { data: [], error: null }
  if (actionsResult.error) console.error('[admin-orders] 관리자 조치 기록을 읽지 못했습니다.', { message: actionsResult.error.message })
  const actionRows = actionsResult.data ?? []

  const actorIds = Array.from(new Set(actionRows.map((action) => action.actor_id)))
  const actorsResult = actorIds.length > 0
    ? await supabase.from('profiles').select('id, email').in('id', actorIds)
    : { data: [], error: null }
  if (actorsResult.error) console.error('[admin-orders] 조치한 관리자를 읽지 못했습니다.', { message: actorsResult.error.message })
  const actorById = new Map((actorsResult.data ?? []).map((actor) => [actor.id, actor.email ? extractAdminLoginId(actor.email) : null]))

  return {
    orders: rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      provider: row.provider,
      environment: row.environment,
      status: row.status,
      planName: row.plan_name_snapshot,
      amount: row.expected_amount,
      credits: row.expected_credits,
      failureCode: row.failure_code,
      failureMessage: row.failure_message,
      createdAt: row.created_at,
      approvedAt: row.approved_at,
      fulfilledAt: row.fulfilled_at,
      canceledAt: row.canceled_at,
      user: row.user,
      methodLabel: row.method?.label ?? null,
      transaction: row.transaction,
      source: row.source,
      refunds: row.refunds,
      actions: actionRows
        .filter((action) => action.payment_order_id === row.id)
        .map((action) => ({
          id: action.id,
          action: action.action,
          note: action.note,
          externalMethod: action.external_method,
          recoveredCredits: action.recovered_credits,
          unrecoveredCredits: action.unrecovered_credits,
          createdAt: action.created_at,
          actor: actorById.get(action.actor_id) ?? null,
        })),
    })),
    ...emptyResult,
    actionsUnavailable: Boolean(actionsResult.error),
    searchTruncated,
  }
}
