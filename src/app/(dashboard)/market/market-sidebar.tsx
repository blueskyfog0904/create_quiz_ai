'use client'

import { Store } from 'lucide-react'
import WorkspaceChildMenuSidebar from '@/components/layout/workspace-child-menu-sidebar'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'

interface MarketSidebarProps {
  parentTitle: string
  items: HeaderMenuChildItem[]
}

export default function MarketSidebar({ parentTitle, items }: MarketSidebarProps) {
  return (
    <WorkspaceChildMenuSidebar
      icon={<Store className="h-4 w-4" />}
      sectionTitle="문제마켓 메뉴"
      parentTitle={parentTitle}
      items={items}
      description="2단계 하위 메뉴를 선택하세요"
    />
  )
}
