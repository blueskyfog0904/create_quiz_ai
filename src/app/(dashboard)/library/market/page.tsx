import { requireAuth } from '@/lib/auth'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import { listMarketLibraryRowsForUser } from '@/lib/market-items-server'
import { buildMarketMenuHref } from '@/lib/market-menu'
import { listVisibleMarketMenuEntries } from '@/lib/market-menu-server'
import MarketLibraryClient from './market-library-client'

interface MarketLibraryPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MarketLibraryPage({ searchParams }: MarketLibraryPageProps) {
  const user = await requireAuth()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const workspaceSubject = resolveWorkspaceSubject(resolvedSearchParams?.subject)
  const [rows, marketEntries] = await Promise.all([
    listMarketLibraryRowsForUser(user.id, workspaceSubject),
    listVisibleMarketMenuEntries(workspaceSubject),
  ])
  const browseMarketHref = marketEntries[0]
    ? buildMarketMenuHref(marketEntries[0])
    : '/market'

  return (
    <MarketLibraryClient
      rows={rows}
      workspaceSubject={workspaceSubject}
      browseMarketHref={browseMarketHref}
    />
  )
}
