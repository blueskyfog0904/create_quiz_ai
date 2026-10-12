import { Metadata } from 'next'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { MarketCategoryTreeEditor } from '@/components/admin/market-category-tree-editor'

export const metadata: Metadata = {
  title: '카테고리 메뉴 관리 | 관리자 패널',
  description: '문제마켓 카테고리 칸(depth1~5)을 관리합니다.',
}

interface MarketCategoriesPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MarketCategoriesPage({ searchParams }: MarketCategoriesPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">
          카테고리 메뉴 관리 · {workspaceSubject === 'english' ? '영어' : '국어'}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        문제마켓 카테고리 칸입니다. 헤더 메가메뉴에는 depth1~depth2가 보이고, 칸마다 카테고리 페이지가 있습니다. 비활성화하면 그 칸과 아래 칸 전체가 메뉴와 카테고리 페이지에서 숨겨집니다.
      </p>
      <MarketCategoryTreeEditor key={workspaceSubject} subject={workspaceSubject} />
    </div>
  )
}
