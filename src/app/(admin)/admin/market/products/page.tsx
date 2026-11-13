import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { listMarketCategoryTreeForAdmin } from '@/lib/market-categories-server'
import { listMarketItemsForAdmin } from '@/lib/market-items-server'
import { countPendingMarketStorageCleanup } from '@/lib/market-storage-cleanup'
import MarketProductsClient from './market-products-client'
import { StorageCleanupNotice } from './storage-cleanup-notice'

interface AdminMarketProductsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function AdminMarketProductsPage({ searchParams }: AdminMarketProductsPageProps) {
  await requireAdmin()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  const [categoryNodes, items, pendingStorageCleanupCount] = await Promise.all([
    listMarketCategoryTreeForAdmin(workspaceSubject),
    listMarketItemsForAdmin({ workspaceSubject }),
    // 건수를 못 읽어도 상품 관리 화면은 열려야 한다.
    countPendingMarketStorageCleanup().catch(() => 0),
  ])

  // 과목을 바꾸면 초기 트리·목록으로 다시 시작한다(클라이언트 상태가 이전 과목 값을 들고 있지 않게).
  return (
    <>
      <StorageCleanupNotice pendingCount={pendingStorageCleanupCount} />
      <MarketProductsClient
        key={workspaceSubject}
        mode="manage"
        initialCategoryNodes={categoryNodes}
        initialItems={items}
        workspaceSubject={workspaceSubject}
      />
    </>
  )
}
