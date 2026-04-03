'use client'

import { Store } from 'lucide-react'
import WorkspaceSecondLevelSidebar from '@/components/layout/workspace-second-level-sidebar'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'

interface MarketSidebarProps {
  parentTitle: string
  items: HeaderMenuChildItem[]
}

export default function MarketSidebar({ parentTitle, items }: MarketSidebarProps) {
  return (
    <WorkspaceSecondLevelSidebar
      icon={<Store className="h-4 w-4" />}
      parentTitle={parentTitle}
      items={items}
    />
  )
}
