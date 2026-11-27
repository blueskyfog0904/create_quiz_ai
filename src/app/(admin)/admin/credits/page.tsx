import { CreditsClient } from './credits-client'
import { CreditGrantLimitsCard } from './credit-grant-limits-card'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { listAdminCreditTransactions } from '@/lib/admin-credit-transactions-server'
import { recordMemberAccess } from '@/lib/admin-member-access-log-server'
import { getAdminCreditGrantLimits } from '@/lib/admin-credit-grant-limits-server'

interface AdminCreditsPageProps {
  searchParams?: Promise<{ type?: string; q?: string; page?: string; pageSize?: string }>
}

export default async function AdminCreditsPage({ searchParams }: AdminCreditsPageProps) {
  const access = await requireAdminPagePermission('credits.view')
  const params = searchParams ? await searchParams : undefined
  const [result, grantLimits] = await Promise.all([
    listAdminCreditTransactions({
      type: params?.type,
      q: params?.q,
      page: params?.page,
      pageSize: params?.pageSize,
    }),
    getAdminCreditGrantLimits(),
  ])
  // 13번 8절: 거래에 실린 회원 이메일의 열람을 먼저 기록한다. 남기지 못하면 이메일을 가린다(Q4 가).
  const logged = await recordMemberAccess({
    access,
    screen: 'credits.list',
    memberIds: result.transactions.filter((transaction) => transaction.user?.email).map((transaction) => transaction.user_id),
    fields: ['email'],
    context: { page: result.page, searched: Boolean(result.query), type: result.type, count: result.transactions.length },
  })
  const transactions = logged
    ? result.transactions
    : result.transactions.map((transaction) => ({ ...transaction, user: transaction.user ? { ...transaction.user, email: null } : null }))

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/credits" fallback="크레딧 관리" />}
        description="시스템 전체 크레딧 거래 내역을 조회합니다"
      />

      <CreditGrantLimitsCard limits={grantLimits} canEdit={hasAdminPermission(access, 'credits.limits.manage')} />

      {/* 검색어가 바뀌면(뒤로 가기·메뉴 이동 포함) 입력칸도 주소의 검색어로 다시 맞춘다. */}
      <CreditsClient
        key={result.query}
        transactions={transactions}
        totalCount={result.totalCount}
        page={result.page}
        pageSize={result.pageSize}
        query={result.query}
        type={result.type}
        monthlyStats={result.monthlyStats}
        canGrantCredits={hasAdminPermission(access, 'credits.grant')}
      />
    </div>
  )
}
