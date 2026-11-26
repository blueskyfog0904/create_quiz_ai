import { DashboardClient } from './dashboard-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { PaymentSalesPanel } from '@/components/admin/payment-sales-panel'
import { requireAdminPanelUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getAdminAccess } from '@/lib/admin-permissions-server'
import { getPaymentSalesStatus } from '@/lib/payment-sales-status-server'
import { dashboardPermissions } from '@/lib/admin-dashboard-fields'
import { parseDashboardQuery, resolveDashboardPeriod } from '@/lib/admin-dashboard-period'
import { firstRecentTab, getAdminDashboard, getDashboardRecent, readDashboardContent } from '@/lib/admin-dashboard-server'
import { getAdminWorkSummary } from '@/lib/admin-work-summary-server'

interface AdminDashboardPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

// 21번 묶음(계획 6절): 첫 화면은 서버에서 그린다. 주소(period·subject·from·to)를 검사해 같은 함수로 읽고 넘긴다.
// 최근 목록의 첫 탭도 여기서 읽는다(열람 기록 1행). 화면은 초기 데이터가 있으면 마운트 때 다시 부르지 않는다.
export default async function AdminDashboardPage({ searchParams }: AdminDashboardPageProps) {
  const params = searchParams ? await searchParams : undefined
  await requireAdminPanelUser()
  const [salesStatus, access] = await Promise.all([
    getPaymentSalesStatus(),
    // 권한을 읽지 못하면 숫자 구역을 빼고 중지 버튼을 숨긴다(상태 표시는 그대로).
    getAdminAccess().catch(() => null),
  ])
  const now = new Date()
  const period = resolveDashboardPeriod(parseDashboardQuery(params, now), now)
  const permissions = dashboardPermissions(access)
  const recentTab = firstRecentTab(permissions)
  const [dashboard, recent, content, work] = await Promise.all([
    access ? getAdminDashboard(access, period, { includeProducts: true }) : null,
    access && recentTab ? getDashboardRecent(access, recentTab) : null,
    readDashboardContent(),
    getAdminWorkSummary(access),
  ])

  return (
    <DashboardClient
      title={<AdminMenuName href="/admin" fallback="관리자 대시보드" />}
      permissions={permissions}
      content={content}
      initial={{ period, dashboard, work, recent }}
      salesAttention={!salesStatus || !salesStatus.acceptsNewOrders}
      salesPanel={<PaymentSalesPanel status={salesStatus} canStopSales={hasAdminPermission(access, 'owner')} />}
    />
  )
}
