'use client'

import Link from 'next/link'
import { useRef, useState, type MouseEvent } from 'react'
import { FileImage, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import MarketSamplePreviewDialog from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

export interface MarketMaterialListItem {
  id: string
  title: string
  thumbnailUrl: string | null
  detailHref: string
  metadataLabels: string[]
  sampleAvailable: boolean
  startingPriceCredits: number | null
  ratingAverage: number | null
  ratingCount: number
}

function Thumbnail({ item }: { item: MarketMaterialListItem }) {
  if (item.thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- public preview rows can point to remote thumbnails outside Next image optimization.
      <img
        src={item.thumbnailUrl}
        alt=""
        className="h-[79px] w-[56px] rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] object-cover"
      />
    )
  }

  return (
    <div className="flex h-[79px] w-[56px] items-center justify-center rounded-[var(--studio-radius-control)] border border-dashed border-[var(--studio-border)] bg-[var(--studio-background)] text-[var(--studio-muted)]">
      <FileImage aria-hidden="true" className="h-4 w-4" />
    </div>
  )
}

export function MarketMaterialList({
  subject,
  items,
}: {
  subject: WorkspaceSubject
  items: MarketMaterialListItem[]
}) {
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
    <>
      <ul role="list" className="divide-y divide-[var(--studio-border)]">
        {items.map((item) => (
          <li key={item.id} className="group relative px-4 py-5 transition-colors hover:bg-[var(--studio-primary-soft)] sm:px-5">
            <div className="grid grid-cols-[56px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 md:grid-cols-[56px_minmax(0,1fr)_auto] md:gap-x-5">
              <Thumbnail item={item} />

              <div className="min-w-0">
                <Link
                  href={item.detailHref}
                  className="flex min-h-11 items-center break-keep text-lg font-semibold leading-7 text-[var(--studio-text)] outline-none transition after:absolute after:inset-0 hover:text-[var(--studio-primary)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--studio-focus-ring)]"
                >
                  {item.title}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <p className="[font-family:var(--studio-font-price)] text-base font-semibold leading-6 text-[var(--studio-ink)]">
                    {item.startingPriceCredits === null
                      ? '가격 정보 없음'
                      : `${item.startingPriceCredits.toLocaleString('ko-KR')} 크레딧`}
                  </p>
                  <span aria-hidden="true" className="text-[var(--studio-border)]">·</span>
                  <p className="flex items-center gap-1 text-xs text-[var(--studio-muted)]">
                    <Star aria-hidden="true" className="size-4 fill-current text-amber-400" />
                    {item.ratingAverage === null
                      ? '0.0'
                      : `${item.ratingAverage.toFixed(1)} (${item.ratingCount.toLocaleString('ko-KR')})`}
                  </p>
                </div>
              </div>

              <div className="relative z-10 col-start-2 flex flex-wrap items-center justify-between gap-3 md:col-start-3 md:row-start-1 md:flex-col md:items-end md:self-center">
                {item.metadataLabels.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 md:justify-end">
                    {item.metadataLabels.map((label) => (
                      <span
                        key={`${item.id}-${label}`}
                        className="rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] px-2 py-1 text-xs font-semibold text-[var(--studio-primary)]"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                ) : null}

                {item.sampleAvailable ? (
                  <Button
                    type="button"
                    variant="brandOutline"
                    onFocus={() => prefetchSamplePreview(item.id)}
                    onMouseEnter={() => prefetchSamplePreview(item.id)}
                    onClick={(event) => openSamplePreview(event, item.id)}
                  >
                    샘플보기
                  </Button>
                ) : null}
              </div>
            </div>
          </li>
        ))}
      </ul>

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
    </>
  )
}
