import { requireAdmin } from '@/lib/auth'
import { listMarketMenuEntriesForAdmin } from '@/lib/market-menu-server'
import { listMarketItemsForAdmin } from '@/lib/market-items-server'
import MarketProductsClient from './market-products-client'

export default async function AdminMarketProductsPage() {
  await requireAdmin()

  const [menuEntries, items] = await Promise.all([
    listMarketMenuEntriesForAdmin(),
    listMarketItemsForAdmin(),
  ])

  return (
    <MarketProductsClient
      menuEntries={menuEntries}
      initialItems={items}
    />
  )
}
