import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getActiveHeaderNavigationItems } from '@/lib/header-navigation'
import { getHeaderNavigationConfig } from '@/lib/header-navigation-server'
import { isWorkspaceSubject } from '@/lib/workspace-subject'
import MarketSidebar from '@/app/(dashboard)/market/market-sidebar'

interface WorkspaceMarketLayoutProps {
  children: ReactNode
  params: Promise<{ workspaceSubject: string }>
}

export default async function WorkspaceMarketLayout({
  children,
  params,
}: WorkspaceMarketLayoutProps) {
  const { workspaceSubject } = await params

  if (!isWorkspaceSubject(workspaceSubject)) {
    notFound()
  }

  const navigationConfig = await getHeaderNavigationConfig(workspaceSubject)
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
