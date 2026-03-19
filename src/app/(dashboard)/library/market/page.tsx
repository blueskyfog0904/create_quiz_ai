import { requireAuth } from '@/lib/auth'
import { listMarketLibraryRowsForUser } from '@/lib/market-items-server'
import MarketLibraryClient from './market-library-client'

export default async function MarketLibraryPage() {
  const user = await requireAuth()
  const rows = await listMarketLibraryRowsForUser(user.id)

  return <MarketLibraryClient rows={rows} />
}
