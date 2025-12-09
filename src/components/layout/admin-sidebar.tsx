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
  MessageSquare,
  ChevronLeft,
  Menu,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

const menuItems = [
  { 
    name: '대시보드', 
    href: '/admin', 
    icon: LayoutDashboard,
    exact: true 
  },
  { 
    name: 'AI 문제 유형 관리', 
    href: '/admin/problem-types', 
    icon: Settings 
  },
  { 
    name: '문제은행 관리', 
    href: '/admin/questions', 
    icon: Database,
    exact: true
  },
  { 
    name: '문제 업로드', 
    href: '/admin/questions/upload', 
    icon: Upload 
  },
  { 
    name: '사용자 관리', 
    href: '/admin/users', 
    icon: Users 
  },
  { 
    name: '고객지원 관리', 
    href: '/admin/support', 
    icon: MessageSquare 
  },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const isActive = (item: typeof menuItems[0]) => {
    if (item.exact) {
      return pathname === item.href
    }
    return pathname.startsWith(item.href)
  }

  return (
    <>
      {/* Mobile Toggle Button */}
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-20 left-4 z-50 md:hidden bg-white shadow-md"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-16 h-[calc(100vh-4rem)] bg-slate-900 text-white transition-all duration-300 z-40",
          collapsed ? "-translate-x-full md:translate-x-0 md:w-16" : "w-64",
          "md:relative md:top-0 md:h-auto"
        )}
      >
        {/* Collapse Button (Desktop) */}
        <div className="hidden md:flex justify-end p-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-400 hover:text-white hover:bg-slate-800"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn(
              "h-5 w-5 transition-transform",
              collapsed && "rotate-180"
            )} />
          </Button>
        </div>

        {/* Logo/Title */}
        <div className={cn(
          "px-4 py-4 border-b border-slate-700",
          collapsed && "md:px-2 md:py-3"
        )}>
          <h2 className={cn(
            "font-bold text-lg text-orange-400",
            collapsed && "md:text-center md:text-sm"
          )}>
            {collapsed ? "관리" : "관리자 패널"}
          </h2>
        </div>

        {/* Menu Items */}
        <nav className="p-2 space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                  active 
                    ? "bg-orange-600 text-white" 
                    : "text-slate-300 hover:bg-slate-800 hover:text-white",
                  collapsed && "md:justify-center md:px-2"
                )}
                title={collapsed ? item.name : undefined}
                onClick={() => {
                  // Close sidebar on mobile after clicking
                  if (window.innerWidth < 768) {
                    setCollapsed(true)
                  }
                }}
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span className={cn(
                  "text-sm font-medium",
                  collapsed && "md:hidden"
                )}>
                  {item.name}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className={cn(
          "absolute bottom-0 left-0 right-0 p-4 border-t border-slate-700",
          collapsed && "md:p-2"
        )}>
          <Link href="/">
            <Button 
              variant="outline" 
              className={cn(
                "w-full bg-transparent border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white",
                collapsed && "md:px-2"
              )}
            >
              {collapsed ? "←" : "← 메인으로 돌아가기"}
            </Button>
          </Link>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {!collapsed && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setCollapsed(true)}
        />
      )}
    </>
  )
}

