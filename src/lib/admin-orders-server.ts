import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { extractAdminLoginId } from '@/lib/admin-accounts-shared'
import { getKstDateStart } from '@/lib/kst-period'
import { getListPagination } from '@/lib/list-pagination'
import {
  MARKET_ORDER_STATUS_LABELS,
  PAYMENT_ENVIRONMENT_LABELS,
  PAYMENT_ORDER_STATUS_LABELS,
  PAYMENT_PROVIDER_LABELS,
  WORKSPACE_SUBJECT_LABELS,
  buildMarketOrderSearchFilter,
  buildPaymentOrderSearchFilter,
  escapeIlike,
  normalizeOrderFilter,
} from '@/lib/admin-orders'
import { createAdminClient } from '@/lib/supabase/bypass'
import { readWithdrawnUserIdsForRedaction } from '@/lib/withdrawn-member-redaction-server'
import { diagnoseMarketFileDownload, type MarketDownloadBlockReason, type MarketDownloadDiagnosis } from '@/lib/market-download-diagnosis'
import { buildPendingMarketRefundScopes, isPendingRefundBlockingFile } from '@/lib/market-refund-rules'

// 관리자 '주문 조회 › 충전 결제'. 조회만 한다. 결제 표는 service role 전용이라 결제용 클라이언트로 읽는다.

