// 21번 묶음(계획 docs/plan-bundle21-dashboard.md 4-1·4-3절): 대시보드 응답 모양, 권한별 허용 필드, 합계, 문구 행 해석.
// 순수 함수만 둔다(서버·화면·시험이 같이 쓴다).
// 여러 권한 값이 섞인 DB 함수(report_market_daily·report_activity_daily·report_market_item_ranking)의 행은
// pickDashboardFields 한 곳에서 허용 필드만 남긴 뒤 응답에 싣는다. orders.view 만 있으면 jsonb 안쪽의 c(크레딧)까지 지운다.
import { hasAdminPermission, type AdminAccess } from '@/lib/admin-permissions'

// ---------------------------------------------------------------------------------------------------------------
// 권한(4-1 표)
// ---------------------------------------------------------------------------------------------------------------
export interface DashboardPermissions {
  // 순 충전 매출·충전 그래프·요금제별 탭, 자료 판매 C·도넛·순위 C 열(Q1·Q2 기본안: reports.view — orders.view 함께 필요)
  money: boolean
  // 자료 판매 건수·건수 추이·다운로드·순위(건수)·최근 자료 구매·최근 충전 주문
  orders: boolean
  // 신규 가입
  members: boolean
  // 상품 현황·[상품 등록]·상품 이동 링크
  products: boolean
  // 답변 대기 문의
  support: boolean
  // 대표(충전 판매 중지 버튼)
  owner: boolean
}

