'use client'

import { useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import MarketSamplePreviewDialog from '@/components/market/market-sample-preview-dialog'
import { Button } from '@/components/ui/button'
import { fillSampleCount } from '@/lib/market-item-options'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketMaterialSampleButtonProps {
  itemId: string
  samplePageCount: number
  workspaceSubject: WorkspaceSubject
  // 19번: 버튼 글(DB 상세 안내 문구 sampleButton·sampleButtonEmpty). {장수} 는 샘플 장수로 바뀐다.
  label: string
}

export function MarketMaterialSampleButton({
  itemId,
  samplePageCount,
  workspaceSubject,
  label,
}: MarketMaterialSampleButtonProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [prefetchKey, setPrefetchKey] = useState(0)
  const hasSample = samplePageCount > 0

  function prefetchSample() {
    if (!hasSample) return
    setPrefetchKey((current) => current + 1)
  }

  function openSample() {
    setOpen(true)
  }

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="brandOutline"
        className="mt-3 w-full"
        disabled={!hasSample}
        onFocus={prefetchSample}
        onMouseEnter={prefetchSample}
        onClick={openSample}
      >
        <Eye aria-hidden="true" />
        {fillSampleCount(label, samplePageCount)}
      </Button>
      <MarketSamplePreviewDialog
        itemId={itemId}
        workspaceSubject={workspaceSubject}
        open={open}
        prefetchKey={prefetchKey}
        onOpenChange={setOpen}
        returnFocusRef={triggerRef}
      />
    </>
  )
}
