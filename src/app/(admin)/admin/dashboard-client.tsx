'use client'

import { useRef, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAdminAlerts } from '@/components/admin/admin-alert-context'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminMetricCard, AdminMetricGrid } from '@/components/admin/kit/admin-metric-card'
import { AdminNotice } from '@/components/admin/kit/admin-notice'
import { AdminDataTable, type AdminDataTableColumn } from '@/components/admin/kit/admin-data-table'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
import { AdminStatusBadge } from '@/components/admin/kit/admin-status-badge'
import { dispatchStatusMessages, visibleWorkItems } from '@/lib/admin-alerts'
import {
  ADMIN_UNAVAILABLE,
  formatCount,
  formatCredits,
  formatDelta,
  formatKstShort,
  formatKstTime,
  formatWon,
  type AdminNumberValue,
} from '@/lib/admin-format'
import { adminStatusTone } from '@/lib/admin-status-tone'
import { MARKET_ORDER_STATUS_LABELS, PAYMENT_ORDER_STATUS_LABELS, labelOf } from '@/lib/admin-orders'
import { PURCHASE_TYPE_LABELS, SUBJECT_LABELS } from '@/lib/sales-report'
import {
  DASHBOARD_PERIOD_LABELS,
  DASHBOARD_PERIOD_PRESETS,
  DASHBOARD_SUBJECTS,
  DASHBOARD_SUBJECT_LABELS,
  DASHBOARD_WEEKLY_AFTER_DAYS,
  bucketByWeek,
  dashboardQueryString,
  formatCompareLabel,
  type DashboardPreset,
  type DashboardQuery,
  type DashboardSubject,
  type ResolvedDashboardPeriod,
} from '@/lib/admin-dashboard-period'
import {
  DASHBOARD_ITEM_STATE_LABELS,
  DASHBOARD_RECENT_TABS,
  DASHBOARD_RECENT_TAB_LABELS,
  canSeeRecentTab,
  dashboardItemState,
  fillCount,
  marketDayValue,
  summarizeMarket,
  type DashboardContent,
  type DashboardPermissions,
  type DashboardRankRow,
  type DashboardRecentTab,
  type ProductStatus,
} from '@/lib/admin-dashboard-fields'
import type {
  ActivitySectionData,
  AdminDashboardData,
  ChargeSectionData,
  DashboardRecent,
  DashboardSection,
  MarketSectionData,
} from '@/lib/admin-dashboard-server'
import type { AdminWorkSummary } from '@/lib/admin-work-summary-server'
import { cn } from '@/lib/utils'
import type { DonutSlice, TrendPoint } from './dashboard-charts'

// 그래프는 대시보드에서만 늦게 불러온다(Q4). 자리는 고정 높이 뼈대로 먼저 잡는다(7절).
const DashboardTrendChart = dynamic(() => import('./dashboard-charts').then((module) => module.DashboardTrendChart), {
  ssr: false,
  loading: () => <ChartPlaceholder height={280} />,
})
const DashboardDonutChart = dynamic(() => import('./dashboard-charts').then((module) => module.DashboardDonutChart), {
  ssr: false,
  loading: () => <ChartPlaceholder height={240} />,
})

export interface DashboardInitial {
  period: ResolvedDashboardPeriod
  // null = 권한을 읽지 못함
  dashboard: AdminDashboardData | null
  work: AdminWorkSummary
  recent: DashboardRecent | null
}

type CardKey = 'charge' | 'market' | 'signups' | 'downloads'
type DonutTab = 'subjectKind' | 'plan'
type RankingTab = 'orders' | 'downloads'
type RecentState = DashboardRecent | { tab: DashboardRecentTab; loading: true }

// 도넛 조각 색(회원 화면 토큰·20번 tone). 이름·값은 범례 글로 함께 적는다.
const SLICE_COLORS = [
  'var(--studio-primary)',
  'var(--admin-tone-info-text)',
  'var(--admin-tone-success-text)',
  'var(--admin-tone-warning-text)',
  'var(--studio-highlight)',
  'var(--admin-tone-neutral-text)',
]

const sum = (values: Array<number | undefined>) => values.reduce<number>((total, value) => total + (value ?? 0), 0)
const kindLabel = (kind: string) => (kind === 'legacy' ? PURCHASE_TYPE_LABELS.legacy_backfill : PURCHASE_TYPE_LABELS[kind] ?? kind)
const subjectLabel = (subject: string) => SUBJECT_LABELS[subject] ?? subject

function sectionData<T>(section: DashboardSection<T> | undefined): T | null {
  return section && !section.failed ? section.data : null
}

// 단위가 있는 증감 계산용: 큰 값이 없으면 '확인 불가', 앞 기간만 없으면 증감만 '확인 불가'
const valueOrUnavailable = (value: number | null | undefined): AdminNumberValue => (value === null || value === undefined ? ADMIN_UNAVAILABLE : value)

