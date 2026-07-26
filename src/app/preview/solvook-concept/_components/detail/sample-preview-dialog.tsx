'use client'

import type { RefObject } from 'react'
import { Eye, FileCheck2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { StudioDialogContent } from '@/components/design-system/studio-portal-surface'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DocumentPreviewPages } from './document-preview-pages'

interface SamplePreviewDialogProps {
  hasSample: boolean
  title: string
  className?: string
  fullWidth?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
  returnFocusRef?: RefObject<HTMLButtonElement | null>
}

export function SamplePreviewDialog({
  hasSample,
  title,
  className,
  fullWidth = false,
  open,
  onOpenChange,
  showTrigger = true,
  returnFocusRef,
}: SamplePreviewDialogProps) {
  function handleCloseAutoFocus(event: Event) {
    if (!returnFocusRef?.current) return

    event.preventDefault()
    returnFocusRef.current.focus()
  }

  if (!hasSample && showTrigger) {
    return (
      <Button
        type="button"
        variant="brandOutline"
        disabled
        title="이 자료는 제공되는 샘플이 없습니다."
        className={`min-h-11 ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      >
        <Eye aria-hidden="true" />
        샘플 없음
      </Button>
    )
  }

  if (!hasSample) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {showTrigger ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="brandOutline"
            className={`${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
          >
            <Eye aria-hidden="true" />
            샘플 보기
          </Button>
        </DialogTrigger>
      ) : null}
      <StudioDialogContent
        onCloseAutoFocus={handleCloseAutoFocus}
        className="max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto p-5 sm:p-7"
      >
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2 text-[var(--studio-primary)]">
            <FileCheck2 aria-hidden="true" className="h-5 w-5" />
            <span className="text-xs font-extrabold tracking-[0.08em]">
              DOCUMENT SAMPLE
            </span>
          </div>
          <DialogTitle className="break-keep text-xl font-extrabold text-[var(--studio-ink)] sm:text-2xl">
            {title} 미리보기
          </DialogTitle>
          <DialogDescription className="break-keep leading-6 text-[var(--studio-muted)]">
            지문, 문항, 해설의 화면 구성을 확인하기 위한 합성 문서 시안입니다.
          </DialogDescription>
        </DialogHeader>
        <DocumentPreviewPages />
        <p className="rounded-md bg-[var(--studio-background)] px-4 py-3 text-xs leading-5 text-[var(--studio-muted)]">
          실제 교재 원문이 아닌 레이아웃 검증용 합성 콘텐츠이며 다운로드는
          제공하지 않습니다.
        </p>
      </StudioDialogContent>
    </Dialog>
  )
}