// 10번: 탈퇴 회원 표시·가림용. 읽지 못하면 null — 목록은 보여 주되(탈퇴 회원은 이메일이 이미 비어 있다) 환불 사유·메모는 모두 가린다.
async function readWithdrawnMembers(userIds: string[]): Promise<Set<string> | null> {
  try {
    return await readWithdrawnUserIdsForRedaction(userIds)
  } catch (error) {
    console.error('[admin-orders] 탈퇴 회원을 읽지 못했습니다.', { message: error instanceof Error ? error.message : String(error) })
    return null
  }
}

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
  userId: string
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
  // 10번: 탈퇴(익명화)한 회원(이메일 대신 '탈퇴 회원'으로 보여 준다)
  memberWithdrawn: boolean
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
  id, order_id, user_id, provider, environment, status, plan_name_snapshot, expected_amount, expected_credits,
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
  // 회원 상세용: 이 회원의 주문만(검색어와 달리 id 정확 일치)
  userId?: string
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
  if (input.userId) {
    countQuery = countQuery.eq('user_id', input.userId)
    dataQuery = dataQuery.eq('user_id', input.userId)
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
  const withdrawnMembers = await readWithdrawnMembers(rows.map((row) => row.user_id))

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
      userId: row.user_id,
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
      memberWithdrawn: withdrawnMembers?.has(row.user_id) ?? false,
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

// ───── 주문 조회 › 마켓 구매 ─────
// 조회만 한다. 마켓 표는 일반 service role 클라이언트로 읽는다.

export interface AdminMarketOrderFile {
  id: string
  fileName: string
  fileTypeLabel: string | null
  subproductTitle: string | null
  // 파일 자체가 내려갔다(비활성·삭제). 회원 보관함에는 보이지 않는 파일이라 요약 건수에서 뺀다.
  removed: boolean
  diagnosis: MarketDownloadDiagnosis
}

export interface AdminMarketOrder {
  id: string
  userId: string
  workspaceSubject: string
  status: string
  originalPriceCredits: number
  chargedCredits: number
  createdAt: string
  user: { email: string | null; display_tag: string } | null
  // 10번: 탈퇴(익명화)한 회원
  memberWithdrawn: boolean
  item: { title: string; status: string; is_active: boolean; deleted_at: string | null } | null
  lines: Array<{ id: string; lineType: string; priceCredits: number; status: string; title: string | null }>
  entitlements: Array<{ id: string; scope: string; status: string; target: string | null }>
  // 이 주문으로 받을 수 있는(또는 받을 수 있었던) 파일과 파일별 진단
  files: AdminMarketOrderFile[]
  // 회원이 실제로 받을 수 있는지(그 회원이 이 상품에 가진 모든 권한 기준)를 지금 제공 중인 파일로 요약한다.
  download: {
    fileCount: number
    downloadableCount: number
    // 받을 수 없는 파일이 있을 때 그 첫 사유
    reason: MarketDownloadBlockReason | null
    // 이 주문 자체에 사용 가능한 권한이 없는 이유. 있으면 null
    ownEntitlementReason: MarketDownloadBlockReason | null
    // 이 주문의 파일을 실제로 내려받게 해 주는, 같은 회원의 다른 주문 id(다운로드 기록도 그 주문에 남는다)
    otherOrderIds: string[]
  }
  downloads: { count: number; latestAt: string | null; recent: Array<{ id: string; createdAt: string; fileName: string | null }> }
  refunds: Array<{
    id: string
    status: string
    requested_refund_credits: number
    approved_refund_credits: number | null
    reason: string | null
    admin_note: string | null
    created_at: string
    processed_at: string | null
  }>
}

export interface AdminMarketOrderListResult {
  orders: AdminMarketOrder[]
  totalCount: number
  page: number
  pageSize: number
  totalPages: number
  // 다운로드 기록만 읽지 못했다(주문 목록은 정상). 화면에서 "기록 없음"과 구분한다.
  downloadsUnavailable: boolean
  // 이 쪽 주문들의 다운로드 기록이 상한을 넘어 최근 것만 읽었다. 건수가 실제보다 적을 수 있다.
  downloadsTruncated: boolean
  // 검색어에 맞는 회원·상품이 상한을 넘어 일부의 주문만 찾았다.
  searchTruncated: boolean
}

// 과목까지 묶인 FK(…_workspace_fkey)가 많아 관계마다 FK 이름을 적는다.
const MARKET_ORDER_COLUMNS = `
  id, workspace_subject, user_id, item_id, status, original_price_credits, charged_credits, created_at,
  user:profiles!market_purchase_orders_user_id_fkey(email, display_tag),
  item:market_items!market_purchase_orders_item_workspace_fkey(title, status, is_active, deleted_at),
  lines:market_purchase_lines!market_purchase_lines_order_workspace_fkey(
    id, line_type, price_credits, status, subproduct_id,
    subproduct:market_item_subproducts!market_purchase_lines_subproduct_workspace_fkey(title),
    bundle:market_item_bundle_options!market_purchase_lines_bundle_workspace_fkey(label)
  ),
  entitlements:market_entitlements!market_entitlements_order_workspace_fkey(id, item_id, scope, status, subproduct_id, file_id, source_order_id),
  refunds:market_refund_requests!market_refund_requests_order_id_fkey(
    id, status, requested_refund_credits, approved_refund_credits, reason, admin_note, created_at, processed_at
  )
` as const

const MARKET_FILE_COLUMNS = `
  id, item_id, subproduct_id, original_file_name, is_active, deleted_at,
  subproduct:market_item_subproducts!market_subproduct_files_subproduct_workspace_fkey(title, is_active, deleted_at),
  file_type:market_file_types!market_subproduct_files_type_workspace_fkey(label)
` as const

// 한 쪽의 주문들에서 읽는 다운로드 기록 수 상한, 주문 상세에 보여 주는 최근 기록 수
const DOWNLOAD_EVENT_READ_LIMIT = 500
const DOWNLOAD_RECENT_LIMIT = 20

export async function listMarketOrdersForAdmin(input: {
  q?: string | null
  status?: unknown
  subject?: unknown
  from?: string | null
  to?: string | null
  page?: unknown
  pageSize?: unknown
  // 회원 상세용: 이 회원의 주문만(검색어와 달리 id 정확 일치)
  userId?: string
}): Promise<AdminMarketOrderListResult> {
  const supabase = createAdminClient()
  const query = (input.q ?? '').trim()
  const status = normalizeOrderFilter(MARKET_ORDER_STATUS_LABELS, input.status)
  const subject = normalizeOrderFilter(WORKSPACE_SUBJECT_LABELS, input.subject)
  const [fromDate, toDate] = input.from && input.to && input.from > input.to ? [input.to, input.from] : [input.from, input.to]
  const createdFrom = getKstDateStart(fromDate)
  const createdBefore = getKstDateStart(toDate, 1)

  let searchFilter: string | null = null
  let searchTruncated = false
  if (query) {
    // 충전 결제와 같은 방식: *는 빼고, 상한보다 하나 더 읽어 넘쳤는지 알아내고, id 순으로 읽는다.
    const keyword = query.replaceAll('*', '')
    const [usersResult, itemsResult] = keyword
      ? await Promise.all([
          supabase.from('profiles').select('id').ilike('email', `%${escapeIlike(keyword)}%`).order('id').limit(SEARCH_MATCH_LIMIT + 1),
          // 숨김·삭제된 상품의 주문도 찾아야 하므로 상품 상태로 거르지 않는다.
          supabase.from('market_items').select('id').ilike('title', `%${escapeIlike(keyword)}%`).order('id').limit(SEARCH_MATCH_LIMIT + 1),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    if (usersResult.error) throw new Error(usersResult.error.message)
    if (itemsResult.error) throw new Error(itemsResult.error.message)
    const matchedUsers = usersResult.data ?? []
    const matchedItems = itemsResult.data ?? []
    searchTruncated = matchedUsers.length > SEARCH_MATCH_LIMIT || matchedItems.length > SEARCH_MATCH_LIMIT
    searchFilter = buildMarketOrderSearchFilter(
      query,
      matchedUsers.slice(0, SEARCH_MATCH_LIMIT).map((user) => user.id),
      matchedItems.slice(0, SEARCH_MATCH_LIMIT).map((item) => item.id)
    )
  }

  let countQuery = supabase.from('market_purchase_orders').select('id', { count: 'exact', head: true })
  let dataQuery = supabase.from('market_purchase_orders').select(MARKET_ORDER_COLUMNS)
  if (status !== 'all') {
    countQuery = countQuery.eq('status', status)
    dataQuery = dataQuery.eq('status', status)
  }
  if (subject !== 'all') {
    countQuery = countQuery.eq('workspace_subject', subject)
    dataQuery = dataQuery.eq('workspace_subject', subject)
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
  if (input.userId) {
    countQuery = countQuery.eq('user_id', input.userId)
    dataQuery = dataQuery.eq('user_id', input.userId)
  }

  // 검색어가 있는데 맞는 주문 id·회원·상품이 하나도 없으면 조회하지 않고 0건이다.
  let totalCount = 0
  if (!query || searchFilter) {
    const { count, error: countError } = await countQuery
    if (countError) throw new Error(countError.message)
    totalCount = count ?? 0
  }
  const pagination = getListPagination(totalCount, input.page, input.pageSize)
  const emptyResult = {
    totalCount: pagination.totalCount,
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages: pagination.totalPages,
  }
  if (pagination.totalCount === 0) {
    return { orders: [], ...emptyResult, downloadsUnavailable: false, downloadsTruncated: false, searchTruncated }
  }

  const { data, error } = await dataQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(pagination.offset, pagination.offset + pagination.pageSize - 1)
  if (error) throw new Error(error.message)
  const rows = data ?? []
  const withdrawnMembers = await readWithdrawnMembers(rows.map((row) => row.user_id))

  // 진단에 쓰는 파일은 상품 단위로 읽는다(권한 범위가 상품 전체·구성·파일로 갈려서). 비활성·삭제된 파일도 읽어 사유를 보여 준다.
  // 권한은 다운로드 route와 같은 재료로 읽는다: 주문과 무관하게 그 회원이 그 상품에 가진 사용 가능 권한 전부.
  const [filesResult, eventsResult, memberEntitlementsResult] = await Promise.all([
    supabase
      .from('market_subproduct_files')
      .select(MARKET_FILE_COLUMNS)
      .in('item_id', Array.from(new Set(rows.map((row) => row.item_id))))
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('market_download_events')
      .select('id, order_id, subproduct_file_id, created_at')
      .in('order_id', rows.map((row) => row.id))
      .order('created_at', { ascending: false })
      .limit(DOWNLOAD_EVENT_READ_LIMIT + 1),
    supabase
      .from('market_entitlements')
      .select('id, user_id, item_id, scope, status, subproduct_id, file_id, source_order_id')
      .in('user_id', Array.from(new Set(rows.map((row) => row.user_id))))
      .in('item_id', Array.from(new Set(rows.map((row) => row.item_id))))
      .eq('status', 'active'),
  ])
  // 파일·권한을 읽지 못하면 진단이 틀리게 나오므로 목록 전체를 오류로 올린다.
  if (filesResult.error) throw new Error(filesResult.error.message)
  if (memberEntitlementsResult.error) throw new Error(memberEntitlementsResult.error.message)
  if (eventsResult.error) console.error('[admin-orders] 다운로드 기록을 읽지 못했습니다.', { message: eventsResult.error.message })
  const fileRows = filesResult.data ?? []
  const memberEntitlements = memberEntitlementsResult.data ?? []
  const eventRows = (eventsResult.data ?? []).slice(0, DOWNLOAD_EVENT_READ_LIMIT)
  const fileNameById = new Map(fileRows.map((file) => [file.id, file.original_file_name]))

  // 다운로드 route와 같은 조건: 그 권한들의 주문(v2)에 걸린 pending 환불 요청
  const entitlementOrderIds = Array.from(new Set(memberEntitlements.flatMap((entitlement) => entitlement.source_order_id ?? [])))
  const pendingRefundsResult = entitlementOrderIds.length > 0
    ? await supabase
        .from('market_refund_requests')
        .select('order_id, refund_kind, refund_subproduct_ids')
        .eq('target_kind', 'v2_order')
        .eq('status', 'pending')
        .in('order_id', entitlementOrderIds)
    : { data: [], error: null }
  if (pendingRefundsResult.error) throw new Error(pendingRefundsResult.error.message)
  const pendingRequests = pendingRefundsResult.data ?? []
  // 8번: 부분 환불 심사 중이면 대상 자료(같은 분류의 교체본 포함)만 막는다 — 다운로드 route 와 같은 규칙으로 파일마다 가른다.
  const slugBySubproductId = new Map<string, string>()
  const partialTargetIds = pendingRequests.flatMap((request) => (
    request.refund_kind === 'partial' || request.refund_kind === 'exception' ? request.refund_subproduct_ids ?? [] : []
  ))
  const slugLookupIds = partialTargetIds.length > 0 ? Array.from(new Set([...partialTargetIds, ...fileRows.map((file) => file.subproduct_id)])) : []
  if (slugLookupIds.length > 0) {
    const { data: slugRows, error: slugError } = await supabase
      .from('market_item_subproducts')
      .select('id, market_subproduct_categories(slug)')
      .in('id', slugLookupIds)
    if (slugError) throw new Error(slugError.message)
    for (const slugRow of (slugRows ?? []) as Array<{ id: string; market_subproduct_categories: { slug: string } | null }>) {
      if (slugRow.market_subproduct_categories?.slug) slugBySubproductId.set(slugRow.id, slugRow.market_subproduct_categories.slug)
    }
  }
  const pendingScopes = buildPendingMarketRefundScopes(pendingRequests, (id) => slugBySubproductId.get(id))
  const pendingRefundOrderIds = Array.from(pendingScopes.keys())
  const pendingRefundOrderIdsForFile = (file: { subproduct_id: string }) => pendingRefundOrderIds.filter((orderId) => isPendingRefundBlockingFile(
    pendingScopes.get(orderId), { subproductId: file.subproduct_id, categorySlug: slugBySubproductId.get(file.subproduct_id) ?? null }
  ))

  return {
    orders: rows.map((row) => {
      const diagnosisBase = {
        itemId: row.item_id,
        item: row.item,
        // 회원의 사용 가능 권한 전부 + (사유 구분용) 이 주문의 회수된 권한
        entitlements: [
          ...memberEntitlements.filter((entitlement) => entitlement.user_id === row.user_id && entitlement.item_id === row.item_id),
          ...row.entitlements.filter((entitlement) => entitlement.status !== 'active'),
        ],
        pendingRefundOrderIds,
      }
      const ownEntitlementReason: MarketDownloadBlockReason | null = row.entitlements.some((entitlement) => entitlement.status === 'active')
        ? null
        : row.entitlements.some((entitlement) => entitlement.status === 'refunded')
          ? 'entitlement_refunded'
          : row.entitlements.some((entitlement) => entitlement.status === 'revoked') ? 'entitlement_revoked' : 'no_entitlement'
      // 이 주문의 파일: 권한(상태 무관) 또는 구매 줄이 가리키는 범위. 권한 행이 없는 이상 상태에서도 구매 줄로 파일을 찾아 진단한다.
      const files = fileRows
        .filter((file) => file.item_id === row.item_id && (
          row.entitlements.some((entitlement) => (
            entitlement.scope === 'item' ||
            (entitlement.scope === 'subproduct' && entitlement.subproduct_id === file.subproduct_id) ||
            (entitlement.scope === 'file' && entitlement.file_id === file.id)
          )) ||
          row.lines.some((line) => line.line_type === 'bundle' || line.subproduct_id === file.subproduct_id)
        ))
        .map((file) => ({
          id: file.id,
          fileName: file.original_file_name,
          fileTypeLabel: file.file_type?.label ?? null,
          subproductTitle: file.subproduct?.title ?? null,
          removed: !file.is_active || file.deleted_at !== null,
          diagnosis: diagnoseMarketFileDownload({
            ...diagnosisBase,
            pendingRefundOrderIds: pendingRefundOrderIdsForFile(file),
            file,
            subproduct: file.subproduct,
            fileTypeExists: Boolean(file.file_type),
          }),
        }))
      const currentFiles = files.filter((file) => !file.removed)
      const blockedFile = currentFiles.find((file) => !file.diagnosis.downloadable)
      // 파일이 하나도 없을 때: 상품 쪽 사유가 먼저고, 상품이 멀쩡하면 이 주문의 권한 사유, 그것도 없으면 '파일 없음'
      const noFileReason = diagnoseMarketFileDownload({ ...diagnosisBase, file: null, subproduct: null, fileTypeExists: false }).reason
      const events = eventRows.filter((event) => event.order_id === row.id)

      return {
        id: row.id,
        userId: row.user_id,
        workspaceSubject: row.workspace_subject,
        status: row.status,
        originalPriceCredits: row.original_price_credits,
        chargedCredits: row.charged_credits,
        createdAt: row.created_at,
        user: row.user,
        memberWithdrawn: withdrawnMembers?.has(row.user_id) ?? false,
        item: row.item,
        lines: row.lines.map((line) => ({
          id: line.id,
          lineType: line.line_type,
          priceCredits: line.price_credits,
          status: line.status,
          title: line.subproduct?.title ?? line.bundle?.label ?? null,
        })),
        entitlements: row.entitlements.map((entitlement) => ({
          id: entitlement.id,
          scope: entitlement.scope,
          status: entitlement.status,
          target: entitlement.scope === 'subproduct'
            ? row.lines.find((line) => line.subproduct_id === entitlement.subproduct_id)?.subproduct?.title
              ?? fileRows.find((file) => file.subproduct_id === entitlement.subproduct_id)?.subproduct?.title
              ?? null
            : entitlement.scope === 'file'
              ? fileNameById.get(entitlement.file_id ?? '') ?? null
              : null,
        })),
        files,
        download: {
          fileCount: currentFiles.length,
          downloadableCount: currentFiles.filter((file) => file.diagnosis.downloadable).length,
          // 제공 중인 파일이 하나도 없으면 내려간 파일의 사유
          reason: currentFiles.length > 0
            ? blockedFile?.diagnosis.reason ?? null
            : files[0]?.diagnosis.reason ?? (noFileReason === 'file_missing' ? ownEntitlementReason ?? noFileReason : noFileReason),
          ownEntitlementReason,
          otherOrderIds: Array.from(new Set(currentFiles.flatMap((file) => file.diagnosis.entitlementOrderId ?? []))).filter((orderId) => orderId !== row.id),
        },
        downloads: {
          count: events.length,
          latestAt: events[0]?.created_at ?? null,
          recent: events.slice(0, DOWNLOAD_RECENT_LIMIT).map((event) => ({
            id: event.id,
            createdAt: event.created_at,
            fileName: fileNameById.get(event.subproduct_file_id ?? '') ?? null,
          })),
        },
        refunds: row.refunds.map((refund) => ({
          id: refund.id,
          status: refund.status,
          requested_refund_credits: refund.requested_refund_credits,
          approved_refund_credits: refund.approved_refund_credits,
          // 10번: 탈퇴 회원의 환불 사유·메모는 내보내지 않는다(서버 키로 읽으므로 코드가 가림).
          reason: withdrawnMembers?.has(row.user_id) === false ? refund.reason : null,
          admin_note: withdrawnMembers?.has(row.user_id) === false ? refund.admin_note : null,
          created_at: refund.created_at,
          processed_at: refund.processed_at,
        })),
      }
    }),
    ...emptyResult,
    downloadsUnavailable: Boolean(eventsResult.error),
    downloadsTruncated: (eventsResult.data ?? []).length > DOWNLOAD_EVENT_READ_LIMIT,
    searchTruncated,
  }
}
