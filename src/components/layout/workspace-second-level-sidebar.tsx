'use client'

import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'
import { buildWorkspaceSecondLevelMenuItems } from '@/lib/workspace-second-level-menu'
import { stripWorkspacePrefix } from '@/lib/workspace-subject'
import { cn } from '@/lib/utils'

interface WorkspaceSecondLevelSidebarProps {
  icon: ReactNode
  parentTitle: string
  items: HeaderMenuChildItem[]
  description?: string
  reorderItems?: (items: HeaderMenuChildItem[]) => HeaderMenuChildItem[]
  isItemActive?: (item: HeaderMenuChildItem, currentPath: string) => boolean
  renderDividerBeforeItem?: (item: HeaderMenuChildItem, orderedItems: HeaderMenuChildItem[]) => boolean
}

export default function WorkspaceSecondLevelSidebar({
  icon,
  parentTitle,
  items,
  description = '2단계 메뉴 바로가기',
  reorderItems,
  isItemActive,
  renderDividerBeforeItem,
}: WorkspaceSecondLevelSidebarProps) {
  const pathname = usePathname() ?? '/'
  const scopedPath = stripWorkspacePrefix(pathname).scopedPath

  if (items.length === 0) {
    return null
  }

  const orderedItems = reorderItems ? reorderItems(items) : items
  const menuItems = buildWorkspaceSecondLevelMenuItems({
    currentPath: scopedPath,
    items,
    reorderItems,
    isItemActive,
  })

  return (
    <aside className="w-full lg:w-64 lg:flex-shrink-0">
      <div className="lg:sticky lg:top-24">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <div className="text-primary">{icon}</div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{parentTitle}</p>
              <p className="text-xs text-gray-500">{description}</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            {menuItems.map((item) => (
              <div key={item.id} className="space-y-1">
                {renderDividerBeforeItem?.(item, orderedItems) ? (
                  <div className="my-2 border-t border-gray-200" />
                ) : null}
                <WorkspaceLink
                  href={item.href}
                  className={cn(
                    'flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors',
                    item.active
                      ? 'bg-primary/10 text-primary shadow-sm'
                      : 'text-gray-700 hover:bg-primary/5 hover:text-primary'
                  )}
                >
                  <span className="font-medium">{item.title}</span>
                  <ChevronRight className={cn('h-4 w-4', item.active ? 'text-primary' : 'text-gray-400')} />
                </WorkspaceLink>
              </div>
            ))}
          </nav>
        </div>
      </div>
    </aside>
  )
}
