import type { Metadata } from 'next'
import Link from 'next/link'
import { MarketOrdersClient } from './market-orders-client'
import { PaymentOrdersClient } from './orders-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/orders',
    fallbackName: '주문 조회',
    searchParams,
    description: '충전 결제·마켓 구매 주문을 조회합니다.',
  })
}

// 탭은 주소의 ?tab= 으로 고른다. 탭을 늘릴 때는 여기에 한 줄을 더하고 아래에서 그 탭의 화면을 그린다.
const ORDER_TABS = [
  { id: 'payments', label: '충전 결제' },
  { id: 'market', label: '마켓 구매' },
] as const

interface AdminOrdersPageProps {
  searchParams?: Promise<{ tab?: string }>
}

export default async function AdminOrdersPage({ searchParams }: AdminOrdersPageProps) {
  await requireAdminPagePermission('orders.view')
  const params = searchParams ? await searchParams : undefined
  const activeTab = ORDER_TABS.find((tab) => tab.id === params?.tab) ?? ORDER_TABS[0]

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/orders" fallback="주문 조회" />}
        description="고객 문의에 답할 때 주문을 찾아보는 화면입니다. 조회만 할 수 있습니다."
      />

      <nav aria-label="주문 종류" className="mb-6 flex gap-1 border-b border-[var(--studio-border)]">
        {ORDER_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={`/admin/orders?tab=${tab.id}`}
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

      {activeTab.id === 'payments' && <PaymentOrdersClient />}
      {activeTab.id === 'market' && <MarketOrdersClient />}
    </div>
  )
}
