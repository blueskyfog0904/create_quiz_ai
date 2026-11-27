import type { Metadata } from 'next'
import { Suspense } from 'react'
import Link from 'next/link'
import { AuditLogClient } from './audit-log-client'
import { MemberAccessLogClient } from './member-access-log-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { AdminTableState } from '@/components/admin/kit/admin-table-state'
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

// 탭은 주소의 ?tab= 으로 고른다(13번 8-3: '개인정보 열람' 탭 — 대표 전용, 이 화면 전체가 대표 전용).
const AUDIT_LOG_TABS = [
  { id: 'actions', label: '작업 기록' },
  { id: 'access', label: '개인정보 열람' },
] as const

interface AdminAuditLogPageProps {
  searchParams?: Promise<{ tab?: string }>
}

export default async function AdminAuditLogPage({ searchParams }: AdminAuditLogPageProps) {
  await requireAdminPagePermission('owner')
  const params = searchParams ? await searchParams : undefined
  const activeTab = AUDIT_LOG_TABS.find((tab) => tab.id === params?.tab) ?? AUDIT_LOG_TABS[0]

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/audit-log" fallback="작업 기록" />}
        description="관리자가 한 일을 시간순으로 봅니다. 결제 쪽 조치(충전 환불·수동 확인·경보 해소)도 함께 보입니다. 기록은 고치거나 지울 수 없습니다."
      />
      <nav aria-label="기록 종류" className="mb-6 flex gap-1 border-b border-[var(--studio-border)]">
        {AUDIT_LOG_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/admin/audit-log?tab=${tab.id}`}
            aria-current={tab.id === activeTab.id ? 'page' : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab.id === activeTab.id
                ? 'border-[var(--studio-primary)] text-[var(--studio-primary)]'
                : 'border-transparent text-[var(--studio-muted)] hover:text-[var(--studio-ink)]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<AdminTableState kind="loading" />}>
        {activeTab.id === 'actions' ? <AuditLogClient /> : <MemberAccessLogClient />}
      </Suspense>
    </div>
  )
}
