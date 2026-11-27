import type { Metadata } from 'next'
import { PricingPlansClient } from './pricing-plans-client'
import { PricingPageContentForm } from './pricing-page-content-form'
import { PointChargePolicyForm } from './point-charge-policy-form'
import { readPricingPageContentForAdmin } from '@/lib/pricing-page-content-server'
import { getPointChargePolicyAdminData } from './actions'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
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
            <AdminPageHeader
                className="mb-8"
                title={<AdminMenuName href="/admin/pricing" fallback="요금제 관리" />}
                description="사용자에게 판매할 크레딧 요금제를 설정합니다."
            />

            <PricingPlansClient />
            <PricingPageContentForm initial={await readPricingPageContentForAdmin()} />
            <PointChargePolicyForm initial={await getPointChargePolicyAdminData()} />
        </div>
    )
}
