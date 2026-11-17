import type { Metadata } from 'next'
import { Suspense } from 'react'
import { AuditLogClient } from './audit-log-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/audit-log',
    fallbackName: '작업 기록',
    searchParams,
    description: '관리자가 한 일(환불·지급·상품·요금제·권한 변경 등)을 시간순으로 봅니다.',
  })
}

export default async function AdminAuditLogPage() {
  await requireAdminPagePermission('owner')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 max-md:text-2xl"><AdminMenuName href="/admin/audit-log" fallback="작업 기록" /></h1>
        <p className="text-gray-500 mt-1">
          관리자가 한 일을 시간순으로 봅니다. 결제 쪽 조치(충전 환불·수동 확인·경보 해소)도 함께 보입니다. 기록은 고치거나 지울 수 없습니다.
        </p>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">불러오는 중…</p>}>
        <AuditLogClient />
      </Suspense>
    </div>
  )
}
