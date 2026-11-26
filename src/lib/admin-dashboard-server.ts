import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/bypass'
import { markWithdrawnRows } from '@/lib/withdrawn-member-redaction-server'
import { createPaymentAdminClient } from '@/lib/payment-orders-server'
import { readAllQueryRows } from '@/lib/read-all-query-rows'
import { attachMemberContacts } from '@/lib/admin-member-access-log-server'
import type { AdminRequestMeta } from '@/lib/admin-request-meta'
import type { AdminAccess } from '@/lib/admin-permissions'
import { SALES_REPORT_QUERY_TIMEOUT_MS, mergeBreakdowns, sumChargeDays, type ChargeDaily } from '@/lib/sales-report'
import type { ResolvedDashboardPeriod } from '@/lib/admin-dashboard-period'
import {
  DASHBOARD_CONTENT_SETTING_KEY,
  buildProductStatus,
  canSeeRecentTab,
  dashboardPermissions,
  firstRecentTab,
  isDashboardRecentTab,
  parseDashboardContent,
  pickDashboardFields,
  type ActivityDay,
  type ActivityTotals,
  type DashboardContent,
  type DashboardRankRow,
  type DashboardRecentTab,
  type MarketDayRow,
  type ProductStatus,
  type ProductStatusRow,
} from '@/lib/admin-dashboard-fields'

// 21번 묶음(계획 docs/plan-bundle21-dashboard.md 4·6절): 대시보드 숫자와 최근 목록. 조회만 한다.
// 구역마다 권한을 보고, 권한 없는 구역의 함수는 부르지 않는다(report_charge_daily 는 reports.view 만 — 충전 쪽 예외가 다른 카드에 번지지 않음).
// 구역·앞 기간마다 따로 실패한다(앞 기간만 실패하면 큰 값은 두고 증감만 '확인 불가'). DB 함수가 아직 없으면(묶음 미적용) 그 구역만 실패로 둔다.
// 여러 권한이 섞인 함수의 행은 pickDashboardFields 를 거쳐서만 응답에 싣는다. 테스트 환경 결제는 23번 정의대로 세지 않는다.

const db = () => createAdminClient() as unknown as SupabaseClient
const RANKING_LIMIT = 5
const RECENT_LIMIT = 5

// null = 권한이 없어 읽지 않음, failed = 읽지 못함("없음"과 구분)
export type DashboardSection<T> = { failed: false; data: T } | { failed: true } | null

export interface ChargeTotalsView {
  paymentCount: number
  paymentAmount: number
  paymentVat: number
  refundCount: number
  refundAmount: number
  refundVat: number
  // 순 충전 매출 = 결제 − 환불(부가세 포함, 23번 3-1)
  net: number
}
export interface ChargeSectionData {
  current: ChargeTotalsView
  // null = 앞 기간을 읽지 못함(증감만 확인 불가)
  previous: ChargeTotalsView | null
  days: Array<{ day: string; paymentAmount: number; refundAmount: number; net: number }>
  byPlan: Array<{ label: string; count: number; amount: number }>
}
export interface MarketSectionData { days: MarketDayRow[]; previous: MarketDayRow[] | null }
export interface ActivitySectionData { days: ActivityDay[]; totals: ActivityTotals; previousTotals: ActivityTotals | null }

export interface AdminDashboardData {
  generatedAt: string
  charge: DashboardSection<ChargeSectionData>
  market: DashboardSection<MarketSectionData>
  activity: DashboardSection<ActivitySectionData>
  orderRanking: DashboardSection<DashboardRankRow[]>
  downloadRanking: DashboardSection<DashboardRankRow[]>
  // undefined = 이번 요청에서 읽지 않음(기간만 바꿈 — 화면은 가진 값을 그대로 둔다)
  products?: DashboardSection<ProductStatus>
}

const FAILED = Symbol('failed')
type Settled<T> = T | typeof FAILED

// DB 함수가 아직 없음(묶음 미적용: PostgREST PGRST202 / Postgres 42883)과 그 밖 오류(시간 초과·권한·잘못된 기간 등)를 로그에서 가른다.
// 화면은 둘 다 '확인 불가'로 그린다(11절 운영 확인 때 로그로 구분).
class DashboardFunctionMissingError extends Error {}
const FUNCTION_MISSING_CODES = new Set(['PGRST202', '42883'])

