import { requireAuth } from '@/lib/auth'
import { DEFAULT_WORKSPACE_SUBJECT } from '@/lib/workspace-subject'
import { listMarketLibraryRowsForUser } from '@/lib/market-items-server'
import MarketLibraryClient from './market-library-client'

export default async function MarketLibraryPage() {
  const user = await requireAuth()
  const rows = await listMarketLibraryRowsForUser(user.id, DEFAULT_WORKSPACE_SUBJECT)

  return <MarketLibraryClient rows={rows} />
}