export function DashboardClient({
  title,
  permissions,
  content,
  initial,
  salesAttention,
  salesPanel,
}: {
  title: ReactNode
  permissions: DashboardPermissions
  content: DashboardContent | null
  initial: DashboardInitial
  // 판매 중지(또는 상태를 못 읽음)면 상태 바를 빨간 테두리로
  salesAttention: boolean
  salesPanel: ReactNode
}) {
  const alerts = useAdminAlerts()
  const [period, setPeriod] = useState(initial.period)
  const [dashboard, setDashboard] = useState(initial.dashboard)
  const [products, setProducts] = useState<DashboardSection<ProductStatus> | undefined>(initial.dashboard?.products)
  const [workFallback, setWorkFallback] = useState(initial.work)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [customFrom, setCustomFrom] = useState(initial.period.current.fromDate)
  const [customTo, setCustomTo] = useState(initial.period.current.toDate)
  const [customOpen, setCustomOpen] = useState(initial.period.query.period === 'custom')
  const [selectedCard, setSelectedCard] = useState<CardKey | null>(null)
  const [showTable, setShowTable] = useState(false)
  const [donutTab, setDonutTab] = useState<DonutTab>('subjectKind')
  const [rankingTab, setRankingTab] = useState<RankingTab>('orders')
  const requestRef = useRef<AbortController | null>(null)
  const sequenceRef = useRef(0)

  const recentTabs = DASHBOARD_RECENT_TABS.filter((tab) => canSeeRecentTab(permissions, tab))
  const [recentTab, setRecentTab] = useState<DashboardRecentTab | null>(initial.recent?.tab ?? recentTabs[0] ?? null)
  // 한 번 읽은 탭은 [새로고침] 전까지 다시 읽지 않는다(열람 기록도 다시 남기지 않음).
  const [recentByTab, setRecentByTab] = useState<Partial<Record<DashboardRecentTab, RecentState>>>(
    initial.recent ? { [initial.recent.tab]: initial.recent } : {}
  )
  // 최근 목록의 '대기 n시간' 기준 시각(서버가 읽은 시각 — 처음 그릴 때 서버·브라우저 글이 같게)
  const [recentLoadedAt, setRecentLoadedAt] = useState<Partial<Record<DashboardRecentTab, string>>>(
    initial.recent ? { [initial.recent.tab]: initial.dashboard?.generatedAt ?? initial.period.current.to } : {}
  )

  // 기간·과목을 바꿀 때: /api/admin/stats 만 부른다. 앞 요청은 끊고 마지막 요청의 응답만 반영한다.
  const loadDashboard = async (query: DashboardQuery, withProducts: boolean) => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const sequence = ++sequenceRef.current
    setLoading(true)
    try {
      const response = await fetch(`/api/admin/stats?${dashboardQueryString(query)}${withProducts ? '&products=1' : ''}`, {
        signal: controller.signal,
        cache: 'no-store',
      })
      const data = (await response.json().catch(() => null)) as { period: ResolvedDashboardPeriod; work: AdminWorkSummary; dashboard: AdminDashboardData | null } | null
      if (sequence !== sequenceRef.current) return
      if (!response.ok || !data) throw new Error('STATS_FAILED')
      setPeriod(data.period)
      setWorkFallback(data.work)
      setDashboard(data.dashboard)
      if (data.dashboard && data.dashboard.products !== undefined) setProducts(data.dashboard.products)
      setLoadError(null)
    } catch {
      if (sequence !== sequenceRef.current) return
      setLoadError('숫자를 새로 읽지 못했습니다. 보이는 숫자는 앞서 읽은 값입니다.')
    } finally {
      if (sequence === sequenceRef.current) setLoading(false)
    }
  }

  const loadRecent = async (tab: DashboardRecentTab) => {
    setRecentByTab((current) => ({ ...current, [tab]: { tab, loading: true } }))
    try {
      const response = await fetch(`/api/admin/stats/recent?tab=${tab}`, { cache: 'no-store' })
      const data = (await response.json().catch(() => null)) as DashboardRecent | null
      if (!response.ok || !data) throw new Error('RECENT_FAILED')
      setRecentByTab((current) => ({ ...current, [tab]: data }))
    } catch {
      setRecentByTab((current) => ({ ...current, [tab]: { tab, failed: true } }))
    }
    setRecentLoadedAt((current) => ({ ...current, [tab]: new Date().toISOString() }))
  }

  const openRecentTab = (tab: DashboardRecentTab) => {
    setRecentTab(tab)
    if (!recentByTab[tab]) void loadRecent(tab)
  }

  const changeQuery = (query: DashboardQuery) => {
    // 주소는 history.replaceState 로만 고친다(서버 페이지를 다시 그리지 않음).
    window.history.replaceState(null, '', `${window.location.pathname}?${dashboardQueryString(query)}`)
    void loadDashboard(query, false)
  }

  const refreshAll = () => {
    void loadDashboard(period.query, true)
    alerts?.refresh()
    setRecentByTab({})
    if (recentTab) void loadRecent(recentTab)
  }

  const choosePreset = (preset: DashboardPreset) => {
    if (preset === 'custom') {
      setCustomOpen(true)
      return
    }
    setCustomOpen(false)
    changeQuery({ period: preset, subject: period.query.subject })
  }

  const applyCustom = () => {
    if (!customFrom || !customTo) return
    changeQuery({ period: 'custom', subject: period.query.subject, from: customFrom, to: customTo })
  }

  const chooseSubject = (subject: DashboardSubject) => changeQuery({ ...period.query, subject })

  // ---------------------------------------------------------------------------------------------------------------
  // 상태 바: 처리 대기(알림 요약과 같은 값)·판매 상태·슬랙 전송
  // ---------------------------------------------------------------------------------------------------------------
  const work: AdminWorkSummary | null = alerts?.loadFailed ? null : alerts?.summary?.work ?? workFallback
  const workItems = visibleWorkItems(work).filter((item) => (work ? work[item.key] ?? null : null) !== 0)
  const dispatchMessages = alerts?.loadFailed || !alerts?.summary ? null : dispatchStatusMessages(alerts.summary.dispatch)
  const dispatchText = alerts?.loadFailed
    ? '확인 불가'
    : dispatchMessages === null
      ? '확인 중…'
      : dispatchMessages.length === 0 ? '정상' : dispatchMessages.join(' · ')
  const paymentAlert = (work?.paymentAlertOpen ?? 0) > 0
  const attention = salesAttention || paymentAlert

  // ---------------------------------------------------------------------------------------------------------------
  // 카드(③)
  // ---------------------------------------------------------------------------------------------------------------
  const charge = sectionData(dashboard?.charge)
  const market = sectionData(dashboard?.market)
  const activity = sectionData(dashboard?.activity)
  const marketNow = market ? summarizeMarket(market.days) : null
  const marketBefore = market?.previous ? summarizeMarket(market.previous) : null
  const compareLabel = formatCompareLabel(period.compare)
  const subjectFree = <span className="ml-1 rounded bg-[var(--admin-tone-neutral-soft)] px-1 text-[var(--admin-tone-neutral-text)]">과목 무관</span>

  const cards: Array<{ key: CardKey; node: ReactNode }> = []
  if (permissions.money) {
    cards.push({
      key: 'charge',
      node: (
        <AdminMetricCard
          title="순 충전 매출"
          value={formatWon(charge?.current.net)}
          valueUnavailable={!charge}
          delta={charge ? formatDelta(charge.current.net, valueOrUnavailable(charge.previous?.net)) : undefined}
          deltaRangeLabel={charge ? compareLabel : undefined}
          sub={charge ? (
            <>
              결제 {formatCount(charge.current.paymentCount, '건')} {formatWon(charge.current.paymentAmount)} · 환불 {formatCount(charge.current.refundCount, '건')} {formatWon(charge.current.refundAmount)}
              {subjectFree}
            </>
          ) : null}
          help={content?.helpCharge}
          pressed={selectedCard === 'charge'}
          onPress={() => setSelectedCard('charge')}
        />
      ),
    })
  }
  if (permissions.orders) {
    const big = permissions.money ? marketNow?.netCredits : marketNow?.purchaseCount
    const before = permissions.money ? marketBefore?.netCredits : marketBefore?.purchaseCount
    cards.push({
      key: 'market',
      node: (
        <AdminMetricCard
          title="자료 판매"
          value={permissions.money ? formatCredits(big) : formatCount(big, '건')}
          valueUnavailable={!marketNow || big === null || big === undefined}
          delta={marketNow ? formatDelta(valueOrUnavailable(big), valueOrUnavailable(before)) : undefined}
          deltaRangeLabel={marketNow ? compareLabel : undefined}
          sub={marketNow ? (
            permissions.money
              ? <>구매 {formatCount(marketNow.purchaseCount, '건')} {formatCredits(marketNow.purchaseCredits)} · 환불 {formatCount(marketNow.refundCount, '건')} {formatCredits(marketNow.refundCredits)}</>
              : <>환불 {formatCount(marketNow.refundCount, '건')}</>
          ) : null}
          help={content?.helpMarket}
          pressed={selectedCard === 'market'}
          onPress={() => setSelectedCard('market')}
        />
      ),
    })
  }
  if (permissions.members) {
    cards.push({
      key: 'signups',
      node: (
        <AdminMetricCard
          title="신규 가입"
          value={formatCount(activity?.totals.signups, '명')}
          valueUnavailable={activity?.totals.signups === undefined}
          delta={activity ? formatDelta(valueOrUnavailable(activity.totals.signups), valueOrUnavailable(activity.previousTotals?.signups)) : undefined}
          deltaRangeLabel={activity ? compareLabel : undefined}
          sub={activity ? subjectFree : null}
          help={content?.helpSignups}
          pressed={selectedCard === 'signups'}
          onPress={() => setSelectedCard('signups')}
        />
      ),
    })
  }
  if (permissions.orders) {
    cards.push({
      key: 'downloads',
      node: (
        <AdminMetricCard
          title="구매 파일 다운로드"
          value={formatCount(activity?.totals.downloads, '회')}
          valueUnavailable={activity?.totals.downloads === undefined}
          delta={activity ? formatDelta(valueOrUnavailable(activity.totals.downloads), valueOrUnavailable(activity.previousTotals?.downloads)) : undefined}
          deltaRangeLabel={activity ? compareLabel : undefined}
          sub={activity ? <>다운로드한 회원 {formatCount(activity.totals.downloadUsers, '명')}</> : null}
          help={content?.helpDownloads}
          pressed={selectedCard === 'downloads'}
          onPress={() => setSelectedCard('downloads')}
        />
      ),
    })
  }
  const activeCard: CardKey | null = cards.some((card) => card.key === selectedCard) ? selectedCard : cards[0]?.key ?? null

  // ---------------------------------------------------------------------------------------------------------------
  // 넓은 그래프(④): 고른 카드의 일별(90일 초과면 주별) 추이. 날짜마다 0 채움.
  // ---------------------------------------------------------------------------------------------------------------
  const trend = buildTrend({ card: activeCard, period, charge, market, activity, permissions })
  const trendFormat = activeCard === 'charge' ? formatWon : activeCard === 'market' && permissions.money ? formatCredits : (value: number) => formatCount(value)
  const trendEmptyText = activeCard
    ? content?.[({ charge: 'emptyChargeChart', market: 'emptyMarketChart', signups: 'emptySignupsChart', downloads: 'emptyDownloadsChart' } as const)[activeCard]] ?? trendFormat(0)
    : null
  const trendUnavailable = activeCard === 'charge' ? !charge : activeCard === 'market' ? !market : !activity

  // 도넛(reports.view): 과목 × 구매 방식 C / 요금제별 결제액
  const donutSlices: DonutSlice[] = donutTab === 'subjectKind'
    ? (marketNow?.slices ?? []).map((slice, index) => ({
        key: `${slice.subject}:${slice.kind}`,
        label: `${subjectLabel(slice.subject)} · ${kindLabel(slice.kind)}`,
        value: slice.c ?? 0,
        color: SLICE_COLORS[index % SLICE_COLORS.length],
      }))
    : (charge?.byPlan ?? []).map((plan, index) => ({ key: plan.label, label: plan.label, value: plan.amount, color: SLICE_COLORS[index % SLICE_COLORS.length] }))
  const donutUnavailable = donutTab === 'subjectKind' ? !marketNow : !charge

  // 상품 현황(⑤, products.edit)
  const productData = sectionData(products)
  const subject = period.query.subject
  const productCounts = productData
    ? subject === 'all'
      ? {
          published: sum([productData.counts.korean.published, productData.counts.english.published]),
          hidden: sum([productData.counts.korean.hidden, productData.counts.english.hidden]),
          archived: sum([productData.counts.korean.archived, productData.counts.english.archived]),
          draft: sum([productData.counts.korean.draft, productData.counts.english.draft]),
        }
      : productData.counts[subject]
    : null
  const productHref = (itemSubject: string) => `/admin/market/products?subject=${itemSubject === 'english' ? 'english' : 'korean'}`
  const newProductHref = `/admin/market/products/new?subject=${subject === 'english' ? 'english' : 'korean'}`

  const generatedAt = dashboard?.generatedAt ?? period.current.to
  const showCharts = cards.length > 0

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={title}
        tools={
          <>
            <Segmented
              label="과목"
              options={DASHBOARD_SUBJECTS.map((value) => ({ value, label: DASHBOARD_SUBJECT_LABELS[value] }))}
              value={subject}
              onChange={chooseSubject}
            />
            <label className="flex items-center gap-1.5 text-sm text-[var(--studio-text)]">
              <span className="sr-only">기간</span>
              <select
                value={customOpen ? 'custom' : period.query.period}
                onChange={(event) => choosePreset(event.target.value as DashboardPreset)}
                className="h-8 rounded-[var(--studio-radius-control)] border border-[var(--studio-control-border)] bg-[var(--studio-surface)] px-2 text-sm max-md:h-11"
              >
                {DASHBOARD_PERIOD_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>{DASHBOARD_PERIOD_LABELS[preset]}</option>
                ))}
              </select>
            </label>
            <Button type="button" variant="adminTable" size="sm" onClick={refreshAll} disabled={loading}>
              <RefreshCw aria-hidden="true" className={cn('size-4', loading && 'animate-spin motion-reduce:animate-none')} />
              새로고침
            </Button>
          </>
        }
        meta={
          <span aria-live="polite">
            {period.current.fromDate === period.current.toDate ? period.current.fromDate : `${period.current.fromDate} ~ ${period.current.toDate}`}
            {period.current.ongoing ? ` ${formatKstTime(period.current.to)}까지` : ''} · 마지막 갱신 {formatKstTime(generatedAt)} · 한국 시간 기준
            {loading ? ' · 불러오는 중' : ''}
          </span>
        }
      />

      {customOpen ? (
        <form
          className="-mt-3 flex flex-wrap items-center gap-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault()
            applyCustom()
          }}
        >
          <label htmlFor="dashboard-from" className="text-[var(--studio-muted)]">시작일</label>
          <Input id="dashboard-from" type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} className="h-8 w-40 max-sm:w-full" />
          <label htmlFor="dashboard-to" className="text-[var(--studio-muted)]">끝일</label>
          <Input id="dashboard-to" type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} className="h-8 w-40 max-sm:w-full" />
          <Button type="submit" variant="adminTable" size="sm" disabled={!customFrom || !customTo}>적용</Button>
          <span className="text-xs text-[var(--studio-muted)]">최대 366일</span>
        </form>
      ) : null}

      {/* ② 상태 바 */}
      <section
        aria-label="처리 대기·판매 상태"
        className={cn(
          'space-y-3 rounded-[var(--studio-radius-card)] border bg-[var(--studio-surface)] p-3',
          attention ? 'border-[var(--admin-tone-danger-text)]' : 'border-[var(--studio-border)]'
        )}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {workItems.length > 0 ? (
            workItems.map((item) => {
              const value = work ? work[item.key] ?? null : null
              return (
                <Link key={item.key} href={item.href} className="rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)]">
                  <AdminStatusBadge label={`${item.label} ${value === null ? '확인 불가' : formatCount(value, '건')}`} tone={value === null ? 'warning' : 'danger'} />
                </Link>
              )
            })
          ) : (
            <span className="text-[var(--studio-muted)]">처리 대기 없음</span>
          )}
          {alerts ? (
            <span className="ml-auto break-keep text-xs md:whitespace-nowrap">
              관리자 알림(슬랙){' '}
              <span role="status" className={dispatchText === '정상' ? 'text-[var(--admin-tone-success-text)]' : 'font-semibold text-[var(--admin-tone-warning-text)]'}>{dispatchText}</span>
            </span>
          ) : null}
        </div>
        <div key="sales-panel">{salesPanel}</div>
      </section>

      {loadError ? <AdminNotice kind="error" onRetry={() => void loadDashboard(period.query, false)}>{loadError}</AdminNotice> : null}
      {!dashboard && !loadError ? (
        <AdminNotice kind="error" onRetry={() => void loadDashboard(period.query, true)}>권한을 확인하지 못해 숫자를 보이지 않았습니다.</AdminNotice>
      ) : null}

      {/* ③ 카드 */}
      {dashboard ? (
        cards.length > 0 ? (
          <section aria-label="지표" className={cn('transition-opacity', loading && 'opacity-70')}>
            <AdminMetricGrid>{cards.map((card) => <div key={card.key} className="contents">{card.node}</div>)}</AdminMetricGrid>
          </section>
        ) : (
          <AdminNotice kind="info">볼 수 있는 지표가 없습니다(권한).</AdminNotice>
        )
      ) : null}

      {/* ④ 그래프 */}
      {dashboard && showCharts ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section aria-label="추이" className={cn('rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4', permissions.money ? 'lg:col-span-2' : 'lg:col-span-3')}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--studio-ink)]">
                {trend.title}{trend.weekly ? ' · 주별' : ' · 일별'}
              </h2>
              <Button type="button" variant="brandGhost" size="sm" aria-pressed={showTable} onClick={() => setShowTable((value) => !value)}>
                {showTable ? '그래프로 보기' : '표로 보기'}
              </Button>
            </div>
            {trendUnavailable ? (
              <div className="flex h-[280px] items-center justify-center text-sm text-[var(--studio-muted)]">확인 불가</div>
            ) : showTable ? (
              <div className="max-h-[280px] overflow-y-auto">
                <AdminDataTable
                  caption={`${trend.title} 표`}
                  dense
                  rows={trend.points}
                  getRowKey={(point) => point.key}
                  columns={[
                    // 주 행은 그래프의 주 막대 클릭과 같은 주문 화면 링크(키보드·화면 낭독기 대체 수단)
                    { key: 'label', header: trend.weekly ? '주' : '날짜', cell: (point) => (point.href ? <Link href={point.href} className="text-[var(--studio-primary)] hover:underline">{point.label}</Link> : point.label) },
                    { key: 'value', header: '값', numeric: true, cell: (point) => trendFormat(point.value) },
                  ]}
                />
              </div>
            ) : (
              <DashboardTrendChart points={trend.points} formatValue={trendFormat} ariaLabel={`${trend.title} 그래프`} emptyText={trendEmptyText} />
            )}
          </section>

          {permissions.money ? (
            <section aria-label="구성" className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4">
              <Segmented
                label="구성 보기"
                options={[{ value: 'subjectKind' as const, label: '과목·구매 방식' }, { value: 'plan' as const, label: '요금제별 결제액' }]}
                value={donutTab}
                onChange={setDonutTab}
                className="mb-3"
              />
              {donutUnavailable ? (
                <div className="flex h-[240px] items-center justify-center text-sm text-[var(--studio-muted)]">확인 불가</div>
              ) : showTable ? (
                <div className="max-h-[240px] overflow-y-auto">
                  <AdminDataTable
                    caption="구성 표"
                    dense
                    rows={donutSlices}
                    getRowKey={(slice) => slice.key}
                    columns={[
                      { key: 'label', header: '항목', cell: (slice) => slice.label },
                      { key: 'value', header: '값', numeric: true, cell: (slice) => (donutTab === 'plan' ? formatWon(slice.value) : formatCredits(slice.value)) },
                    ]}
                    state={donutSlices.length === 0 ? <span className="text-[var(--studio-muted)]">{content?.emptyDonut ?? formatCount(0)}</span> : undefined}
                  />
                </div>
              ) : (
                <DashboardDonutChart
                  slices={donutSlices}
                  formatValue={donutTab === 'plan' ? formatWon : formatCredits}
                  ariaLabel={donutTab === 'plan' ? '요금제별 결제액 도넛 그래프' : '과목·구매 방식별 자료 판매 크레딧 도넛 그래프'}
                  emptyText={content?.emptyDonut ?? formatCount(0)}
                />
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      {/* ⑤ 상품 */}
      {dashboard && (permissions.orders || permissions.products) ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {permissions.orders ? (
            <section aria-label="상품 순위" className={cn('rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4', permissions.products ? 'lg:col-span-2' : 'lg:col-span-3')}>
              <Segmented
                label="순위 종류"
                options={[{ value: 'orders' as const, label: '판매 상위 5개' }, { value: 'downloads' as const, label: '다운로드 상위 5개' }]}
                value={rankingTab}
                onChange={setRankingTab}
                className="mb-3"
              />
              <RankingTable
                tab={rankingTab}
                section={rankingTab === 'orders' ? dashboard.orderRanking : dashboard.downloadRanking}
                permissions={permissions}
                content={content}
                publishedCount={productCounts?.published ?? null}
                productHref={productHref}
                newProductHref={newProductHref}
              />
            </section>
          ) : null}
          {permissions.products ? (
            <section aria-label="상품 현황" className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--studio-ink)]">상품 현황</h2>
                <Link href={productHref(subject)} className="text-xs text-[var(--studio-primary)] hover:underline">상품 관리</Link>
              </div>
              {!productData || !productCounts ? (
                <p className="py-6 text-center text-sm text-[var(--studio-muted)]">확인 불가</p>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    {([['published', '공개'], ['hidden', '숨김'], ['archived', '보관'], ['draft', '게시 대기(임시저장)']] as const).map(([key, label]) => (
                      <div key={key} className="rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] px-3 py-2">
                        <dt className="text-xs text-[var(--studio-muted)]">{label}</dt>
                        <dd className="text-lg font-semibold tabular-nums text-[var(--studio-ink)]">{formatCount(productCounts[key], '개')}</dd>
                      </div>
                    ))}
                  </dl>
                  <h3 className="mb-1 mt-4 text-xs font-semibold text-[var(--studio-muted)]">최근 수정</h3>
                  <ul className="divide-y divide-[var(--studio-border)] text-sm">
                    {productData.recent[subject].map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2 py-2">
                        <Link href={productHref(item.subject)} className="min-w-0 truncate hover:underline">{item.title}</Link>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <AdminStatusBadge label={DASHBOARD_ITEM_STATE_LABELS[item.state]} tone={item.state === 'published' ? 'success' : item.state === 'hidden' ? 'warning' : 'neutral'} />
                          <span className="text-xs tabular-nums text-[var(--studio-muted)]">{formatKstShort(item.updatedAt)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      {/* ⑥ 최근 목록(기간과 따로) */}
      {recentTab ? (
        <section aria-label="최근 목록" className="rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-4">
          <Segmented
            label="최근 목록"
            options={recentTabs.map((tab) => ({ value: tab, label: DASHBOARD_RECENT_TAB_LABELS[tab] }))}
            value={recentTab}
            onChange={openRecentTab}
            className="mb-3"
          />
          <RecentList state={recentByTab[recentTab]} loadedAt={recentLoadedAt[recentTab] ?? generatedAt} permissions={permissions} onRetry={() => void loadRecent(recentTab)} />
        </section>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------------------
// 그래프 데이터
// ---------------------------------------------------------------------------------------------------------------
function buildTrend({
  card,
  period,
  charge,
  market,
  activity,
  permissions,
}: {
  card: CardKey | null
  period: ResolvedDashboardPeriod
  charge: ChargeSectionData | null
  market: MarketSectionData | null
  activity: ActivitySectionData | null
  permissions: DashboardPermissions
}): { title: string; weekly: boolean; points: TrendPoint[] } {
  const titles: Record<CardKey, string> = {
    charge: '순 충전 매출',
    market: permissions.money ? '자료 판매(순 사용 C)' : '자료 판매(구매 건수)',
    signups: '신규 가입',
    downloads: '구매 파일 다운로드',
  }
  if (!card) return { title: '', weekly: false, points: [] }
  const values = new Map<string, number>()
  if (card === 'charge') for (const day of charge?.days ?? []) values.set(day.day, day.net)
  if (card === 'market') for (const row of market?.days ?? []) values.set(row.day, marketDayValue(row, permissions.money ? 'credits' : 'count'))
  if (card === 'signups') for (const day of activity?.days ?? []) values.set(day.day, day.signups ?? 0)
  if (card === 'downloads') for (const day of activity?.days ?? []) values.set(day.day, day.downloads ?? 0)
  const rows = period.days.map((day) => ({ day, value: values.get(day) ?? 0 }))
  const lastDay = period.days[period.days.length - 1]
  // 주 막대를 누르면 그 주 범위로 주문 화면(주문 조회 권한이 있을 때만, 7절)
  const ordersHref = (from: string, to: string) => {
    if (!permissions.orders || (card !== 'charge' && card !== 'market')) return undefined
    const params = new URLSearchParams({ tab: card === 'charge' ? 'payments' : 'market', from, to })
    if (card === 'market' && period.query.subject !== 'all') params.set('orderSubject', period.query.subject)
    return `/admin/orders?${params.toString()}`
  }

  if (period.days.length > DASHBOARD_WEEKLY_AFTER_DAYS) {
    const points = bucketByWeek(rows, (row) => row.value).map((week) => ({
      key: week.from,
      label: `${week.from.slice(5)}~${week.to.slice(5)}${week.partial ? '(일부)' : ''}`,
      value: week.value,
      href: ordersHref(week.from, week.to),
    }))
    return { title: titles[card], weekly: true, points }
  }
  const points = rows.map((row) => ({
    key: row.day,
    label: period.current.ongoing && row.day === lastDay ? '오늘(진행 중)' : row.day.slice(5),
    value: row.value,
  }))
  return { title: titles[card], weekly: false, points }
}

// ---------------------------------------------------------------------------------------------------------------
// 작은 부품
// ---------------------------------------------------------------------------------------------------------------
function ChartPlaceholder({ height }: { height: number }) {
  return <div aria-hidden="true" className="w-full animate-pulse rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] motion-reduce:animate-none" style={{ height }} />
}

function Segmented<Value extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string
  options: Array<{ value: Value; label: string }>
  value: Value
  onChange: (value: Value) => void
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('inline-flex flex-wrap gap-1 rounded-[var(--studio-radius-control)] bg-[var(--studio-background)] p-0.5', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-8 rounded-[var(--studio-radius-control)] px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--studio-focus-ring)] max-md:min-h-11',
            option.value === value ? 'bg-[var(--studio-surface)] font-semibold text-[var(--studio-primary)] shadow-xs' : 'text-[var(--studio-muted)] hover:text-[var(--studio-text)]'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function RankingTable({
  tab,
  section,
  permissions,
  content,
  publishedCount,
  productHref,
  newProductHref,
}: {
  tab: RankingTab
  section: DashboardSection<DashboardRankRow[]>
  permissions: DashboardPermissions
  content: DashboardContent | null
  publishedCount: number | null
  productHref: (subject: string) => string
  newProductHref: string
}) {
  if (!section || section.failed) return <AdminTableState kind="error" message="순위를 읽지 못했습니다." />
  if (section.data.length === 0) {
    // 상품 현황 값은 products.edit 에만 싣는다(다른 권한의 빈 상태에는 공개 상품 수 없음).
    const head = content?.[tab === 'orders' ? 'emptyOrdersRanking' : 'emptyDownloadsRanking'] ?? formatCount(0)
    const published = permissions.products && publishedCount !== null
      ? ` · ${content?.publishedCount ? fillCount(content.publishedCount, formatCount(publishedCount)) : formatCount(publishedCount)}`
      : ''
    return (
      <AdminTableState
        kind="empty"
        message={`${head}${published}`}
        action={permissions.products ? <Button asChild variant="adminTable" size="sm"><Link href={newProductHref}>상품 등록</Link></Button> : undefined}
      />
    )
  }
  const columns: AdminDataTableColumn<DashboardRankRow>[] = [
    { key: 'rank', header: '순위', numeric: true, cell: (_row, index) => index + 1 },
    {
      key: 'title',
      header: '상품',
      cell: (row) => (permissions.products ? <Link href={productHref(row.subject)} className="hover:underline">{row.title}</Link> : row.title),
    },
    { key: 'subject', header: '과목', cell: (row) => subjectLabel(row.subject) },
    {
      key: 'state',
      header: '상태',
      cell: (row) => {
        const state = dashboardItemState({ status: row.status, isActive: row.isActive, isDeleted: row.isDeleted })
        return state ? <AdminStatusBadge label={DASHBOARD_ITEM_STATE_LABELS[state]} tone={state === 'published' ? 'success' : state === 'hidden' ? 'warning' : state === 'deleted' ? 'danger' : adminStatusTone('marketItem', row.status)} /> : null
      },
    },
  ]
  if (tab === 'orders') {
    columns.push({ key: 'orders', header: '구매', numeric: true, cell: (row) => formatCount(row.orderCount, '건') })
    if (permissions.money) columns.push({ key: 'credits', header: '크레딧', numeric: true, cell: (row) => formatCredits(row.chargedCredits) })
  } else {
    columns.push({ key: 'users', header: '받은 회원', numeric: true, cell: (row) => formatCount(row.downloadUsers, '명') })
    columns.push({ key: 'downloads', header: '다운로드', numeric: true, cell: (row) => formatCount(row.downloadCount, '회') })
  }
  return <AdminDataTable caption={tab === 'orders' ? '판매 상위 상품' : '다운로드 상위 상품'} dense rows={section.data} getRowKey={(row) => row.itemId} columns={columns} />
}

function RecentList({
  state,
  loadedAt,
  permissions,
  onRetry,
}: {
  state: RecentState | undefined
  loadedAt: string
  permissions: DashboardPermissions
  onRetry: () => void
}) {
  if (!state || 'loading' in state) return <AdminTableState kind="loading" />
  if (state.failed) return <AdminTableState kind="error" message="목록을 불러오지 못했습니다." onRetry={onRetry} />
  if (state.rows.length === 0) return <AdminTableState kind="empty" message={state.tab === 'support' ? '답변 대기 문의가 없습니다.' : '주문이 없습니다.'} />
  // 회원 상세는 회원 조회 권한이 있을 때만 링크(7절)
  const member = (userId: string, email: string | null, withdrawn = false) => {
    const text = withdrawn ? '탈퇴 회원' : email ?? '회원'
    return permissions.members && !withdrawn ? <Link href={`/admin/users/${userId}`} className="hover:underline">{text}</Link> : <span>{text}</span>
  }
  const loadedMs = Date.parse(loadedAt)

  return (
    <ul className="divide-y divide-[var(--studio-border)]">
      {state.tab === 'market' && state.rows.map((order) => (
        <li key={order.id} className="py-3">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/admin/orders?tab=market&q=${encodeURIComponent(order.id)}`} className="min-w-0 break-words text-sm font-medium hover:underline">
              {order.title} · {formatCredits(order.charged_credits)}
            </Link>
            <AdminStatusBadge label={labelOf(MARKET_ORDER_STATUS_LABELS, order.status)} tone={adminStatusTone('marketOrder', order.status)} />
          </div>
          <p data-admin-pii="" className="mt-1 break-all text-xs text-[var(--studio-muted)]">
            {member(order.user_id, order.email)} · {subjectLabel(order.subject)} · {kindLabel(order.purchase_type === 'legacy_backfill' ? 'legacy' : order.purchase_type)} · {formatKstShort(order.created_at)}
          </p>
        </li>
      ))}
      {state.tab === 'charge' && state.rows.map((order) => (
        <li key={order.id} className="py-3">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/admin/orders?q=${encodeURIComponent(order.order_id)}`} className="min-w-0 break-words text-sm font-medium hover:underline">
              {order.plan_name_snapshot} · {formatWon(order.expected_amount)}
            </Link>
            <AdminStatusBadge label={labelOf(PAYMENT_ORDER_STATUS_LABELS, order.status)} tone={adminStatusTone('paymentOrder', order.status)} />
          </div>
          <p data-admin-pii="" className="mt-1 break-all text-xs text-[var(--studio-muted)]">
            {member(order.user_id, order.email)} · {formatKstShort(order.created_at)}
          </p>
        </li>
      ))}
      {state.tab === 'support' && state.rows.map((ticket) => (
        <li key={ticket.id} className="py-3">
          <div className="flex items-start justify-between gap-3">
            <Link href={`/admin/support?ticket=${ticket.id}`} className="min-w-0 break-words text-sm font-medium hover:underline">
              {ticket.subject}
            </Link>
            <AdminStatusBadge label={`대기 ${formatCount(Math.max(0, Math.floor((loadedMs - Date.parse(ticket.created_at)) / 3_600_000)), '시간')}`} tone="warning" />
          </div>
          <p data-admin-pii="" className="mt-1 break-all text-xs text-[var(--studio-muted)]">
            {member(ticket.user_id, ticket.email, ticket.memberWithdrawn)} · {formatKstShort(ticket.created_at)}
          </p>
        </li>
      ))}
    </ul>
  )
}
