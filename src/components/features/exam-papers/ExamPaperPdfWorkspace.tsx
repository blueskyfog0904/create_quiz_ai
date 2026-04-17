'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Download,
  ExternalLink,
  FileText,
  GripVertical,
  Loader2,
  MonitorSmartphone,
  PanelLeft,
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
  buildExamPaperPdfBlob,
  buildExamPaperPdfFileName,
  downloadExamPaperPdf,
  openExamPaperPdfInNewTab,
  type ExamPaperPdfColumnLayout,
  type ExamPaperPdfDocument,
  type ExamPaperPdfQuestion,
  type ExamPaperPdfViewMode,
} from '@/lib/exam-paper-pdf'
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

function renumberQuestions(questions: ExamPaperPdfQuestion[]) {
  return questions.map((question, index) => ({
    ...question,
    number: index + 1,
  }))
}

export function ExamPaperPdfWorkspace({
  open,
  onOpenChange,
  examPaper,
  initialQuestions,
  initialViewMode,
  initialColumnLayout = 'single',
}: ExamPaperPdfWorkspaceProps) {
  const [viewMode, setViewMode] = useState<ExamPaperPdfViewMode>(initialViewMode)
  const [columnLayout, setColumnLayout] = useState<ExamPaperPdfColumnLayout>(initialColumnLayout)
  const [questions, setQuestions] = useState<ExamPaperPdfQuestion[]>(() => renumberQuestions(initialQuestions))
  const [draggingQuestionId, setDraggingQuestionId] = useState<number | null>(null)
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null)

  const exportPayload: ExamPaperPdfDocument = useMemo(() => ({
    title: examPaper.paper_title,
    description: examPaper.description || undefined,
    questions,
    viewMode,
    columnLayout,
  }), [columnLayout, examPaper.description, examPaper.paper_title, questions, viewMode])

  const pdfFileName = useMemo(() => buildExamPaperPdfFileName(exportPayload), [exportPayload])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setIsGeneratingPreview(true)

      try {
        const blob = await buildExamPaperPdfBlob(exportPayload)
        if (cancelled) return

        setPdfBlob(blob)
        setPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current)
          }

          return URL.createObjectURL(blob)
        })
      } catch (error) {
        console.error('PDF preview generation error:', error)
        if (!cancelled) {
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
      window.clearTimeout(timeoutId)
    }
  }, [exportPayload, open])

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const moveQuestion = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) {
      return
    }

    setQuestions((current) => {
      const next = [...current]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return renumberQuestions(next)
    })
  }

  const resetWorkspace = () => {
    setViewMode(initialViewMode)
    setColumnLayout(initialColumnLayout)
    setQuestions(renumberQuestions(initialQuestions))
    setDraggingQuestionId(null)
  }

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
                onClick={async () => {
                  await openExamPaperPdfInNewTab(exportPayload)
                }}
              >
                <ExternalLink className="h-4 w-4" />
                새 탭에서 열기
              </Button>
              <Button
                type="button"
                className="gap-2"
                disabled={!pdfBlob || isGeneratingPreview}
                onClick={async () => {
                  if (!pdfBlob) return
                  await downloadExamPaperPdf(pdfBlob, pdfFileName)
                  toast.success('PDF 파일이 다운로드되었습니다.')
                }}
              >
                <Download className="h-4 w-4" />
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
                        <span className="text-xs text-muted-foreground">드래그 후 놓으면 즉시 반영</span>
                      </div>

                      <div className="space-y-2">
                        {questions.map((question, index) => (
                          <div
                            key={question.number}
                            draggable
                            onDragStart={() => setDraggingQuestionId(question.number)}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => {
                              if (draggingQuestionId === null) return
                              const fromIndex = questions.findIndex((item) => item.number === draggingQuestionId)
                              moveQuestion(fromIndex, index)
                              setDraggingQuestionId(null)
                            }}
                            onDragEnd={() => setDraggingQuestionId(null)}
                            className={cn(
                              'flex cursor-grab items-start gap-3 rounded-lg border bg-white px-3 py-3 transition',
                              draggingQuestionId === question.number && 'border-primary bg-primary/5 shadow-sm'
                            )}
                          >
                            <div className="mt-0.5 rounded-full bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
                              {question.number}번
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-sm text-gray-700">{question.questionText}</p>
                            </div>
                            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          </div>
                        ))}
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
                <span className="truncate font-medium text-gray-700">{pdfFileName}</span>
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

              {previewUrl ? (
                <iframe
                  title="문제지 PDF 미리보기"
                  src={previewUrl}
                  className="h-full w-full border-0"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <div className="rounded-2xl border bg-white px-6 py-8 text-center shadow-sm">
                    <MonitorSmartphone className="mx-auto mb-3 h-8 w-8 text-primary" />
                    <p className="font-medium text-gray-900">PDF 미리보기를 준비 중입니다.</p>
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
