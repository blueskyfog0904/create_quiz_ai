'use client'

import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Download,
  ExternalLink,
  FileText,
  GripVertical,
  Loader2,
  MonitorSmartphone,
  PanelLeft,
  Printer,
  RotateCcw,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  buildExamPaperPrintHtml,
  type ColumnLayout as ExamPaperPdfColumnLayout,
  type ExamPaper as ExamPaperPrintDocument,
  type Question as ExamPaperPdfQuestion,
  type ViewMode as ExamPaperPdfViewMode,
} from '@/lib/export-utils'
import {
  buildSingleColumnExamWithAnswersSeparatedGroups,
  buildSingleColumnQuestionGroups,
} from '@/lib/exam-paper-single-column-layout'
import { measureSingleColumnPreviewPages } from '@/lib/exam-paper-single-column-measurement'
import { buildMeasuredTwoColumnPreviewPages } from '@/lib/exam-paper-two-column-measurement'
import {
  downloadExamPaperHtmlPdf,
  openExamPaperHtmlPdfInNewTab,
} from '@/lib/exam-paper-html-pdf'
import {
  isNoopQuestionInsertion,
  resolveInsertionIndexFromPointer,
  resolveQuestionMoveIndex,
} from '@/lib/exam-paper-pdf-workspace-drag'
import { cn } from '@/lib/utils'

interface ExamPaperPdfWorkspaceProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  examPaper: {
    paper_title: string
    description?: string | null
  }
  initialQuestions: ExamPaperPdfQuestion[]
  initialViewMode: ExamPaperPdfViewMode
  initialColumnLayout?: ExamPaperPdfColumnLayout
}

const EXAM_PAPER_DEBUG_STORAGE_KEY = 'exam-paper-pdf-debug'

type WorkspaceQuestion = ExamPaperPdfQuestion & {
  workspaceId: string
}

function isExamPaperDebugEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const debugWindow = window as typeof window & {
      __EXAM_PAPER_PDF_DEBUG__?: boolean
    }

    return debugWindow.__EXAM_PAPER_PDF_DEBUG__ === true ||
      window.localStorage.getItem(EXAM_PAPER_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function buildWorkspaceQuestionId(question: ExamPaperPdfQuestion, index: number) {
  return [
    'initial',
    index,
    question.number,
    question.questionText.slice(0, 24),
  ].join('-')
}

function toWorkspaceQuestions(initialQuestions: ExamPaperPdfQuestion[]) {
  return renumberWorkspaceQuestions(initialQuestions.map((question, index) => ({
    ...question,
    workspaceId: buildWorkspaceQuestionId(question, index),
  })))
}

function renumberWorkspaceQuestions(questions: WorkspaceQuestion[]) {
  return questions.map((question, index) => ({
    ...question,
    number: index + 1,
  }))
}

function toExamPaperQuestions(questions: WorkspaceQuestion[]): ExamPaperPdfQuestion[] {
  return questions.map((question) => ({
    number: question.number,
    questionText: question.questionText,
    questionTextForward: question.questionTextForward,
    questionTextBackward: question.questionTextBackward,
    passageText: question.passageText,
    choices: question.choices,
    answer: question.answer,
    explanation: question.explanation,
  }))
}

function QuestionDropIndicator() {
  return (
    <div className="pointer-events-none py-1" aria-hidden="true">
      <div className="relative h-1 rounded-full bg-violet-500 shadow-sm shadow-violet-500/30">
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm shadow-violet-500/30">
          여기에 놓기
        </span>
      </div>
    </div>
  )
}

export function ExamPaperPdfWorkspace({
  open,
  onOpenChange,
  examPaper,
  initialQuestions,
  initialViewMode,
  initialColumnLayout = 'single',
}: ExamPaperPdfWorkspaceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [viewMode, setViewMode] = useState<ExamPaperPdfViewMode>(initialViewMode)
  const [columnLayout, setColumnLayout] = useState<ExamPaperPdfColumnLayout>(initialColumnLayout)
  const [questions, setQuestions] = useState<WorkspaceQuestion[]>(() => toWorkspaceQuestions(initialQuestions))
  const [draggingQuestionId, setDraggingQuestionId] = useState<string | null>(null)
  const [dropInsertionIndex, setDropInsertionIndex] = useState<number | null>(null)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)
  const [isSavingPdf, setIsSavingPdf] = useState(false)
  const [isOpeningPdfTab, setIsOpeningPdfTab] = useState(false)
  const [previewHtml, setPreviewHtml] = useState('')

  const exportPayload: ExamPaperPrintDocument = useMemo(() => ({
    title: examPaper.paper_title,
    description: examPaper.description || undefined,
    questions: toExamPaperQuestions(questions),
    viewMode,
    columnLayout,
  }), [columnLayout, examPaper.description, examPaper.paper_title, questions, viewMode])

  const previewTitle = useMemo(() => (
    `${examPaper.paper_title}${viewMode === 'answer-only' ? ' - 답안' : viewMode === 'exam-only' ? ' - 시험지' : ''}${columnLayout === 'double' ? ' (2단)' : ''}`
  ), [columnLayout, examPaper.paper_title, viewMode])

  const syncWorkspaceToLatestProps = useCallback(() => {
    setViewMode(initialViewMode)
    setColumnLayout(initialColumnLayout)
    setQuestions(toWorkspaceQuestions(initialQuestions))
    setDraggingQuestionId(null)
    setDropInsertionIndex(null)
    setIsGeneratingPreview(false)
    setIsOpeningPdfTab(false)
    setIsSavingPdf(false)
    setPreviewHtml('')
  }, [initialColumnLayout, initialQuestions, initialViewMode])

  useEffect(() => {
    if (!open) {
      return
    }

    syncWorkspaceToLatestProps()
  }, [open, syncWorkspaceToLatestProps])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    const abortController = new AbortController()
    setIsGeneratingPreview(true)

    const timeoutId = window.setTimeout(async () => {
      try {
        const measuredPages = columnLayout === 'single'
          ? measureSingleColumnPreviewPages({
            pageTitle: previewTitle,
            description: exportPayload.description,
            questionGroups: viewMode === 'exam-with-answers'
              ? buildSingleColumnExamWithAnswersSeparatedGroups(exportPayload.questions)
              : exportPayload.questions.map((question) => (
                buildSingleColumnQuestionGroups(question, {
                  showQuestions: viewMode !== 'answer-only',
                  showAnswers: viewMode !== 'exam-only',
                })
              )),
            showQuestions: viewMode !== 'answer-only',
            groupAnswerOnlyQuestion: viewMode === 'answer-only',
          })
          : null

        const twoColumnMeasuredPages = columnLayout === 'double'
          ? await buildMeasuredTwoColumnPreviewPages({
            examPaper: exportPayload,
            signal: abortController.signal,
          })
          : null


        const html = buildExamPaperPrintHtml(exportPayload, {
          singleColumnMeasuredPages: measuredPages,
          twoColumnMeasuredPages,
        })
        if (cancelled) return

        setPreviewHtml(html)
      } catch (error) {
        console.error('PDF preview generation error:', error)
        if (!cancelled && !abortController.signal.aborted) {
          toast.error('PDF 미리보기를 갱신하는 중 오류가 발생했습니다.')
        }
      } finally {
        if (!cancelled) {
          setIsGeneratingPreview(false)
        }
      }
    }, 200)

    return () => {
      cancelled = true
      abortController.abort()
      window.clearTimeout(timeoutId)
    }
  }, [columnLayout, exportPayload, open, previewTitle, viewMode])

  const moveQuestion = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return
    }

    setQuestions((current) => {
      if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length) {
        return current
      }

      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return renumberWorkspaceQuestions(next)
    })
  }

  const clearQuestionDragState = useCallback(() => {
    setDraggingQuestionId(null)
    setDropInsertionIndex(null)
  }, [])

  const draggingQuestionIndex = draggingQuestionId === null
    ? -1
    : questions.findIndex((item) => item.workspaceId === draggingQuestionId)

  const shouldShowDropIndicator = (insertionIndex: number) => (
    dropInsertionIndex === insertionIndex &&
    draggingQuestionIndex >= 0 &&
    !isNoopQuestionInsertion(draggingQuestionIndex, insertionIndex)
  )

  const isListEndDropIndicatorVisible = dropInsertionIndex === questions.length &&
    shouldShowDropIndicator(questions.length)

  const updateDropInsertionIndex = (insertionIndex: number) => {
    if (draggingQuestionIndex < 0 || isNoopQuestionInsertion(draggingQuestionIndex, insertionIndex)) {
      setDropInsertionIndex(null)
      return
    }

    setDropInsertionIndex(insertionIndex)
  }

  const handleQuestionDragStart = (
    event: DragEvent<HTMLDivElement>,
    question: WorkspaceQuestion
  ) => {
    event.dataTransfer.effectAllowed = 'move'
    setDraggingQuestionId(question.workspaceId)
    setDropInsertionIndex(null)
  }

  const handleQuestionDragOver = (
    event: DragEvent<HTMLDivElement>,
    index: number
  ) => {
    if (draggingQuestionId === null) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    const rect = event.currentTarget.getBoundingClientRect()
    const insertionIndex = resolveInsertionIndexFromPointer({
      clientY: event.clientY,
      itemTop: rect.top,
      itemHeight: rect.height,
      itemIndex: index,
    })

    updateDropInsertionIndex(insertionIndex)
  }

  const handleQuestionEndDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (draggingQuestionId === null) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    updateDropInsertionIndex(questions.length)
  }

  const handleQuestionDrop = (
    event: DragEvent<HTMLDivElement>,
    insertionIndex: number | null = dropInsertionIndex
  ) => {
    event.preventDefault()

    if (draggingQuestionId === null) {
      clearQuestionDragState()
      return
    }

    const fromIndex = questions.findIndex((item) => item.workspaceId === draggingQuestionId)
    const toIndex = resolveQuestionMoveIndex({
      fromIndex,
      insertionIndex,
      totalCount: questions.length,
    })

    if (toIndex !== null) {
      moveQuestion(fromIndex, toIndex)
    }

    clearQuestionDragState()
  }

  const handleQuestionOrderListDragLeave = (event: DragEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const isStillInsideList =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom

    if (isStillInsideList) {
      return
    }

    setDropInsertionIndex(null)
  }

  const moveQuestionByKeyboard = (index: number, direction: -1 | 1) => {
    moveQuestion(index, index + direction)
  }

  const resetWorkspace = () => {
    syncWorkspaceToLatestProps()
  }

  const assertReadyPreviewHtml = () => {
    if (isGeneratingPreview || !previewHtml) {
      throw new Error('PDF 미리보기가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.')
    }

    return previewHtml
  }

  const handleSavePdf = async () => {
    setIsSavingPdf(true)

    try {
      const html = assertReadyPreviewHtml()
      await downloadExamPaperHtmlPdf({ html, fileName: `${previewTitle}.pdf` })
      toast.success('PDF 파일 다운로드를 시작했습니다.')
    } catch (error) {
      console.error('Direct PDF save error:', error)
      toast.error(error instanceof Error ? error.message : 'PDF 저장 중 오류가 발생했습니다.')
    } finally {
      setIsSavingPdf(false)
    }
  }

  const handleOpenPdfInNewTab = async () => {
    setIsOpeningPdfTab(true)

    try {
      const html = assertReadyPreviewHtml()
      await openExamPaperHtmlPdfInNewTab({ html, fileName: `${previewTitle}.pdf` })
    } catch (error) {
      console.error('Direct PDF new tab error:', error)
      toast.error(error instanceof Error ? error.message : 'PDF 새 탭 열기 중 오류가 발생했습니다.')
    } finally {
      setIsOpeningPdfTab(false)
    }
  }

  const handlePrint = () => {
    try {
      const html = assertReadyPreviewHtml()
      const printWindow = window.open('', '_blank')

      if (!printWindow) {
        throw new Error('팝업이 차단되어 인쇄 창을 열 수 없습니다.')
      }

      printWindow.document.open()
      printWindow.document.write(html.replace('</body>', `
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
              setTimeout(function() { window.close(); }, 300);
            }, 250);
          };
        </script>
      </body>`))
      printWindow.document.close()
      toast.success('인쇄 창을 열었습니다.')
    } catch (error) {
      console.error('Exam paper print preview error:', error)
      toast.error(error instanceof Error ? error.message : '인쇄 창을 여는 중 오류가 발생했습니다.')
    }
  }

  const handlePreviewFrameLoad = useCallback(() => {
    if (!isExamPaperDebugEnabled()) {
      return
    }

    const iframe = iframeRef.current
    const doc = iframe?.contentDocument

    if (!iframe || !doc || columnLayout !== 'double') {
      return
    }

    const diagnostics = [...doc.querySelectorAll('.preview-page')].flatMap((page, pageIndex) => (
      [...page.querySelectorAll('.two-column-column')].flatMap((column, columnIndex) => {
        const columnRect = column.getBoundingClientRect()

        return [...column.querySelectorAll<HTMLElement>('[data-section-id]')].map((section) => {
          const rect = section.getBoundingClientRect()

          return {
            pageIndex,
            columnIndex,
            sectionId: section.dataset.sectionId ?? '',
            sourceSectionId: section.dataset.sourceSectionId ?? '',
            questionNumber: section.dataset.questionNumber ?? '',
            kind: section.dataset.sectionKind ?? '',
            continuationPosition: section.dataset.continuationPosition ?? '',
            fragmentIndex: Number(section.dataset.fragmentIndex ?? '-1'),
            estimatedHeight: Number(section.dataset.estimatedHeight ?? '0'),
            actualHeight: Number(rect.height.toFixed(2)),
            top: Number((rect.top - columnRect.top).toFixed(2)),
            bottom: Number((rect.bottom - columnRect.top).toFixed(2)),
            columnHeight: Number(columnRect.height.toFixed(2)),
            remainingSpace: Number((columnRect.bottom - rect.bottom).toFixed(2)),
            overflowPx: Number(Math.max(0, rect.bottom - columnRect.bottom).toFixed(2)),
          }
        })
      })
    ))

    console.groupCollapsed(`[exam-paper:preview-dom] ${previewTitle}`)
    console.table(diagnostics)
    console.log('full-diagnostics', diagnostics)
    console.groupEnd()
  }, [columnLayout, previewTitle])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] max-w-[96vw] overflow-hidden p-0" showCloseButton={false}>
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <DialogTitle className="text-xl">PDF 저장 설정</DialogTitle>
              <DialogDescription className="mt-1">
                표시 모드, 레이아웃, 문제 순서를 조정하면 오른쪽 PDF 미리보기에 즉시 반영됩니다.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="gap-2" onClick={resetWorkspace}>
                <RotateCcw className="h-4 w-4" />
                초기화
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={isGeneratingPreview || isOpeningPdfTab || isSavingPdf}
                onClick={handleOpenPdfInNewTab}
              >
                {isOpeningPdfTab ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                새 탭에서 열기
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={isGeneratingPreview || !previewHtml}
                onClick={handlePrint}
              >
                <Printer className="h-4 w-4" />
                인쇄
              </Button>
              <Button
                type="button"
                className="gap-2"
                disabled={isGeneratingPreview || isSavingPdf || isOpeningPdfTab}
                onClick={handleSavePdf}
              >
                {isSavingPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                PDF 저장
              </Button>
              <Button type="button" variant="ghost" className="gap-2" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
                닫기
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex h-[calc(92vh-88px)] min-h-0 flex-col lg:flex-row">
          <aside className="w-full shrink-0 border-r bg-muted/20 lg:w-[340px]">
            <div className="h-full overflow-y-auto">
              <div className="space-y-6 p-5">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <PanelLeft className="h-4 w-4 text-primary" />
                      인쇄 설정
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-gray-700">표시모드</p>
                      <div className="grid grid-cols-3 gap-2">
                        {([
                          { value: 'exam-only', label: '시험지' },
                          { value: 'answer-only', label: '답안' },
                          { value: 'exam-with-answers', label: '시험지+답안' },
                        ] as const).map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            variant="outline"
                            className={cn(
                              'h-10 rounded-lg border-slate-200 bg-white text-sm',
                              viewMode === option.value && 'border-primary bg-primary/10 text-primary'
                            )}
                            onClick={() => setViewMode(option.value)}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium text-gray-700">레이아웃</p>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { value: 'single', label: '1단' },
                          { value: 'double', label: '2단' },
                        ] as const).map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            variant="outline"
                            className={cn(
                              'h-10 rounded-lg border-slate-200 bg-white text-sm',
                              columnLayout === option.value && 'border-primary bg-primary/10 text-primary'
                            )}
                            onClick={() => setColumnLayout(option.value)}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-700">문제 순서</p>
                        <span className="text-xs text-muted-foreground" aria-live="polite">
                          {draggingQuestionId === null ? '드래그 후 놓으면 즉시 반영' : '파란 삽입선 위치에 문제가 이동됩니다'}
                        </span>
                      </div>

                      <div
                        className="space-y-1"
                        role="list"
                        onDragLeave={handleQuestionOrderListDragLeave}
                      >
                        {questions.map((question, index) => (
                          <div
                            key={question.workspaceId}
                            role="listitem"
                            aria-label={`${question.number}번 문제 순서 이동`}
                          >
                            {shouldShowDropIndicator(index) ? <QuestionDropIndicator /> : null}
                            <div
                              draggable
                              onDragStart={(event) => handleQuestionDragStart(event, question)}
                              onDragOver={(event) => handleQuestionDragOver(event, index)}
                              onDrop={(event) => handleQuestionDrop(event)}
                              onDragEnd={clearQuestionDragState}
                              className={cn(
                                'flex cursor-grab items-start gap-3 rounded-lg border bg-white px-3 py-3 transition',
                                draggingQuestionId === question.workspaceId && 'scale-[0.98] cursor-grabbing border-primary border-dashed bg-primary/5 opacity-50 shadow-sm'
                              )}
                            >
                              <div className="mt-0.5 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                                {question.number}번
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-sm text-gray-700">{question.questionText}</p>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    disabled={index === 0}
                                    aria-label={`${question.number}번 문제 위로 이동`}
                                    onClick={() => moveQuestionByKeyboard(index, -1)}
                                  >
                                    위로
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    disabled={index === questions.length - 1}
                                    aria-label={`${question.number}번 문제 아래로 이동`}
                                    onClick={() => moveQuestionByKeyboard(index, 1)}
                                  >
                                    아래로
                                  </Button>
                                </div>
                              </div>
                              <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            </div>
                          </div>
                        ))}
                        <div
                          data-drop-zone="question-order-end"
                          onDragOver={handleQuestionEndDragOver}
                          onDrop={(event) => handleQuestionDrop(event, questions.length)}
                          onDragEnd={clearQuestionDragState}
                          className="min-h-3"
                        >
                          {isListEndDropIndicatorVisible ? <QuestionDropIndicator /> : null}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </aside>

          <main className="flex min-w-0 flex-1 flex-col bg-slate-100/80">
            <div className="flex items-center justify-between border-b bg-white px-4 py-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-3">
                <FileText className="h-4 w-4 text-primary" />
                <span className="truncate font-medium text-gray-700">{previewTitle}</span>
              </div>
              <div className="flex items-center gap-3 text-xs sm:text-sm">
                <span className="rounded-full bg-primary/10 px-2.5 py-1 text-primary">{viewMode}</span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{columnLayout === 'double' ? '2단' : '1단'}</span>
              </div>
            </div>

            <div className="relative flex-1 overflow-hidden">
              {isGeneratingPreview ? (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-sm">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="text-center">
                    <p className="font-medium text-gray-900">PDF 미리보기를 갱신하고 있습니다</p>
                    <p className="text-sm text-muted-foreground">설정 변경사항을 반영하는 중입니다.</p>
                  </div>
                </div>
              ) : null}

              {previewHtml ? (
                <iframe
                  ref={iframeRef}
                  title="문제지 출력 미리보기"
                  srcDoc={previewHtml}
                  onLoad={handlePreviewFrameLoad}
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-2xl border bg-white px-6 py-8 text-center shadow-sm">
                    <MonitorSmartphone className="mx-auto mb-3 h-8 w-8 text-primary" />
                    <p className="font-medium text-gray-900">출력 미리보기를 준비 중입니다.</p>
                    <p className="mt-1 text-sm text-muted-foreground">좌측 설정이 적용된 문제지를 오른쪽에서 바로 확인할 수 있습니다.</p>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}
