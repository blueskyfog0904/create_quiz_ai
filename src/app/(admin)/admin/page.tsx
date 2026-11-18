import { Suspense } from 'react'
import { DashboardClient } from './dashboard-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { PaymentSalesPanel } from '@/components/admin/payment-sales-panel'
import { requireAdminPanelUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getAdminAccess } from '@/lib/admin-permissions-server'
import { getPaymentSalesStatus } from '@/lib/payment-sales-status-server'

export default async function AdminDashboardPage() {
  await requireAdminPanelUser()
  const [salesStatus, access] = await Promise.all([
    getPaymentSalesStatus(),
    // 권한을 읽지 못하면 중지 버튼만 숨긴다(상태 표시는 그대로).
    getAdminAccess().catch(() => null),
  ])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 max-md:text-2xl"><AdminMenuName href="/admin" fallback="관리자 대시보드" /></h1>
        <p className="text-gray-500 mt-1">서비스 현황을 한눈에 확인하세요</p>
      </div>
      
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardClient salesPanel={<PaymentSalesPanel status={salesStatus} canStopSales={hasAdminPermission(access, 'owner')} />} />
      </Suspense>
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats Cards Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl p-6 shadow-sm border animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-24 mb-3" />
            <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-32" />
          </div>
        ))}
      </div>
      
      {/* Content Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-40 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm border animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-40 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

