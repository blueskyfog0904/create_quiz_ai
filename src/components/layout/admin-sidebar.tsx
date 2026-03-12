'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Settings,
  Database,
  Upload,
  Users,
  UserCog,
  MessageSquare,
  ChevronLeft,
  Menu,
  BookOpen,
  Coins,
  CreditCard,
  RefreshCcw,
  LayoutPanelTop,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const menuItems = [
  {
    name: '대시보드',
    href: '/admin',
    icon: LayoutDashboard,
    exact: true,
  },
  {
    name: '메뉴관리',
    href: '/admin/menu-management',
    icon: LayoutPanelTop,
  },
  {
    name: 'AI 문제 유형 관리',
    href: '/admin/problem-types',
    icon: Settings,
  },
  {
    name: '문제은행 관리',
    href: '/admin/questions',
    icon: Database,
    exact: true,
  },
  {
    name: '영어지문 관리',
    href: '/admin/passages',
    icon: BookOpen,
    exact: false,
  },
  {
    name: '문제 업로드',
    href: '/admin/questions/upload',
    icon: Upload,
  },
  {
    name: '사용자 관리',
    href: '/admin/users',
    icon: Users,
  },
  {
    name: '회원가입 관리',
    href: '/admin/roles',
    icon: UserCog,
  },
  {
    name: '고객지원 관리',
    href: '/admin/support',
    icon: MessageSquare,
  },
  {
    name: '표기값 관리',
    href: '/admin/labels',
    icon: Settings,
  },
  {
    name: '출처 관리',
    href: '/admin/source-configs',
    icon: Settings,
  },
  {
    name: '요금제 관리',
    href: '/admin/pricing',
    icon: CreditCard,
  },
  {
    name: '크레딧 관리',
    href: '/admin/credits',
    icon: Coins,
  },
  {
    name: '환불 관리',
    href: '/admin/refunds',
    icon: RefreshCcw,
  },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const isActive = (item: typeof menuItems[number]) => {
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
        </div>

        <nav className="space-y-1 p-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)

            return (
              <Link
                key={item.href}
                href={item.href}
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
