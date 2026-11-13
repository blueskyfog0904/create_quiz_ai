import { CreditsClient } from './credits-client'
import { requireAdmin } from '@/lib/auth'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { listAdminCreditTransactions } from '@/lib/admin-credit-transactions-server'

interface AdminCreditsPageProps {
  searchParams?: Promise<{ type?: string; q?: string; page?: string; pageSize?: string }>
}

export default async function AdminCreditsPage({ searchParams }: AdminCreditsPageProps) {
  await requireAdmin()
  const params = searchParams ? await searchParams : undefined
  const result = await listAdminCreditTransactions({
    type: params?.type,
    q: params?.q,
    page: params?.page,
    pageSize: params?.pageSize,
  })

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900"><AdminMenuName href="/admin/credits" fallback="크레딧 관리" /></h1>
        <p className="text-gray-500 mt-1">시스템 전체 크레딧 거래 내역을 조회합니다</p>
      </div>

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
      />
    </div>
  )
}