async function settle<T>(name: string, read: () => Promise<T>): Promise<Settled<T>> {
  try {
    return await read()
  } catch (error) {
    if (error instanceof DashboardFunctionMissingError) {
      console.error('[admin-dashboard] DB 함수가 없습니다(묶음 미적용). 구역을 확인 불가로 둡니다.', { section: name, kind: 'function_missing', message: error.message })
    } else {
      console.error('[admin-dashboard] 구역을 읽지 못했습니다.', { section: name, kind: 'query_failed', message: error instanceof Error ? error.message : String(error) })
    }
    return FAILED
  }
}

async function callReport<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().rpc(name, args).abortSignal(AbortSignal.timeout(SALES_REPORT_QUERY_TIMEOUT_MS))
  if (error) {
    // 완료 환불에 금액이 빈 행(23번 REFUND_AMOUNT_MISSING)·함수 없음(묶음 미적용) 등. 그 구역만 '확인 불가'.
    const message = `${name}: ${error.code ?? ''} ${error.message ?? ''}`.trim()
    throw FUNCTION_MISSING_CODES.has(error.code ?? '') ? new DashboardFunctionMissingError(message) : new Error(message)
  }
  return data as T
}

function chargeView(charge: ChargeDaily): ChargeTotalsView {
  const totals = sumChargeDays(charge.days)
  return {
    paymentCount: totals.paymentCount,
    paymentAmount: totals.paymentAmount,
    paymentVat: totals.paymentVat,
    refundCount: totals.refundCount,
    refundAmount: totals.refundAmount,
    refundVat: totals.refundVat,
    net: totals.paymentAmount - totals.refundAmount,
  }
}

interface RankingRpcRow {
  item_id: string
  title: string | null
  workspace_subject: string
  item_status: string
  is_active: boolean | null
  is_deleted: boolean
  order_count: number
  charged_credits: number
  download_users: number
  download_count: number
}

const toRankRow = (row: RankingRpcRow): DashboardRankRow => ({
  itemId: row.item_id,
  title: row.title ?? '',
  subject: row.workspace_subject,
  status: row.item_status,
  isActive: row.is_active === true,
  isDeleted: row.is_deleted === true,
  orderCount: row.order_count,
  chargedCredits: row.charged_credits,
  downloadUsers: row.download_users,
  downloadCount: row.download_count,
})

const pickAll = <Row>(rows: readonly Row[], pick: (row: Row) => Row | null) => rows.map(pick).filter((row): row is Row => row !== null)

async function readProductStatus(): Promise<ProductStatus> {
  const rows = await readAllQueryRows((from, to) => createAdminClient()
    .from('market_items')
    .select('id, title, workspace_subject, status, is_active, deleted_at, draft_source, updated_at')
    .is('deleted_at', null)
    .order('id')
    .range(from, to))
  return buildProductStatus(rows as ProductStatusRow[])
}

