'use client'

import { Eye, FileCheck2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
}

export function SamplePreviewDialog({
  hasSample,
  title,
  className,
  fullWidth = false,
}: SamplePreviewDialogProps) {
  if (!hasSample) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        title="이 자료는 제공되는 샘플이 없습니다."
        className={`min-h-11 ${fullWidth ? 'w-full' : ''} ${className ?? ''}`}
      >
        <Eye aria-hidden="true" />
        샘플 없음
      </Button>
    )
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={`min-h-11 border-[var(--preview-border)] ${
            fullWidth ? 'w-full' : ''
          } ${className ?? ''}`}
        >
          <Eye aria-hidden="true" />
          샘플 보기
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto border-[var(--preview-border)] p-5 sm:p-7">
        <DialogHeader className="pr-8">
          <div className="mb-1 flex items-center gap-2 text-[var(--preview-primary)]">
            <FileCheck2 aria-hidden="true" className="h-5 w-5" />
            <span className="text-xs font-extrabold tracking-[0.08em]">
              DOCUMENT SAMPLE
            </span>
          </div>
          <DialogTitle className="break-keep text-xl font-extrabold text-[var(--preview-ink)] sm:text-2xl">
            {title} 미리보기
          </DialogTitle>
          <DialogDescription className="break-keep leading-6 text-[var(--preview-muted)]">
            지문, 문항, 해설의 화면 구성을 확인하기 위한 합성 문서 시안입니다.
          </DialogDescription>
        </DialogHeader>
        <DocumentPreviewPages />
        <p className="rounded-md bg-[var(--preview-background)] px-4 py-3 text-xs leading-5 text-[var(--preview-muted)]">
          실제 교재 원문이 아닌 레이아웃 검증용 합성 콘텐츠이며 다운로드는
          제공하지 않습니다.
        </p>
      </DialogContent>
    </Dialog>
  )
}
