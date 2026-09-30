'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import type { MegaMenuGroup } from '@/lib/market-categories-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

// 솔북식 좌측 카테고리 트리: 2단계 그룹은 접이식, 현재 3단계 항목은 회색 하이라이트
export function MarketCategorySidebar({
  tree,
  subject,
  activeItemId,
}: {
  tree: MegaMenuGroup[]
  subject: WorkspaceSubject
  activeItemId: string | null
}) {
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const activeGroupId = tree.find((group) => group.items.some((item) => item.id === activeItemId))?.id ?? null
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(
    () => new Set(activeGroupId ? [activeGroupId] : [])
  )

  function toggleGroup(groupId: string) {
    setExpandedGroupIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  return (
    <nav aria-label="카테고리 탐색" className="w-full">
      <Link
        href={`/?subject=${subject}`}
        className="inline-flex min-h-9 items-center rounded-md text-2xl font-bold text-[var(--studio-ink)] outline-none hover:text-[var(--studio-primary)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
      >
        {subjectLabel}
      </Link>
      <ul className="mt-4 space-y-1">
        {tree.map((group) => {
          const expanded = expandedGroupIds.has(group.id)
          return (
            <li key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                aria-expanded={expanded}
                className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-[15px] font-semibold text-[var(--studio-ink)] outline-none transition-colors hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                <span className="break-keep">{group.title} <span className="font-normal text-[var(--studio-muted)]">({(group.itemCount ?? 0).toLocaleString()})</span></span>
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 shrink-0 text-[var(--studio-muted)] transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
              </button>
              {expanded && (
                <ul className="mt-0.5 space-y-0.5 pb-1 pl-3">
                  {group.items.map((item) => {
                    const active = item.id === activeItemId
                    return (
                      <li key={item.id}>
                        <Link
                          href={`/categories/${item.id}?subject=${subject}`}
                          aria-current={active ? 'page' : undefined}
                          className={`flex min-h-9 items-center rounded-md px-2.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                            active
                              ? 'bg-black/5 font-semibold text-[var(--studio-ink)]'
                              : 'text-[var(--studio-text)] hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)]'
                          }`}
                        >
                          <span className="break-keep">{item.title} <span className="whitespace-nowrap text-[var(--studio-muted)]">({(item.itemCount ?? 0).toLocaleString()})</span></span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
