'use client'

import type { ReactElement, RefObject } from 'react'
import { FileText, Layers3 } from 'lucide-react'
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { StudioDialogContent } from '@/components/design-system'
import type { SampleMaterialPost } from '../../_data/sample-data'

interface SamplePreviewDialogProps {
  post: SampleMaterialPost
  trigger?: ReactElement
  open?: boolean
  onOpenChange?: (open: boolean) => void
  returnFocusRef?: RefObject<HTMLElement | null>
}

export function SamplePreviewDialog({
  post,
  trigger,
  open,
  onOpenChange,
  returnFocusRef,
}: SamplePreviewDialogProps) {
  const passage = post.passages[0]
  const previewSegments = passage?.segments.slice(0, 3) ?? []
  const previewQuestions = post.questions.slice(0, 3)

  function handleCloseAutoFocus(event: Event) {
    if (!returnFocusRef?.current) return

    event.preventDefault()
    returnFocusRef.current.focus()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : null}
      <StudioDialogContent
        onCloseAutoFocus={handleCloseAutoFocus}
        className="max-h-[88vh] max-w-[min(920px,calc(100vw-2rem))] overflow-y-auto bg-[var(--studio-background)] p-0"
      >
        <DialogHeader className="border-b border-[var(--studio-border)] bg-[var(--studio-surface)] px-5 py-5 sm:px-7">
          <div className="flex items-center gap-2 text-xs font-extrabold text-[var(--studio-primary)]">
            <FileText aria-hidden="true" className="h-4 w-4" />
            SAMPLE PREVIEW
          </div>
          <DialogTitle className="break-keep text-xl font-black leading-7 tracking-[-0.025em] text-[var(--studio-ink)]">
            {post.title}
          </DialogTitle>
          <DialogDescription className="break-keep leading-6 text-[var(--studio-muted)]">
            합성 지문과 문항 배치를 보여 주는 시안용 미리보기입니다. 실제
            원문이나 판매 파일은 포함하지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-6">
          <section className="min-h-[360px] rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-sm sm:col-span-2">
            <div className="flex items-center justify-between border-b border-[var(--studio-border)] pb-3">
              <span className="text-[10px] font-extrabold tracking-[0.12em] text-[var(--studio-primary)]">
                SYNTHETIC PASSAGE
              </span>
              <span className="text-[10px] font-bold text-[var(--studio-muted)]">
                지문 {post.passages.length}
              </span>
            </div>
            <h3 className="mt-5 text-center text-base font-black text-[var(--studio-ink)]">
              {passage?.title ?? post.title}
            </h3>
            <div className="mt-5 space-y-4">
              {previewSegments.map((segment) => (
                <div
                  key={segment.label}
                  className="grid grid-cols-[28px_minmax(0,1fr)] gap-3"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] text-xs font-black text-[var(--studio-primary)]">
                    {segment.label}
                  </span>
                  <div>
                    <p className="text-xs font-extrabold text-[var(--studio-ink)]">
                      {segment.title}
                    </p>
                    <p className="mt-1 line-clamp-4 break-keep text-[11px] leading-5 text-[var(--studio-muted)]">
                      {segment.content.join(' ')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="min-h-[360px] rounded-[var(--studio-radius-control)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--studio-border)] pb-3">
              <span className="text-[10px] font-extrabold tracking-[0.12em] text-emerald-700">
                QUESTION SHEET
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--studio-muted)]">
                <Layers3 aria-hidden="true" className="h-3.5 w-3.5" />
                {post.questions.length}문항
              </span>
            </div>
            <div className="mt-5 space-y-5">
              {previewQuestions.map((question, index) => (
                <div key={question.id}>
                  <p className="text-xs font-black leading-5 text-[var(--studio-ink)]">
                    {index + 1}. {question.prompt}
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {question.choices.slice(0, 3).map((choice, choiceIndex) => (
                      <p
                        key={`${question.id}-${choiceIndex}`}
                        className="flex gap-1.5 text-[10px] leading-4 text-[var(--studio-muted)]"
                      >
                        <span>{choiceIndex + 1}.</span>
                        <span className="line-clamp-1">{choice}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </StudioDialogContent>
    </Dialog>
  )
}
