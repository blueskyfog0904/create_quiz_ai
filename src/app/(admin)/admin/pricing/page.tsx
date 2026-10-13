import type { Metadata } from 'next'
import { PricingPlansClient } from './pricing-plans-client'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/pricing',
    fallbackName: '요금제 관리',
    searchParams,
    titleSuffix: '관리자',
  })
}

export default function AdminPricingPage() {
    return (
        <div>
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900"><AdminMenuName href="/admin/pricing" fallback="요금제 관리" /></h1>
                <p className="text-gray-500 mt-1">사용자에게 판매할 크레딧 요금제를 설정합니다.</p>
            </div>

            <PricingPlansClient />
        </div>
    )
}
