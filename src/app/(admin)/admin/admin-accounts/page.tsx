import type { Metadata } from 'next'
import AdminAccountsClient from './admin-accounts-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/admin-accounts',
    fallbackName: '관리자 ID 관리',
    searchParams,
    description: '관리자 패널에 로그인할 수 있는 관리자 ID를 관리합니다.',
  })
}

export default function AdminAccountsPage() {
  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight"><AdminMenuName href="/admin/admin-accounts" fallback="관리자 ID 관리" /></h2>
      </div>
      <p className="text-sm text-muted-foreground">
        관리자 로그인에 사용할 아이디를 생성·수정·삭제합니다. 여기서 만든 아이디로만 관리자 패널에 로그인할 수 있습니다.
      </p>
      <AdminAccountsClient />
    </div>
  )
}
