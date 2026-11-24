'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, ClipboardList, RefreshCw, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminAlerts } from '@/components/admin/admin-alert-context'
import { dispatchStatusMessages, visibleWorkItems } from '@/lib/admin-alerts'
import type { AdminDashboard } from '@/lib/admin-dashboard-server'
import { PAYMENT_ORDER_STATUS_LABELS, labelOf } from '@/lib/admin-orders'
import type { AdminWorkSummary } from '@/lib/admin-work-summary-server'

interface Stats {
  // null이면 가입 수를 볼 권한(회원 조회)이 없어 그리지 않는다.
  signups: { today: number | null; month: number | null } | null
  work: AdminWorkSummary
  // 권한이 없는 구역은 null로 오고 그리지 않는다.
  metrics: AdminDashboard['metrics']
  recentOrders: AdminDashboard['recentOrders']
  recentTickets: AdminDashboard['recentTickets']
  period: { year: number; month: number }
}

// 세지 못한 값(null)은 0으로 보이지 않게 따로 표시한다.
const formatCount = (value: number | null) => (value === null ? '확인 불가' : value.toLocaleString())
const formatValue = (value: number | null | undefined, unit: string) => (value == null ? '확인 불가' : `${value.toLocaleString()}${unit}`)
const formatDateTime = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })

// 문의 상태 이름은 문의 관리 화면(support-client.tsx의 statusConfig)과 같다.
const SUPPORT_TICKET_STATUS_LABELS = {
  pending: '대기 중',
  in_progress: '처리 중',
  resolved: '해결됨',
  closed: '종료',
} as const

