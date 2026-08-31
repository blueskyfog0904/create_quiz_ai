'use client'

import { BookOpen } from 'lucide-react'
import WorkspaceSecondLevelSidebar from '@/components/layout/workspace-second-level-sidebar'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'

interface LibrarySidebarProps {
  parentTitle: string
  items: HeaderMenuChildItem[]
}

export default function LibrarySidebar({ parentTitle, items }: LibrarySidebarProps) {
  return (
    <WorkspaceSecondLevelSidebar
      icon={<BookOpen className="h-4 w-4" />}
      parentTitle={parentTitle}
      items={items}
    />
  )
}
