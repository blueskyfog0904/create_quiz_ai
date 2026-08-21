'use client'

import { useRef, useState } from 'react'
import { Eye } from 'lucide-react'
import MarketSamplePreviewDialog from '@/app/(dashboard)/market/[slug]/items/[itemId]/market-sample-preview-dialog'
import { Button } from '@/components/ui/button'
import { useLoginRedirect } from '@/hooks/use-login-redirect'
import type { WorkspaceSubject } from '@/lib/workspace-subject'

interface MarketMaterialSampleButtonProps {
  isLoggedIn: boolean
  itemId: string
  samplePageCount: number
  workspaceSubject: WorkspaceSubject
}

export function MarketMaterialSampleButton({
  isLoggedIn,
  itemId,
  samplePageCount,
  workspaceSubject,
}: MarketMaterialSampleButtonProps) {
  const { redirectToLogin } = useLoginRedirect()
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [prefetchKey, setPrefetchKey] = useState(0)
  const hasSample = samplePageCount > 0

  function prefetchSample() {
    if (!hasSample || !isLoggedIn) return
    setPrefetchKey((current) => current + 1)
  }

  function openSample() {
    if (!isLoggedIn) {
      redirectToLogin()
      return
    }

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
        {hasSample ? `샘플 ${samplePageCount}장 보기` : '샘플 없음'}
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
