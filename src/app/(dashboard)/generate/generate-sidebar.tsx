'use client'

import { Sparkles } from 'lucide-react'
import WorkspaceSecondLevelSidebar from '@/components/layout/workspace-second-level-sidebar'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'

interface GenerateSidebarProps {
  parentTitle: string
  items: HeaderMenuChildItem[]
}

export default function GenerateSidebar({ parentTitle, items }: GenerateSidebarProps) {
  return (
    <WorkspaceSecondLevelSidebar
      icon={<Sparkles className="h-4 w-4" />}
      parentTitle={parentTitle}
      items={items}
      reorderItems={(input) => {
        const personal = input.find((item) => item.href === '/generate/personal') ?? null
        const others = input.filter((item) => item.href !== '/generate/personal')
        return personal ? [...others, personal] : input
      }}
      isItemActive={(item, currentPath) => {
        if (item.href === '/generate/personal') {
          return currentPath === '/generate/personal' || currentPath === '/generate/multi'
        }

        return currentPath === item.href || currentPath.startsWith(`${item.href}/`)
      }}
      renderDividerBeforeItem={(item, orderedItems) => {
        const hasPersonal = orderedItems.some((candidate) => candidate.href === '/generate/personal')
        const hasBoardItems = orderedItems.some((candidate) => candidate.href !== '/generate/personal')
        return hasPersonal && hasBoardItems && item.href === '/generate/personal'
      }}
    />
  )
}
