import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { listMarketCategoryTreeForAdmin } from '@/lib/market-categories-server'
import { listMarketItemsForAdmin } from '@/lib/market-items-server'
import MarketProductsClient from './market-products-client'

interface AdminMarketProductsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function AdminMarketProductsPage({ searchParams }: AdminMarketProductsPageProps) {
  await requireAdmin()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  const [categoryNodes, items] = await Promise.all([
    listMarketCategoryTreeForAdmin(workspaceSubject),
    listMarketItemsForAdmin({ workspaceSubject }),
  ])

  // 과목을 바꾸면 초기 트리·목록으로 다시 시작한다(클라이언트 상태가 이전 과목 값을 들고 있지 않게).
  return (
    <MarketProductsClient
      key={workspaceSubject}
      initialCategoryNodes={categoryNodes}
      initialItems={items}
      workspaceSubject={workspaceSubject}
    />
  )
}
