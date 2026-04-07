'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { ChevronLeft, Menu } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { resolveAdminWorkspaceSubject, withAdminWorkspaceSubject } from '@/lib/admin-workspace'
import {
  adminSidebarIconComponents,
  resolveAdminSidebarMenuItems,
  type AdminSidebarNavigationConfig,
} from '@/lib/admin-sidebar'
import { AdminWorkspaceSwitcher } from './admin-workspace-switcher'

interface AdminSidebarClientProps {
  navigationConfigs: Record<'english' | 'korean', AdminSidebarNavigationConfig>
}

export function AdminSidebarClient({ navigationConfigs }: AdminSidebarClientProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [collapsed, setCollapsed] = useState(false)
  const workspaceSubject = resolveAdminWorkspaceSubject(searchParams.get('subject'))
  const resolvedMenuItems = useMemo(
    () => resolveAdminSidebarMenuItems(workspaceSubject, navigationConfigs[workspaceSubject]),
    [navigationConfigs, workspaceSubject]
  )

  const isActive = (item: (typeof resolvedMenuItems)[number]) => {
    if (item.exact) {
      return pathname === item.href
    }
    return pathname.startsWith(item.href)
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-20 left-4 z-50 bg-white shadow-md md:hidden"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      <aside
        className={cn(
          'fixed left-0 top-16 z-40 h-[calc(100vh-4rem)] bg-slate-900 text-white transition-all duration-300',
          collapsed ? '-translate-x-full md:translate-x-0 md:w-16' : 'w-64',
          'md:relative md:top-0 md:h-auto'
        )}
      >
        <div className="hidden justify-end p-2 md:flex">
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:bg-slate-800 hover:text-white"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn('h-5 w-5 transition-transform', collapsed && 'rotate-180')} />
          </Button>
        </div>

        <div className={cn('border-b border-slate-700 px-4 py-4', collapsed && 'md:px-2 md:py-3')}>
          <h2 className={cn('text-lg font-bold text-orange-400', collapsed && 'md:text-center md:text-sm')}>
            {collapsed ? '관리' : '관리자 패널'}
          </h2>
          {!collapsed ? (
            <div className="mt-3 space-y-3">
              <AdminWorkspaceSwitcher className="w-full" />
              <p className="text-xs text-slate-400">현재 관리 대상: {workspaceSubject === 'english' ? '영어' : '국어'}</p>
            </div>
          ) : null}
        </div>

        <nav className="space-y-1 p-2">
          {resolvedMenuItems.map((item) => {
            const Icon = adminSidebarIconComponents[item.icon]
            const active = isActive(item)

            return (
              <Link
                key={item.href}
                href={withAdminWorkspaceSubject(item.href, workspaceSubject)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
                  active ? 'bg-orange-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                  collapsed && 'md:justify-center md:px-2'
                )}
                title={collapsed ? item.name : undefined}
                onClick={() => {
                  if (window.innerWidth < 768) {
                    setCollapsed(true)
                  }
                }}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className={cn('text-sm font-medium', collapsed && 'md:hidden')}>
                  {item.name}
                </span>
              </Link>
            )
          })}
        </nav>

        <div className={cn('absolute bottom-0 left-0 right-0 border-t border-slate-700 p-4', collapsed && 'md:p-2')}>
          <Link href="/">
            <Button
              variant="outline"
              className={cn(
                'w-full border-slate-600 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white',
                collapsed && 'md:px-2'
              )}
            >
              {collapsed ? '←' : '← 메인으로 돌아가기'}
            </Button>
          </Link>
        </div>
      </aside>

      {!collapsed && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}
    </>
  )
}