export function dashboardPermissions(access: AdminAccess | null): DashboardPermissions {
  return {
    money: hasAdminPermission(access, 'reports.view'),
    orders: hasAdminPermission(access, 'orders.view'),
    members: hasAdminPermission(access, 'members.view'),
    products: hasAdminPermission(access, 'products.edit'),
    support: hasAdminPermission(access, 'support.manage'),
    owner: hasAdminPermission(access, 'owner'),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 최근 목록 탭(6절): 자료 구매·충전 주문 = orders.view, 답변 대기 문의 = support.manage
// ---------------------------------------------------------------------------------------------------------------
export const DASHBOARD_RECENT_TABS = ['market', 'charge', 'support'] as const
export type DashboardRecentTab = (typeof DASHBOARD_RECENT_TABS)[number]
export const DASHBOARD_RECENT_TAB_LABELS: Record<DashboardRecentTab, string> = {
  market: '최근 자료 구매',
  charge: '최근 충전 주문',
  support: '답변 대기 문의',
}

export function isDashboardRecentTab(value: unknown): value is DashboardRecentTab {
  return typeof value === 'string' && (DASHBOARD_RECENT_TABS as readonly string[]).includes(value)
}

export function canSeeRecentTab(can: DashboardPermissions, tab: DashboardRecentTab): boolean {
  return tab === 'support' ? can.support : can.orders
}

// 첫 탭: orders.view 면 '최근 자료 구매', 아니면 support.manage 면 '답변 대기 문의'(3판)
export function firstRecentTab(can: DashboardPermissions): DashboardRecentTab | null {
  return can.orders ? 'market' : can.support ? 'support' : null
}

// ---------------------------------------------------------------------------------------------------------------
// DB 함수 행 모양(마이그레이션 20261223100000 5절)
// ---------------------------------------------------------------------------------------------------------------
export const DASHBOARD_SUBJECT_CODES = ['korean', 'english'] as const
export type DashboardSubjectCode = (typeof DASHBOARD_SUBJECT_CODES)[number]
// 구매 방식 키. legacy = legacy_backfill(이전 방식, 지금 0건이라 있을 때만 온다)
export const DASHBOARD_PURCHASE_KINDS = ['subproduct', 'bundle', 'legacy'] as const

export interface MarketCell { n: number; c?: number }
export interface MarketDayRow {
  day: string
  purchases: Record<string, Record<string, MarketCell>>
  refunds: Record<string, MarketCell>
}
export interface ActivityDay { day: string; signups?: number; downloads?: number; downloadUsers?: number }
export interface ActivityTotals { signups?: number; downloads?: number; downloadUsers?: number }
export interface DashboardRankRow {
  itemId: string
  title: string
  subject: string
  status: string
  isActive: boolean
  isDeleted: boolean
  orderCount?: number
  chargedCredits?: number
  downloadUsers?: number
  downloadCount?: number
}

export type DashboardFieldSection = 'market' | 'activityDay' | 'activityTotals' | 'orderRanking' | 'downloadRanking'
type SectionRow = {
  market: MarketDayRow
  activityDay: ActivityDay
  activityTotals: ActivityTotals
  orderRanking: DashboardRankRow
  downloadRanking: DashboardRankRow
}

const toNumber = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function pickCell(cell: unknown, withCredits: boolean): MarketCell {
  const source = (cell ?? {}) as { n?: unknown; c?: unknown }
  return withCredits ? { n: toNumber(source.n), c: toNumber(source.c) } : { n: toNumber(source.n) }
}

// 권한별 허용 필드만 남긴 새 행. 그 구역을 볼 권한이 없으면 null(응답에 싣지 않음).
export function pickDashboardFields<Section extends DashboardFieldSection>(
  access: AdminAccess | null,
  section: Section,
  row: SectionRow[Section]
): SectionRow[Section] | null {
  const can = dashboardPermissions(access)
  switch (section) {
    case 'market': {
      if (!can.orders) return null
      const source = row as MarketDayRow
      const purchases: MarketDayRow['purchases'] = {}
      for (const [subject, kinds] of Object.entries(source.purchases ?? {})) {
        purchases[subject] = {}
        for (const [kind, cell] of Object.entries(kinds ?? {})) purchases[subject][kind] = pickCell(cell, can.money)
      }
      const refunds: MarketDayRow['refunds'] = {}
      for (const [subject, cell] of Object.entries(source.refunds ?? {})) refunds[subject] = pickCell(cell, can.money)
      return { day: String(source.day), purchases, refunds } as SectionRow[Section]
    }
    case 'activityDay':
    case 'activityTotals': {
      if (!can.orders && !can.members) return null
      const source = row as ActivityDay
      const picked: ActivityDay = section === 'activityDay' ? { day: String(source.day) } : ({} as ActivityDay)
      if (can.members) picked.signups = toNumber(source.signups)
      if (can.orders) {
        picked.downloads = toNumber(source.downloads)
        picked.downloadUsers = toNumber(source.downloadUsers)
      }
      return picked as SectionRow[Section]
    }
    case 'orderRanking':
    case 'downloadRanking': {
      if (!can.orders) return null
      const source = row as DashboardRankRow
      const picked: DashboardRankRow = {
        itemId: String(source.itemId),
        title: String(source.title ?? ''),
        subject: String(source.subject ?? ''),
        status: String(source.status ?? ''),
        isActive: source.isActive === true,
        isDeleted: source.isDeleted === true,
      }
      if (section === 'orderRanking') {
        picked.orderCount = toNumber(source.orderCount)
        if (can.money) picked.chargedCredits = toNumber(source.chargedCredits)
      } else {
        picked.downloadUsers = toNumber(source.downloadUsers)
        picked.downloadCount = toNumber(source.downloadCount)
      }
      return picked as SectionRow[Section]
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// 합계(Q6·4-3)
// ---------------------------------------------------------------------------------------------------------------
export interface MarketSlice { subject: string; kind: string; n: number; c: number | null }
export interface MarketSummary {
  purchaseCount: number
  refundCount: number
  // C 가 없는 응답(orders.view 만)이면 null
  purchaseCredits: number | null
  refundCredits: number | null
  // 카드 큰 값(reports.view): 구매 C − 자료 환불 C = 순 사용 C
  netCredits: number | null
  // 도넛(과목 × 구매 방식 C)
  slices: MarketSlice[]
}

export function summarizeMarket(rows: readonly MarketDayRow[]): MarketSummary {
  let purchaseCount = 0
  let refundCount = 0
  let purchaseCredits = 0
  let refundCredits = 0
  let hasCredits = true
  const slices = new Map<string, MarketSlice>()
  for (const row of rows) {
    for (const [subject, kinds] of Object.entries(row.purchases ?? {})) {
      for (const [kind, cell] of Object.entries(kinds ?? {})) {
        purchaseCount += cell.n
        if (cell.c === undefined) hasCredits = false
        else purchaseCredits += cell.c
        const key = `${subject}:${kind}`
        const slice = slices.get(key) ?? { subject, kind, n: 0, c: 0 }
        slice.n += cell.n
        slice.c = cell.c === undefined || slice.c === null ? null : slice.c + cell.c
        slices.set(key, slice)
      }
    }
    for (const cell of Object.values(row.refunds ?? {})) {
      refundCount += cell.n
      if (cell.c === undefined) hasCredits = false
      else refundCredits += cell.c
    }
  }
  return {
    purchaseCount,
    refundCount,
    purchaseCredits: hasCredits ? purchaseCredits : null,
    refundCredits: hasCredits ? refundCredits : null,
    netCredits: hasCredits ? purchaseCredits - refundCredits : null,
    slices: [...slices.values()],
  }
}

// 날짜별 값(그래프). credits: 순 사용 C, 아니면 구매 건수.
export function marketDayValue(row: MarketDayRow, metric: 'credits' | 'count'): number {
  let value = 0
  for (const kinds of Object.values(row.purchases ?? {})) {
    for (const cell of Object.values(kinds ?? {})) value += metric === 'credits' ? cell.c ?? 0 : cell.n
  }
  if (metric === 'credits') for (const cell of Object.values(row.refunds ?? {})) value -= cell.c ?? 0
  return value
}

// ---------------------------------------------------------------------------------------------------------------
// 상품 상태(4-3 상품 현황·순위 배지). 회원 화면 '공개' = published AND is_active AND 삭제 안 됨.
// ---------------------------------------------------------------------------------------------------------------
export type DashboardItemState = 'published' | 'hidden' | 'archived' | 'draft' | 'deleted'
export const DASHBOARD_ITEM_STATE_LABELS: Record<DashboardItemState, string> = {
  published: '공개',
  hidden: '숨김',
  archived: '보관',
  draft: '임시저장',
  deleted: '삭제됨',
}

export function dashboardItemState(item: { status: string | null; isActive: boolean | null; isDeleted: boolean }): DashboardItemState | null {
  if (item.isDeleted) return 'deleted'
  if (item.status === 'published') return item.isActive ? 'published' : 'hidden'
  if (item.status === 'hidden' || item.status === 'archived' || item.status === 'draft') return item.status
  return null
}

export interface ProductStatusCounts { published: number; hidden: number; archived: number; draft: number }
export interface ProductRecentItem { id: string; title: string; subject: string; state: DashboardItemState; updatedAt: string }
export interface ProductStatus {
  counts: Record<DashboardSubjectCode, ProductStatusCounts>
  recent: Record<'all' | DashboardSubjectCode, ProductRecentItem[]>
}
export const PRODUCT_RECENT_LIMIT = 3

export interface ProductStatusRow {
  id: string
  title: string | null
  workspace_subject: string
  status: string
  is_active: boolean | null
  deleted_at: string | null
  draft_source: string | null
  updated_at: string
}

// 공개 = 회원 화면 조건, 숨김 = hidden + published 이지만 is_active=false, 보관 = archived,
// 임시저장(= 게시 대기) = draft 중 자동 업로드 임시 상품(draft_source='auto_upload')이 아닌 것. 삭제 상품 제외.
export function buildProductStatus(rows: readonly ProductStatusRow[]): ProductStatus {
  const empty = (): ProductStatusCounts => ({ published: 0, hidden: 0, archived: 0, draft: 0 })
  const counts: ProductStatus['counts'] = { korean: empty(), english: empty() }
  const listed: ProductRecentItem[] = []
  for (const row of rows) {
    if (row.deleted_at) continue
    if (row.status === 'draft' && row.draft_source === 'auto_upload') continue
    const state = dashboardItemState({ status: row.status, isActive: row.is_active, isDeleted: false })
    if (!state || state === 'deleted') continue
    const subject = row.workspace_subject as DashboardSubjectCode
    if (counts[subject]) counts[subject][state] += 1
    listed.push({ id: row.id, title: row.title ?? '', subject: row.workspace_subject, state, updatedAt: row.updated_at })
  }
  listed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  return {
    counts,
    recent: {
      all: listed.slice(0, PRODUCT_RECENT_LIMIT),
      korean: listed.filter((item) => item.subject === 'korean').slice(0, PRODUCT_RECENT_LIMIT),
      english: listed.filter((item) => item.subject === 'english').slice(0, PRODUCT_RECENT_LIMIT),
    },
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 문구 행(6절 '문구'): system_settings.admin_dashboard_content. 키마다 따로 읽는다(틀린 키만 빠짐).
// 행을 읽지 못하면 null — 화면은 말풍선을 숨기고 빈 상태에 숫자만 보인다.
// ---------------------------------------------------------------------------------------------------------------
export const DASHBOARD_CONTENT_SETTING_KEY = 'admin_dashboard_content'
export const DASHBOARD_CONTENT_KEYS = [
  'helpCharge', 'helpMarket', 'helpSignups', 'helpDownloads',
  'emptyChargeChart', 'emptyMarketChart', 'emptySignupsChart', 'emptyDownloadsChart', 'emptyDonut',
  'emptyOrdersRanking', 'emptyDownloadsRanking', 'publishedCount',
] as const
export type DashboardContentKey = (typeof DASHBOARD_CONTENT_KEYS)[number]
export type DashboardContent = Partial<Record<DashboardContentKey, string>>
const CONTENT_MAX_LENGTH = 300
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

export function parseDashboardContent(value: unknown): DashboardContent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const content: DashboardContent = {}
  for (const key of DASHBOARD_CONTENT_KEYS) {
    const text = typeof source[key] === 'string' ? (source[key] as string).trim() : ''
    if (text && text.length <= CONTENT_MAX_LENGTH && !CONTROL_CHARACTERS.test(text)) content[key] = text
  }
  return content
}

// 추이 그래프 Y축 범위(7절 '기준 축 하나'): 늘 0 을 포함한다(막대 길이가 값에 비례하고 0 기준선이 보임).
// 음수 날(순 충전 매출에서 환불이 더 많은 날)은 0 아래로 그대로 보인다. 모두 0 이면 [0, 1].
export function trendYDomain(values: readonly number[]): [number, number] {
  const finite = values.filter((value) => Number.isFinite(value))
  const low = Math.min(0, ...finite)
  const high = Math.max(0, ...finite)
  return low === 0 && high === 0 ? [0, 1] : [low, high]
}

// '공개 상품 {count}개' 의 {count} 바꾸기
export function fillCount(template: string, count: string): string {
  return template.replaceAll('{count}', count)
}
