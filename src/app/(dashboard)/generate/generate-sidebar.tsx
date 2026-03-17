'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { HeaderMenuChildItem } from '@/lib/header-navigation'

interface GenerateSidebarProps {
  parentTitle: string
  items: HeaderMenuChildItem[]
}

export default function GenerateSidebar({ parentTitle, items }: GenerateSidebarProps) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === '/generate/personal') {
      return pathname === '/generate/personal' || pathname === '/generate/multi'
    }

    return pathname === href || pathname.startsWith(`${href}/`)
  }

  if (items.length === 0) {
    return null
  }

  const personalItem = items.find((item) => item.href === '/generate/personal') ?? null
  const boardItems = items.filter((item) => item.href !== '/generate/personal')
  const orderedItems = personalItem ? [...boardItems, personalItem] : items

  return (
    <aside className="w-full lg:w-64 lg:flex-shrink-0">
      <div className="lg:sticky lg:top-24">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <Sparkles className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-semibold text-gray-900">{parentTitle}</p>
              <p className="text-xs text-gray-500">2단계 메뉴 바로가기</p>
            </div>
          </div>

          <nav className="flex flex-col gap-1">
            {orderedItems.map((item) => {
              const active = isActive(item.href)
              const shouldRenderDivider = personalItem !== null && item.href === '/generate/personal' && boardItems.length > 0

              return (
                <div key={item.id} className="space-y-1">
                  {shouldRenderDivider ? (
                    <div className="my-2 border-t border-gray-200" />
                  ) : null}
                  <Link
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
                </div>
              )
            })}
          </nav>
        </div>
      </div>
    </aside>
  )
}
