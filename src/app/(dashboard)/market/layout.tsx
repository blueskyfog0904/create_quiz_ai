import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import MarketSidebar from './market-sidebar'

export default async function MarketLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const navigationConfig = await getHeaderNavigationConfig()
  const activeNavigationItems = getActiveHeaderNavigationItems(navigationConfig.items)
  const marketMenu = activeNavigationItems.find((item) => {
    if (item.href === '/market') return true
    return item.children.some((child) => child.href.startsWith('/market/'))
  })

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {marketMenu?.children.length ? (
          <MarketSidebar parentTitle={marketMenu.title} items={marketMenu.children} />
        ) : null}
        <div className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