// salesPanel: 서버 페이지가 읽은 충전 판매 상태 패널. 처리 대기 아래에 그린다.
export function DashboardClient({ salesPanel }: { salesPanel: ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const alerts = useAdminAlerts()

  const fetchStats = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/stats')
      if (!response.ok) throw new Error('Failed to fetch stats')
      const data = await response.json()
      setStats(data)
      setError(null)
    } catch (err) {
      setError('통계를 불러오는데 실패했습니다.')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchStats()
  }, [])

  // 판매 상태(중지 버튼)는 통계를 불러오는 중이거나 못 불러와도 보인다.
  // 세 분기에서 같은 key로 둬야 불러오기가 끝날 때 패널이 새로 만들어지지 않는다(열어 둔 중지 창이 닫히지 않게).
  if (loading) {
    return (
      <div className="space-y-6">
        <div key="sales-panel">{salesPanel}</div>
        <DashboardSkeleton />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div key="sales-panel">{salesPanel}</div>
        <div className="text-center py-12">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <p className="text-gray-600">{error}</p>
          <Button onClick={fetchStats} className="mt-4">
            다시 시도
          </Button>
        </div>
      </div>
    )
  }

  if (!stats) return null

  // 처리 대기 숫자는 종·메뉴 배지와 같은 값(알림 요약)을 쓴다. 처리 직후에도 서로 어긋나지 않는다.
  // 요약 조회가 실패했으면 옛 숫자 대신 "확인 불가", 아직 못 받았으면 통계 응답의 값.
  const work: AdminWorkSummary | null = alerts?.loadFailed ? null : alerts?.summary?.work ?? stats.work
  const refreshAll = () => {
    void fetchStats()
    alerts?.refresh()
  }
  // 관리자 알림(슬랙) 전송 상태: 종의 알림 패널과 같은 값·같은 문구를 쓴다.
  const dispatchMessages = alerts?.loadFailed || !alerts?.summary ? null : dispatchStatusMessages(alerts.summary.dispatch)
  const dispatchText = alerts?.loadFailed
    ? '확인 불가'
    : dispatchMessages === null
      ? '확인 중…'
      : dispatchMessages.length === 0 ? '정상' : dispatchMessages.join(' · ')
  const { metrics, recentOrders, recentTickets } = stats
  // 권한이 없는 처리 대기 항목은 요약에 없으므로 그리지 않는다. 볼 항목이 하나도 없으면 카드째 숨긴다.
  const workItems = visibleWorkItems(work)
  const monthLabel = `${stats.period.year}년 ${stats.period.month}월`

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">기준: 한국 시간</p>
        <Button
          variant="adminAction"
          size="sm"
          onClick={refreshAll}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </Button>
      </div>

      {workItems.length > 0 ? (
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-gray-400" aria-hidden="true" />
            처리 대기
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {workItems.map((item) => {
              const value = work ? work[item.key] ?? null : null
              // 0이 아니면(확인 불가 포함) 눈에 띄게 한다.
              const needsAttention = value !== 0
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-gray-50"
                  >
                    <span className={needsAttention ? 'font-semibold text-gray-900' : 'text-gray-600'}>
                      {item.label}
                    </span>
                    <span
                      className={
                        needsAttention
                          ? 'rounded-full bg-red-100 px-3 py-0.5 text-sm font-bold text-red-700'
                          : 'px-3 text-sm text-gray-400'
                      }
                    >
                      {formatCount(value)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
      ) : null}

      <div key="sales-panel">{salesPanel}</div>

      {alerts ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-white px-4 py-3 text-sm">
          <span className="font-semibold text-gray-900">관리자 알림 전송(슬랙)</span>
          <span role="status" className={dispatchText === '정상' ? 'text-green-700' : 'font-semibold text-amber-800'}>{dispatchText}</span>
        </div>
      ) : null}

      <section aria-label="지표" className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.signups ? (
            <MetricCard
              title="신규 가입자"
              today={formatValue(stats.signups.today, '명')}
              month={`${monthLabel} ${formatValue(stats.signups.month, '명')}`}
              icon={<Users className="h-6 w-6 text-blue-600" aria-hidden="true" />}
            />
          ) : null}
          {metrics ? (
            <>
              <MetricCard
                title="충전 결제"
                today={`${formatValue(metrics.payment?.today.amount, '원')}${metrics.payment ? ` · ${metrics.payment.today.count.toLocaleString()}건` : ''}`}
                month={`${monthLabel} ${formatValue(metrics.payment?.month.amount, '원')}${metrics.payment ? ` · ${metrics.payment.month.count.toLocaleString()}건` : ''}`}
                note="결제 승인 시각 기준 · 뒤에 환불된 결제도 포함"
              />
              <MetricCard
                title="충전 환불"
                today={formatValue(metrics.refundAmount?.today, '원')}
                month={`${monthLabel} ${formatValue(metrics.refundAmount?.month, '원')}`}
                note="환불이 완료된 시각 기준"
              />
              <MetricCard
                title="마켓 판매"
                today={`${formatValue(metrics.market?.today.count, '건')}${metrics.market ? ` · ${metrics.market.today.credits.toLocaleString()} C` : ''}`}
                month={`${monthLabel} ${formatValue(metrics.market?.month.count, '건')}${metrics.market ? ` · ${metrics.market.month.credits.toLocaleString()} C` : ''}`}
                note={`구매 시각 기준 · 환불·회수된 구매는 제외${metrics.market ? ` (${monthLabel} ${metrics.market.month.refundedCount.toLocaleString()}건)` : ''}`}
              />
              <MetricCard
                title="자료 다운로드"
                today={formatValue(metrics.downloads?.today, '회')}
                month={`${monthLabel} ${formatValue(metrics.downloads?.month, '회')}`}
              />
            </>
          ) : null}
        </div>
        {metrics ? (
          <p className="text-xs text-gray-500">충전 결제·환불은 실결제만 셉니다. 테스트 환경 주문은 지표와 최근 주문에서 제외했습니다.</p>
        ) : null}
      </section>

      {recentOrders || recentTickets ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {recentOrders ? (
            <RecentCard title="최근 충전 주문" href="/admin/orders" linkLabel="주문 조회">
              {recentOrders.failed ? (
                <RecentMessage>불러오지 못했습니다.</RecentMessage>
              ) : recentOrders.data.length === 0 ? (
                <RecentMessage>주문이 없습니다.</RecentMessage>
              ) : (
                <ul className="divide-y">
                  {recentOrders.data.map((order) => (
                    <li key={order.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/admin/orders?q=${encodeURIComponent(order.order_id)}`} className="min-w-0 break-words text-sm font-medium hover:underline">
                          {order.plan_name_snapshot} · {order.expected_amount.toLocaleString()}원
                        </Link>
                        <Badge variant="outline" className="shrink-0">{labelOf(PAYMENT_ORDER_STATUS_LABELS, order.status)}</Badge>
                      </div>
                      <p className="mt-1 break-all text-xs text-gray-500">
                        <Link href={`/admin/users/${order.user_id}`} className="hover:underline">{order.user?.email ?? '회원'}</Link>
                        {' · '}{formatDateTime(order.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </RecentCard>
          ) : null}
          {recentTickets ? (
            <RecentCard title="최근 문의" href="/admin/support" linkLabel="문의 관리">
              {recentTickets.failed ? (
                <RecentMessage>불러오지 못했습니다.</RecentMessage>
              ) : recentTickets.data.length === 0 ? (
                <RecentMessage>문의가 없습니다.</RecentMessage>
              ) : (
                <ul className="divide-y">
                  {recentTickets.data.map((ticket) => (
                    <li key={ticket.id} className="py-3">
                      <div className="flex items-start justify-between gap-3">
                        <Link href={`/admin/support?ticket=${ticket.id}`} className="min-w-0 break-words text-sm font-medium hover:underline">
                          {ticket.subject}
                        </Link>
                        <Badge variant="outline" className="shrink-0">{labelOf(SUPPORT_TICKET_STATUS_LABELS, ticket.status)}</Badge>
                      </div>
                      <p className="mt-1 break-all text-xs text-gray-500">
                        <Link href={`/admin/users/${ticket.user_id}`} className="hover:underline">{ticket.memberWithdrawn ? '탈퇴 회원' : ticket.user?.email ?? '회원'}</Link>
                        {' · '}{formatDateTime(ticket.created_at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </RecentCard>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function MetricCard({ title, today, month, note, icon }: { title: string; today: string; month: string; note?: string; icon?: ReactNode }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-500">오늘 {title}</p>
            <p className="text-2xl font-bold mt-1 break-words">{today}</p>
            <p className="text-xs text-gray-400 mt-1">{month}</p>
            {note ? <p className="text-xs text-gray-400 mt-1">{note}</p> : null}
          </div>
          {icon ? <div className="p-3 rounded-full bg-blue-50">{icon}</div> : null}
        </div>
      </CardContent>
    </Card>
  )
}

function RecentCard({ title, href, linkLabel, children }: { title: string; href: string; linkLabel: string; children: ReactNode }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center justify-between gap-2">
          {title}
          <Link href={href} className="text-sm font-normal text-blue-700 hover:underline">{linkLabel}</Link>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function RecentMessage({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-gray-500">{children}</p>
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className={`bg-white rounded-xl p-6 shadow-sm border animate-pulse ${i === 1 ? 'lg:col-span-2' : ''}`}>
            <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
