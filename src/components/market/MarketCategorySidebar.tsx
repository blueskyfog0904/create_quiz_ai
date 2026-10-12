'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'
import { findCategoryPath, type MarketCategoryNode } from '@/lib/market-category-tree'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

// 솔북식 좌측 카테고리 트리: depth1~2만 그리고(더 깊은 칸은 '더 자세히 찾기'에서 고른다), 현재 칸의 depth1을 펼친 채 시작한다.
// 현재 칸이 depth3 이상이면 그 칸이 속한 depth2를 강조한다. 칸 제목은 그 칸 페이지 링크, 펼침은 옆 버튼. 상품 수는 하위 칸 합산.
const SIDEBAR_MAX_DEPTH = 2
export function MarketCategorySidebar({
  tree,
  subject,
  activeId,
}: {
  tree: MarketCategoryNode[]
  subject: WorkspaceSubject
  activeId: string | null
}) {
  const subjectLabel = subject === 'korean' ? '국어' : '영어'
  const activePath = activeId ? findCategoryPath(tree, activeId) ?? [] : []
  const highlightId = activePath[Math.min(activePath.length, SIDEBAR_MAX_DEPTH) - 1]?.id ?? null
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(activePath.slice(0, SIDEBAR_MAX_DEPTH - 1).map((node) => node.id))
  )

  function toggle(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function renderNodes(nodes: MarketCategoryNode[]) {
    return nodes.map((item) => {
      const expanded = expandedIds.has(item.id)
      const active = item.id === highlightId
      const root = item.depth === 1
      const children = item.depth < SIDEBAR_MAX_DEPTH ? item.children : []
      return (
        <li key={item.id}>
          <div className="flex items-start gap-1">
            <Link
              href={`/categories/${item.id}?subject=${subject}`}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-9 min-w-0 flex-1 items-center rounded-md px-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)] ${
                root ? 'text-[15px] font-semibold text-[var(--studio-ink)]' : 'text-sm'
              } ${
                active
                  ? 'bg-black/5 font-semibold text-[var(--studio-ink)]'
                  : `${root ? '' : 'text-[var(--studio-text)]'} hover:bg-[var(--studio-background)] hover:text-[var(--studio-ink)]`
              }`}
            >
              <span className="break-keep">{item.title} <span className="whitespace-nowrap text-[var(--studio-muted)]">({(item.itemCount ?? 0).toLocaleString()})</span></span>
            </Link>
            {children.length > 0 && (
              <button
                type="button"
                onClick={() => toggle(item.id)}
                aria-expanded={expanded}
                aria-label={`${item.title} ${expanded ? '접기' : '펼치기'}`}
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-[var(--studio-muted)] outline-none transition-colors hover:bg-[var(--studio-background)] focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
              >
                <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>
            )}
          </div>
          {expanded && children.length > 0 && (
            <ul className="mt-0.5 space-y-0.5 pb-1 pl-3">
              {renderNodes(children)}
            </ul>
          )}
        </li>
      )
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
        {renderNodes(tree)}
      </ul>
    </nav>
  )
}