// 관리자 확인을 마친 요청에서만 부른다(service role 로 읽는다). 서버 안의 구역 호출은 함께 보낸다.
export async function getAdminDashboard(
  access: AdminAccess,
  period: ResolvedDashboardPeriod,
  options: { includeProducts: boolean }
): Promise<AdminDashboardData> {
  const can = dashboardPermissions(access)
  const subject = period.query.subject === 'all' ? null : period.query.subject
  const current = { p_from: period.current.from, p_to: period.current.to }
  const compare = { p_from: period.compare.from, p_to: period.compare.to }
  const skip = Promise.resolve(null)
  const seesActivity = can.orders || can.members

  const [chargeNow, chargeBefore, marketNow, marketBefore, activityNow, activityBefore, orderRanking, downloadRanking, products] = await Promise.all([
    can.money ? settle('충전', () => callReport<ChargeDaily>('report_charge_daily', current)) : skip,
    can.money ? settle('충전(앞 기간)', () => callReport<ChargeDaily>('report_charge_daily', compare)) : skip,
    can.orders ? settle('자료 판매', () => callReport<MarketDayRow[]>('report_market_daily', { ...current, p_subject: subject })) : skip,
    can.orders ? settle('자료 판매(앞 기간)', () => callReport<MarketDayRow[]>('report_market_daily', { ...compare, p_subject: subject })) : skip,
    seesActivity ? settle('활동', () => callReport<{ days: ActivityDay[]; totals: ActivityTotals }>('report_activity_daily', { ...current, p_subject: subject })) : skip,
    seesActivity ? settle('활동(앞 기간)', () => callReport<{ days: ActivityDay[]; totals: ActivityTotals }>('report_activity_daily', { ...compare, p_subject: subject })) : skip,
    can.orders ? settle('판매 순위', () => callReport<RankingRpcRow[]>('report_market_item_ranking', { ...current, p_subject: subject, p_metric: 'orders', p_limit: RANKING_LIMIT })) : skip,
    can.orders ? settle('다운로드 순위', () => callReport<RankingRpcRow[]>('report_market_item_ranking', { ...current, p_subject: subject, p_metric: 'downloads', p_limit: RANKING_LIMIT })) : skip,
    can.products && options.includeProducts ? settle('상품 현황', readProductStatus) : skip,
  ])

  const section = <T, Out>(allowed: boolean, value: Settled<T> | null, build: (value: T) => Out): DashboardSection<Out> => {
    if (!allowed) return null
    if (value === FAILED || value === null) return { failed: true }
    return { failed: false, data: build(value) }
  }
  const pickMarket = (rows: MarketDayRow[]) => pickAll(rows ?? [], (row) => pickDashboardFields(access, 'market', row))

  return {
    generatedAt: new Date().toISOString(),
    charge: section(can.money, chargeNow, (charge) => ({
      current: chargeView(charge),
      previous: chargeBefore === FAILED || chargeBefore === null ? null : chargeView(chargeBefore),
      days: charge.days.map((day) => ({ day: day.day, paymentAmount: day.paymentAmount, refundAmount: day.refundAmount, net: day.paymentAmount - day.refundAmount })),
      byPlan: mergeBreakdowns(charge.days, 'byPlan').map((plan) => ({ label: plan.label, count: plan.count, amount: plan.amount })),
    })),
    market: section(can.orders, marketNow, (rows) => ({
      days: pickMarket(rows),
      previous: marketBefore === FAILED || marketBefore === null ? null : pickMarket(marketBefore),
    })),
    activity: section(seesActivity, activityNow, (value) => ({
      days: pickAll(value.days ?? [], (row) => pickDashboardFields(access, 'activityDay', row)),
      totals: pickDashboardFields(access, 'activityTotals', value.totals ?? {}) ?? {},
      previousTotals: activityBefore === FAILED || activityBefore === null ? null : pickDashboardFields(access, 'activityTotals', activityBefore.totals ?? {}),
    })),
    orderRanking: section(can.orders, orderRanking, (rows) => pickAll(rows.map(toRankRow), (row) => pickDashboardFields(access, 'orderRanking', row))),
    downloadRanking: section(can.orders, downloadRanking, (rows) => pickAll(rows.map(toRankRow), (row) => pickDashboardFields(access, 'downloadRanking', row))),
    ...(options.includeProducts ? { products: section(can.products, products, (value) => value) } : {}),
  }
}

