'use client'

import { useState } from 'react'
import { FolderPlus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SamplePreviewDialog } from './sample-preview-dialog'

const initialFeedback = '원하는 작업을 선택하면 시안 안내가 표시됩니다.'

interface DetailActionsProps {
  title: string
  hasSample: boolean
  questionCount: number
}

export function DetailActions({
  title,
  hasSample,
  questionCount,
}: DetailActionsProps) {
  const [feedback, setFeedback] = useState(initialFeedback)

  function showGenerateFeedback() {
    setFeedback(
      `${questionCount}문항 구성을 확인했습니다. 시안 화면이라 실제 문제 생성은 실행되지 않습니다.`
    )
  }

  function showLibraryFeedback() {
    setFeedback(
      '라이브러리에 담는 흐름을 확인했습니다. 시안 화면이라 실제 저장은 실행되지 않습니다.'
    )
  }

  return (
    <>
      <aside className="hidden md:block">
        <div className="rounded-xl border border-[var(--preview-border)] bg-white p-5 shadow-[0_12px_34px_rgba(40,35,85,0.08)] xl:sticky xl:top-[144px]">
          <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--preview-primary)]">
            TEACHER ACTION
          </span>
          <h2 className="mt-2 break-keep text-lg font-extrabold text-[var(--preview-ink)]">
            수업 자료로 활용해 보세요
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--preview-muted)]">
            지문 1개와 연결 문항 {questionCount}개의 구성을 바탕으로 작업을
            시작합니다.
          </p>
          <div className="mt-5 space-y-2.5">
            <Button
              type="button"
              onClick={showGenerateFeedback}
              className="min-h-11 w-full bg-[var(--preview-primary)] font-bold hover:bg-[#5940D8]"
            >
              <Sparkles aria-hidden="true" />
              이 자료로 문제 생성
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={showLibraryFeedback}
              className="min-h-11 w-full border-[var(--preview-border)] font-bold"
            >
              <FolderPlus aria-hidden="true" />
              라이브러리에 담기
            </Button>
            <SamplePreviewDialog
              title={title}
              hasSample={hasSample}
              fullWidth
            />
          </div>
          <p
            aria-live="polite"
            className="mt-4 min-h-12 rounded-md bg-[#6950E5]/[0.06] px-3 py-2.5 text-xs font-semibold leading-5 text-[var(--preview-text)]"
          >
            {feedback}
          </p>
        </div>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--preview-border)] bg-white/95 p-3 shadow-[0_-8px_24px_rgba(28,31,46,0.10)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-[1200px] gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={showLibraryFeedback}
            aria-label="라이브러리에 담기"
            className="h-12 w-12 shrink-0 border-[var(--preview-border)]"
          >
            <FolderPlus aria-hidden="true" />
          </Button>
          <Button
            type="button"
            onClick={showGenerateFeedback}
            className="h-12 min-w-0 flex-1 bg-[var(--preview-primary)] px-3 font-bold hover:bg-[#5940D8]"
          >
            <Sparkles aria-hidden="true" />
            이 자료로 문제 생성
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">
          {feedback === initialFeedback ? '' : feedback}
        </p>
        {feedback !== initialFeedback ? (
          <p className="mt-2 text-center text-[11px] font-semibold leading-4 text-[var(--preview-text)]">
            {feedback}
          </p>
        ) : null}
      </div>
    </>
  )
}
