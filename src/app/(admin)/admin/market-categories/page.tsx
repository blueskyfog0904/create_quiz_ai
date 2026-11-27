import type { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MarketCategoryTreeEditor } from '@/components/admin/market-category-tree-editor'
import { AdminMenuName } from '@/components/layout/admin-menu-labels'
import { AdminPageHeader } from '@/components/admin/kit/admin-page-header'
import { buildAdminMenuMetadata } from '@/lib/admin-sidebar-server'
import { requireAdminPagePermission } from '@/lib/admin-permissions-server'

export function generateMetadata({ searchParams }: { searchParams?: Promise<{ subject?: string }> }): Promise<Metadata> {
  return buildAdminMenuMetadata({
    href: '/admin/market-categories',
    fallbackName: '카테고리 메뉴 관리',
    searchParams,
    description: '문제마켓 카테고리 칸(1단계~5단계)을 관리합니다.',
  })
}

interface MarketCategoriesPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MarketCategoriesPage({ searchParams }: MarketCategoriesPageProps) {
  await requireAdminPagePermission('products.edit')
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div>
      <AdminPageHeader
        title={<><AdminMenuName href="/admin/market-categories" fallback="카테고리 메뉴 관리" /> · {workspaceSubject === 'english' ? '영어' : '국어'}</>}
        description="문제마켓 카테고리 칸입니다. 헤더 메가메뉴에는 1단계~2단계가 보이고, 칸마다 카테고리 페이지가 있습니다. 비활성화하면 그 칸과 아래 칸 전체가 메뉴와 카테고리 페이지에서 숨겨집니다."
      />
      <MarketCategoryTreeEditor key={workspaceSubject} subject={workspaceSubject} />
    </div>
  )
}
