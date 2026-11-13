import { requireAdmin } from '@/lib/auth'
import { listAdminUsers } from '@/lib/admin-users-server'
import { UsersClient } from './users-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'

interface AdminUsersPageProps {
  searchParams?: Promise<{ q?: string; page?: string; pageSize?: string }>
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  await requireAdmin()
  const params = searchParams ? await searchParams : undefined
  const result = await listAdminUsers({ q: params?.q, page: params?.page, pageSize: params?.pageSize })

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900"><AdminMenuName href="/admin/users" fallback="사용자 관리" /></h1>
        <p className="text-gray-500 mt-1">가입된 사용자를 조회하고 관리합니다</p>
      </div>

      {/* 검색어가 바뀌면(뒤로 가기·메뉴 이동 포함) 입력칸도 주소의 검색어로 다시 맞춘다. */}
      <UsersClient
        key={result.query}
        users={result.users}
        totalCount={result.totalCount}
        page={result.page}
        pageSize={result.pageSize}
        query={result.query}
      />
    </div>
  )
}
