import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { listAdminUsers } from '@/lib/admin-users-server'
import { maskPhone } from '@/lib/admin-member-access-log'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { UsersClient } from './users-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
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
  // 13번 8절: 목록에 실린 회원(관리자 계정·탈퇴 회원 빼고)의 연락처 열람을 먼저 기록한다. 남기지 못하면 연락처를 가린다(Q4 가).
  // 전화번호는 목록에서 늘 가린 값만 보낸다(Q3 가 — 전체 번호는 회원 상세에서). 검색은 서버에서 원래 값으로 비교한다.
  const logged = await recordMemberAccess({
    access,
    screen: 'users.list',
    memberIds: result.users.filter((user) => !user.is_admin && !user.withdrawn_at).map((user) => user.id),
    fields: ['email', 'phone'],
    context: { page: result.page, searched: Boolean(result.query), suspendedOnly: result.suspendedOnly, count: result.users.length },
  })
  const users = result.users.map((user) => ({
    ...user,
    email: logged || user.is_admin ? user.email : null,
    phone: logged || user.is_admin ? maskPhone(user.phone) : null,
  }))

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/users" fallback="사용자 관리" />}
        description="가입된 사용자를 조회하고 관리합니다"
      />

      {suspensionPolicyData && <div className="mb-6"><SuspensionPolicyCard data={suspensionPolicyData} /></div>}

      {/* 검색어가 바뀌면(뒤로 가기·메뉴 이동 포함) 입력칸도 주소의 검색어로 다시 맞춘다. */}
      <UsersClient
        key={`${result.query}:${result.suspendedOnly}`}
        users={users}
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