// 정의 말풍선·빈 상태 문구(6절). 읽지 못하면 null(말풍선을 숨기고 빈 상태는 숫자만).
export async function readDashboardContent(): Promise<DashboardContent | null> {
  try {
    const { data, error } = await db().from('system_settings').select('value').eq('key', DASHBOARD_CONTENT_SETTING_KEY).maybeSingle()
    if (error) throw new Error(error.code ?? 'SETTINGS_READ_FAILED')
    return parseDashboardContent((data as { value: unknown } | null)?.value)
  } catch (error) {
    console.error('[admin-dashboard] 문구를 읽지 못했습니다.', error instanceof Error ? error.message : String(error))
    return null
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 최근 목록(6절 '최근 목록은 기간과 따로'). 탭 하나 = 요청 하나 = 열람 기록 1행(screen 'dashboard', 이메일만).
// 탭 이름·권한 규칙은 admin-dashboard-fields.ts(화면도 같이 씀).
// ---------------------------------------------------------------------------------------------------------------
export { canSeeRecentTab, firstRecentTab, isDashboardRecentTab }

export interface RecentMarketRow {
  id: string
  user_id: string
  subject: string
  purchase_type: string
  charged_credits: number
  status: string
  created_at: string
  title: string
  email: string | null
}
export interface RecentChargeRow {
  id: string
  order_id: string
  user_id: string
  status: string
  plan_name_snapshot: string
  expected_amount: number
  created_at: string
  email: string | null
}
export interface RecentSupportRow {
  id: string
  subject: string
  status: string
  created_at: string
  user_id: string
  memberWithdrawn: boolean
  email: string | null
}
export type DashboardRecent =
  | { tab: 'market'; failed: false; rows: RecentMarketRow[] }
  | { tab: 'charge'; failed: false; rows: RecentChargeRow[] }
  | { tab: 'support'; failed: false; rows: RecentSupportRow[] }
  | { tab: DashboardRecentTab; failed: true }

function withEmail<Row extends { user_id: string }>(access: AdminAccess, tab: DashboardRecentTab, rows: Row[], requestMeta?: AdminRequestMeta) {
  // 13번 attachMemberContacts: 연락처를 서버 키로 붙이면서 열람 기록을 남긴다. 기록이 실패하면 이메일을 가린다(Q4 가).
  return attachMemberContacts({
    access,
    screen: 'dashboard',
    rows,
    userIdOf: (row) => row.user_id,
    fields: ['email'],
    context: { tab },
    requestMeta,
    shape: (row, contact) => ({ ...row, email: contact?.email ?? null }),
  })
}

async function readRecentMarket(): Promise<Omit<RecentMarketRow, 'email'>[]> {
  const { data, error } = await createAdminClient()
    .from('market_purchase_orders')
    .select('id, user_id, workspace_subject, purchase_type, charged_credits, status, created_at, item:market_items!market_purchase_orders_item_workspace_fkey(title)')
    .in('status', ['completed', 'refunded', 'revoked'])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  return ((data ?? []) as unknown as Array<{ id: string; user_id: string; workspace_subject: string; purchase_type: string; charged_credits: number; status: string; created_at: string; item: { title: string | null } | null }>)
    .map((row) => ({
      id: row.id,
      user_id: row.user_id,
      subject: row.workspace_subject,
      purchase_type: row.purchase_type,
      charged_credits: row.charged_credits,
      status: row.status,
      created_at: row.created_at,
      title: row.item?.title ?? '',
    }))
}

async function readRecentCharge(): Promise<Omit<RecentChargeRow, 'email'>[]> {
  const { data, error } = await createPaymentAdminClient()
    .from('payment_orders')
    .select('id, order_id, user_id, status, plan_name_snapshot, expected_amount, created_at')
    .eq('provider_environment', 'live')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  return data ?? []
}

// 답변 대기 문의: 오래된 순(대기 시간). 제목·상태·시각만 읽는다(본문은 문의 관리 화면에서). 회원이 삭제한 문의는 뺀다.
async function readPendingSupport(): Promise<Omit<RecentSupportRow, 'email'>[]> {
  const { data, error } = await createAdminClient()
    .from('support_tickets')
    .select('id, subject, status, created_at, user_id')
    .eq('status', 'pending')
    .eq('is_deleted_by_user', false)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(RECENT_LIMIT)
  if (error) throw new Error(error.message)
  // 10번: 탈퇴 회원 문의는 제목을 '탈퇴 회원 문의'(DB 문구)로 바꿔 보낸다.
  return markWithdrawnRows(data ?? [], (ticket) => ticket.user_id, (ticket, title) => ({ ...ticket, subject: title }))
}

// 권한 확인(canSeeRecentTab)은 부르는 쪽이 한다.
export async function getDashboardRecent(access: AdminAccess, tab: DashboardRecentTab, requestMeta?: AdminRequestMeta): Promise<DashboardRecent> {
  try {
    if (tab === 'market') return { tab, failed: false, rows: (await withEmail(access, tab, await readRecentMarket(), requestMeta)).rows }
    if (tab === 'charge') return { tab, failed: false, rows: (await withEmail(access, tab, await readRecentCharge(), requestMeta)).rows }
    return { tab, failed: false, rows: (await withEmail(access, tab, await readPendingSupport(), requestMeta)).rows }
  } catch (error) {
    console.error('[admin-dashboard] 최근 목록을 읽지 못했습니다.', { tab, message: error instanceof Error ? error.message : String(error) })
    return { tab, failed: true }
  }
}
