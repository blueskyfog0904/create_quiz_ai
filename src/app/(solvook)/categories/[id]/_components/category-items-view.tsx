'use client'

import { useRef, useState, type MouseEvent } from 'react'
import { FolderOpen } from 'lucide-react'
import { StudioContainer } from '@/components/design-system/studio-container'
import { StudioEmptyState } from '@/components/design-system/studio-empty-state'
import { MarketItemCard } from '@/components/market/market-item-card'
import MarketSamplePreviewDialog from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog'
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
}

export function CategoryItemsView({ category, rows }: CategoryItemsViewProps) {
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
        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {rows.map((row) => (
            <MarketItemCard
              key={row.itemId}
              row={row}
              subject={subject}
              onSamplePrefetch={prefetchSamplePreview}
              onSampleOpen={openSamplePreview}
            />
          ))}
        </div>
      )}

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
