'use client'

import { useRef, useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { ChevronDown, FolderOpen } from 'lucide-react'
import { StudioContainer } from '@/components/design-system/studio-container'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import { MarketItemListRow } from '@/components/market/market-item-list-row'
import MarketSamplePreviewDialog from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog'
import type { MegaMenuGroup } from '@/lib/market-categories-server'
import type { MarketSearchRow } from '@/lib/market-search-server'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface CategoryItemsViewProps {
  category: {
    id: string
    title: string
    workspaceSubject: WorkspaceSubject
    groupTitle: string
  }
  rows: MarketSearchRow[]
  tree: MegaMenuGroup[]
}

// 솔북식 좌측 카테고리 트리: 2단계 그룹은 접이식, 현재 3단계 항목은 회색 하이라이트
function CategorySidebar({
  tree,
  subject,
  subjectLabel,
  activeItemId,
}: {
  tree: MegaMenuGroup[]
  subject: WorkspaceSubject
  subjectLabel: string
  activeItemId: string
}) {
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
                <span className="break-keep">{group.title}</span>
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
                          <span className="break-keep">{item.title}</span>
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

export function CategoryItemsView({ category, rows, tree }: CategoryItemsViewProps) {
  const subject = category.workspaceSubject
  const subjectLabel = subject === 'korean' ? '국어' : '영어'

  const sampleTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [samplePreviewItemId, setSamplePreviewItemId] = useState<string | null>(null)
  const [samplePreviewPrefetchKey, setSamplePreviewPrefetchKey] = useState(0)
  const [isSamplePreviewOpen, setIsSamplePreviewOpen] = useState(false)

  function prefetchSamplePreview(itemId: string) {
    setSamplePreviewItemId(itemId)
    setSamplePreviewPrefetchKey((key) => key + 1)
  }

  function openSamplePreview(event: MouseEvent<HTMLButtonElement>, itemId: string) {
    sampleTriggerRef.current = event.currentTarget
    setSamplePreviewItemId(itemId)
    setIsSamplePreviewOpen(true)
  }

  return (
    <StudioContainer className="py-8 sm:py-10">
      <div className="flex items-start gap-10">
        <aside className="sticky top-36 hidden w-56 shrink-0 self-start lg:block">
          <CategorySidebar
            tree={tree}
            subject={subject}
            subjectLabel={subjectLabel}
            activeItemId={category.id}
          />
        </aside>

        <div className="min-w-0 flex-1">
          <p className="break-keep text-sm text-[var(--studio-muted)]">
            {subjectLabel} / {category.groupTitle}
          </p>
          <h1 className="mt-1 break-keep text-2xl font-bold text-[var(--studio-ink)] sm:text-3xl">
            {category.title}
          </h1>
          <p className="mt-2 text-sm text-[var(--studio-muted)]">
            총 {rows.length.toLocaleString()}개 자료
          </p>

          {rows.length === 0 ? (
            <div className="mt-6">
              <StudioEmptyState
                icon={<FolderOpen className="size-6" aria-hidden />}
                title="아직 등록된 자료가 없습니다"
                description="이 카테고리에 자료가 등록되면 이곳에서 확인할 수 있습니다."
              />
            </div>
          ) : (
            // 솔북식: 한 줄에 상품 1개, 행 사이 hairline 구분선
            <ul className="mt-4 divide-y divide-[var(--studio-border)] border-t border-[var(--studio-border)]">
              {rows.map((row) => (
                <MarketItemListRow
                  key={row.itemId}
                  row={row}
                  subject={subject}
                  onSamplePrefetch={prefetchSamplePreview}
                  onSampleOpen={openSamplePreview}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {samplePreviewItemId ? (
        <MarketSamplePreviewDialog
          key={samplePreviewItemId}
          itemId={samplePreviewItemId}
          workspaceSubject={subject}
          open={isSamplePreviewOpen}
          prefetchKey={samplePreviewPrefetchKey}
          onOpenChange={setIsSamplePreviewOpen}
          returnFocusRef={sampleTriggerRef}
        />
      ) : null}
    </StudioContainer>
  )
}
