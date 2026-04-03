'use client'

import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { WorkspaceLink } from '@/components/layout/workspace-link'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'
import { buildWorkspaceChildMenuGroup } from '@/lib/workspace-child-menu'
import { stripWorkspacePrefix } from '@/lib/workspace-subject'
import { cn } from '@/lib/utils'

interface WorkspaceChildMenuSidebarProps {
  icon: ReactNode
  sectionTitle?: string
  parentTitle: string
  items: HeaderMenuChildItem[]
  description?: string
  isItemActive?: (href: string, currentPath: string) => boolean
}

export default function WorkspaceChildMenuSidebar({
  icon,
  sectionTitle = '2단계 메뉴',
  parentTitle,
  items,
  description = '하위 메뉴를 선택하세요',
  isItemActive,
}: WorkspaceChildMenuSidebarProps) {
  const pathname = usePathname() ?? '/'
  const scopedPath = stripWorkspacePrefix(pathname).scopedPath

  if (items.length === 0) {
    return null
  }

  const group = buildWorkspaceChildMenuGroup({
    parentTitle,
    items,
    currentPath: scopedPath,
    isItemActive: isItemActive
      ? (item, currentPath) => isItemActive(item.href, currentPath)
      : undefined,
  })

  return (
    <aside className="w-full lg:w-64 lg:flex-shrink-0">
      <div className="lg:sticky lg:top-24">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <div className="text-primary">{icon}</div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{sectionTitle}</p>
              <p className="text-xs text-gray-500">{description}</p>
            </div>
          </div>

          <div className="rounded-xl border bg-slate-50/80">
            <div
              className="flex items-center justify-between gap-3 rounded-t-xl px-3 py-2.5 text-sm font-semibold text-gray-900"
              aria-hidden="true"
            >
              <span>{group.parent.title}</span>
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </div>
            <div className="space-y-1 border-t border-slate-200 px-2 py-2">
              {group.items.map((item) => (
                <WorkspaceLink
                  key={item.id}
                  href={item.href}
                  className={cn(
                    'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
                    item.active
                      ? 'bg-primary/10 text-primary shadow-sm'
                      : 'text-gray-700 hover:bg-primary/5 hover:text-primary'
                  )}
                >
                  <span className="pl-2 font-medium">{item.title}</span>
                  <ChevronRight className={cn('h-4 w-4', item.active ? 'text-primary' : 'text-gray-400')} />
                </WorkspaceLink>
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
