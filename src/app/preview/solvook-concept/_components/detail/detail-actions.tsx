'use client'

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Eye, FolderPlus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SamplePreviewDialog } from './sample-preview-dialog'

const initialFeedback = '원하는 작업을 선택하면 시안 안내가 표시됩니다.'

interface DetailActionsContextValue {
  feedback: string
  hasSample: boolean
  questionCount: number
  openSample: (trigger: HTMLButtonElement) => void
  showGenerateFeedback: () => void
  showLibraryFeedback: () => void
}

interface DetailActionsState {
  feedback: string
  sampleOpen: boolean
}

interface DetailActionsProviderProps {
  title: string
  hasSample: boolean
  questionCount: number
  children: ReactNode
}

interface DetailActionsProps {
  layout: 'desktop' | 'mobile'
}

const DetailActionsContext = createContext<DetailActionsContextValue | null>(
  null
)

function useDetailActions() {
  const context = useContext(DetailActionsContext)

  if (!context) {
    throw new Error(
      'DetailActions must be rendered within DetailActionsProvider'
    )
  }

  return context
}

export function DetailActionsProvider({
  title,
  hasSample,
  questionCount,
  children,
}: DetailActionsProviderProps) {
  const [state, setState] = useState<DetailActionsState>({
    feedback: initialFeedback,
    sampleOpen: false,
  })
  const sampleTriggerRef = useRef<HTMLButtonElement>(null)

  function showGenerateFeedback() {
    setState((current) => ({
      ...current,
      feedback: `${questionCount}문항 구성을 확인했습니다. 시안 화면이라 실제 문제 생성은 실행되지 않습니다.`,
    }))
  }

  function showLibraryFeedback() {
    setState((current) => ({
      ...current,
      feedback:
        '라이브러리에 담는 흐름을 확인했습니다. 시안 화면이라 실제 저장은 실행되지 않습니다.',
    }))
  }

  function setSampleOpen(sampleOpen: boolean) {
    setState((current) => ({ ...current, sampleOpen }))
  }

  function openSample(trigger: HTMLButtonElement) {
    if (!hasSample) return

    sampleTriggerRef.current = trigger
    setSampleOpen(true)
  }

  return (
    <DetailActionsContext.Provider
      value={{
        feedback: state.feedback,
        hasSample,
        questionCount,
        openSample,
        showGenerateFeedback,
        showLibraryFeedback,
      }}
    >
      {children}
      <SamplePreviewDialog
        title={title}
        hasSample={hasSample}
        open={state.sampleOpen}
        onOpenChange={setSampleOpen}
        showTrigger={false}
        returnFocusRef={sampleTriggerRef}
      />
    </DetailActionsContext.Provider>
  )
}

export function DetailActions({ layout }: DetailActionsProps) {
  const {
    feedback,
    hasSample,
    questionCount,
    showGenerateFeedback,
    showLibraryFeedback,
    openSample,
  } = useDetailActions()

  if (layout === 'mobile') {
    return (
      <div>
        <div className="mx-auto flex max-w-[var(--studio-content-width)] gap-2">
          <Button
            type="button"
            variant="brandOutline"
            onClick={showLibraryFeedback}
            aria-label="라이브러리에 담기"
            className="h-12 w-12 shrink-0"
          >
            <FolderPlus aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="brandOutline"
            onClick={(event) => openSample(event.currentTarget)}
            disabled={!hasSample}
            aria-label={hasSample ? '샘플 보기' : '샘플 없음'}
            title={hasSample ? undefined : '이 자료는 제공되는 샘플이 없습니다.'}
            className="h-12 w-12 shrink-0"
          >
            <Eye aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="brand"
            onClick={showGenerateFeedback}
            className="h-12 min-w-0 flex-1 px-3 font-bold"
          >
            <Sparkles aria-hidden="true" />이 자료로 문제 생성
          </Button>
        </div>
        <p className="sr-only" aria-live="polite">
          {feedback === initialFeedback ? '' : feedback}
        </p>
        {feedback !== initialFeedback ? (
          <p className="mt-2 text-center text-[11px] font-semibold leading-4 text-[var(--studio-text)]">
            {feedback}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="sticky top-[144px] rounded-[var(--studio-radius-card)] border border-[var(--studio-border)] bg-[var(--studio-surface)] p-5 shadow-[var(--studio-shadow-card)]">
      <span className="text-xs font-extrabold tracking-[0.08em] text-[var(--studio-primary)]">
        TEACHER ACTION
      </span>
      <h2 className="mt-2 break-keep text-lg font-extrabold text-[var(--studio-ink)]">
        수업 자료로 활용해 보세요
      </h2>
      <p className="mt-2 text-sm leading-6 text-[var(--studio-muted)]">
        지문 1개와 연결 문항 {questionCount}개의 구성을 바탕으로 작업을
        시작합니다.
      </p>
      <div className="mt-5 space-y-2.5">
        <Button
          type="button"
          variant="brand"
          onClick={showGenerateFeedback}
          className="w-full font-bold"
        >
          <Sparkles aria-hidden="true" />이 자료로 문제 생성
        </Button>
        <Button
          type="button"
          variant="brandOutline"
          onClick={showLibraryFeedback}
          className="w-full font-bold"
        >
          <FolderPlus aria-hidden="true" />
          라이브러리에 담기
        </Button>
        <Button
          type="button"
          variant="brandOutline"
          onClick={(event) => openSample(event.currentTarget)}
          disabled={!hasSample}
          title={hasSample ? undefined : '이 자료는 제공되는 샘플이 없습니다.'}
          className="w-full font-bold"
        >
          <Eye aria-hidden="true" />
          {hasSample ? '샘플 보기' : '샘플 없음'}
        </Button>
      </div>
      <p
        aria-live="polite"
        className="mt-4 min-h-12 rounded-[var(--studio-radius-control)] bg-[var(--studio-primary-soft)] px-3 py-2.5 text-xs font-semibold leading-5 text-[var(--studio-text)]"
      >
        {feedback}
      </p>
    </div>
  )
}
