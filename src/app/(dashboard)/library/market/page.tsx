import { requireAuth } from '@/lib/auth'
import { resolveWorkspaceSubject } from '@/lib/workspace-subject'
import { listMarketLibraryRowsForUser } from '@/lib/market-items-server'
import MarketLibraryClient from './market-library-client'

interface MarketLibraryPageProps {
  searchParams?: Promise<{ subject?: string }>
}

export default async function MarketLibraryPage({ searchParams }: MarketLibraryPageProps) {
  const user = await requireAuth()
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const rows = await listMarketLibraryRowsForUser(user.id, resolveWorkspaceSubject(resolvedSearchParams?.subject))

  return <MarketLibraryClient rows={rows} />
}
