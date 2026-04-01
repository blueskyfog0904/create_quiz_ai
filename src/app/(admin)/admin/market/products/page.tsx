import { requireAdmin } from '@/lib/auth'
import { resolveAdminWorkspaceSubject } from '@/lib/admin-workspace'
import { listMarketMenuEntriesForAdmin } from '@/lib/market-menu-server'
import { listMarketItemsForAdmin } from '@/lib/market-items-server'
import MarketProductsClient from './market-products-client'

interface AdminMarketProductsPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function AdminMarketProductsPage({ searchParams }: AdminMarketProductsPageProps) {
  await requireAdmin()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveAdminWorkspaceSubject(resolvedSearchParams?.subject)

  const [menuEntries, items] = await Promise.all([
    listMarketMenuEntriesForAdmin(workspaceSubject),
    listMarketItemsForAdmin(undefined, workspaceSubject),
  ])

  return (
    <MarketProductsClient
      menuEntries={menuEntries}
      initialItems={items}
      workspaceSubject={workspaceSubject}
    />
  )
}
