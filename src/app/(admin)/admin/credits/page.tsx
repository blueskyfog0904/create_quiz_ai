import { CreditsClient } from './credits-client'
import { CreditGrantLimitsCard } from './credit-grant-limits-card'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { listAdminCreditTransactions } from '@/lib/admin-credit-transactions-server'
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

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 max-md:text-2xl"><AdminMenuName href="/admin/credits" fallback="크레딧 관리" /></h1>
        <p className="text-gray-500 mt-1">시스템 전체 크레딧 거래 내역을 조회합니다</p>
      </div>

      <CreditGrantLimitsCard limits={grantLimits} canEdit={hasAdminPermission(access, 'credits.limits.manage')} />

      {/* 검색어가 바뀌면(뒤로 가기·메뉴 이동 포함) 입력칸도 주소의 검색어로 다시 맞춘다. */}
      <CreditsClient
        key={result.query}
        transactions={result.transactions}
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
