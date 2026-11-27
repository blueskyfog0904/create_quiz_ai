import type { Metadata } from 'next'
import AdminAccountsClient from './admin-accounts-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/admin-accounts',
    fallbackName: '관리자 ID 관리',
    searchParams,
    description: '관리자 패널에 로그인할 수 있는 관리자 ID를 관리합니다.',
  })
}

export default async function AdminAccountsPage() {
  await requireAdminPagePermission('owner')

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/admin-accounts" fallback="관리자 ID 관리" />}
        description="관리자 로그인에 사용할 아이디를 생성·수정·삭제합니다. 여기서 만든 아이디로만 관리자 패널에 로그인할 수 있습니다."
      />
      <AdminAccountsClient />
    </div>
  )
}
