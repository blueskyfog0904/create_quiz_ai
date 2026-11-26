import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { listAdminUsers } from '@/lib/admin-users-server'
import { UsersClient } from './users-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { SuspensionPolicyCard } from './suspension-policy-card'
import { getMemberSuspensionPolicyAdminData } from './suspension-policy-actions'

interface AdminUsersPageProps {
  searchParams?: Promise<{ q?: string; page?: string; pageSize?: string; suspended?: string }>
}

export default async function AdminUsersPage({ searchParams }: AdminUsersPageProps) {
  const access = await requireAdminPagePermission('members.view')
  const params = searchParams ? await searchParams : undefined
  const [result, suspensionPolicyData] = await Promise.all([
    listAdminUsers({ q: params?.q, page: params?.page, pageSize: params?.pageSize, suspended: params?.suspended }),
    // 12번 6-3: 이용 정지 안내 문구·사유 분류 카드는 대표 전용
    access.role === 'owner' ? getMemberSuspensionPolicyAdminData() : Promise.resolve(null),
  ])

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 max-md:text-2xl"><AdminMenuName href="/admin/users" fallback="사용자 관리" /></h1>
        <p className="text-gray-500 mt-1">가입된 사용자를 조회하고 관리합니다</p>
      </div>

      {suspensionPolicyData && <div className="mb-6"><SuspensionPolicyCard data={suspensionPolicyData} /></div>}

      {/* 검색어가 바뀌면(뒤로 가기·메뉴 이동 포함) 입력칸도 주소의 검색어로 다시 맞춘다. */}
      <UsersClient
        key={`${result.query}:${result.suspendedOnly}`}
        users={result.users}
        totalCount={result.totalCount}
        page={result.page}
        pageSize={result.pageSize}
        query={result.query}
        suspendedOnly={result.suspendedOnly}
        canGrantCredits={hasAdminPermission(access, 'credits.grant')}
      />
    </div>
  )
}
