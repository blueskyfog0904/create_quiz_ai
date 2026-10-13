import type { Metadata } from 'next'
import { requireAdmin } from '@/lib/auth'
import { MarketImageLibrary } from '@/components/admin/market-image-library'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
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
  await requireAdmin('/admin/market/images')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight"><AdminMenuName href="/admin/market/images" fallback="문제마켓 이미지 관리" /></h1>
        <p className="mt-2 text-sm text-muted-foreground">
          상품·카테고리 항목에 쓰는 이미지를 올리고 폴더로 정리합니다. 같은 이미지는 한 번만 저장됩니다.
        </p>
      </div>
      <MarketImageLibrary mode="manage" />
    </div>
  )
}
