import type { Metadata } from 'next'
import { PricingPlansClient } from './pricing-plans-client'
import { PricingPageContentForm } from './pricing-page-content-form'
import { readPricingPageContentForAdmin } from '@/lib/pricing-page-content-server'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/pricing',
    fallbackName: '요금제 관리',
    searchParams,
    titleSuffix: '관리자',
  })
}

export default async function AdminPricingPage() {
    await requireAdminPagePermission('pricing.manage')
    return (
        <div>
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 max-md:text-2xl"><AdminMenuName href="/admin/pricing" fallback="요금제 관리" /></h1>
                <p className="text-gray-500 mt-1">사용자에게 판매할 크레딧 요금제를 설정합니다.</p>
            </div>

            <PricingPlansClient />
            <PricingPageContentForm initial={await readPricingPageContentForAdmin()} />
        </div>
    )
}
