'use client'

import { BookOpen } from 'lucide-react'
import WorkspaceChildMenuSidebar from '@/components/layout/workspace-child-menu-sidebar'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'

interface LibrarySidebarProps {
  parentTitle: string
  items: HeaderMenuChildItem[]
}

export default function LibrarySidebar({ parentTitle, items }: LibrarySidebarProps) {
  return (
    <WorkspaceChildMenuSidebar
      icon={<BookOpen className="h-4 w-4" />}
      sectionTitle="라이브러리 메뉴"
      parentTitle={parentTitle}
      items={items}
      description="2단계 하위 메뉴를 선택하세요"
    />
  )
}
