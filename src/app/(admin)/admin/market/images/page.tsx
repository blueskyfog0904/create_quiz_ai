import type { Metadata } from 'next'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'
import { MarketImageLibrary } from '@/components/admin/market-image-library'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/market/images',
    fallbackName: '문제마켓 이미지 관리',
    searchParams,
    description: '문제마켓 상품 이미지를 올리고 폴더로 관리합니다.',
  })
}

export default async function AdminMarketImagesPage() {
  await requireAdminPagePermission('products.edit')

  return (
    <div>
      <AdminPageHeader
        title={<AdminMenuName href="/admin/market/images" fallback="문제마켓 이미지 관리" />}
        description="상품·카테고리 항목에 쓰는 이미지를 올리고 폴더로 정리합니다. 같은 이미지는 한 번만 저장됩니다."
      />
      <MarketImageLibrary mode="manage" />
    </div>
  )
}
