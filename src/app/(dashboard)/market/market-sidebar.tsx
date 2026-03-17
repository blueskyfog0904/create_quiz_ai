'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Store } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'

interface MarketSidebarProps {
  parentTitle: string
  items: HeaderMenuChildItem[]
}

export default function MarketSidebar({ parentTitle, items }: MarketSidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string) => (
    pathname === href || pathname.startsWith(`${href}/`)
  )

  if (items.length === 0) {
    return null
  }

  return (
    <aside className="w-full lg:w-64 lg:flex-shrink-0">
      <div className="lg:sticky lg:top-24">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <Store className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold text-gray-900">{parentTitle}</p>
              <p className="text-xs text-gray-500">2단계 메뉴 바로가기</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const active = isActive(item.href)

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className={cn(
                    'flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors',
                    active
                      ? 'bg-primary/10 text-primary shadow-sm'
                      : 'text-gray-700 hover:bg-primary/5 hover:text-primary'
                  )}
                >
                  <span className="font-medium">{item.title}</span>
                  <ChevronRight className={cn('h-4 w-4', active ? 'text-primary' : 'text-gray-400')} />
                </Link>
              )
            })}
          </nav>
        </div>
      </div>
    </aside>
  )
}
