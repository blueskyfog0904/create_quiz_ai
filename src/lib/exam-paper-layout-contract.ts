import { paginateTwoColumnQuestionChunks } from '@/lib/exam-paper-pdf-pagination.js'

export type ExamPaperLayoutViewMode = 'exam-only' | 'answer-only' | 'exam-with-answers'
export type ExamPaperLayoutColumnLayout = 'single' | 'double'
export type ExamPaperLayoutChunkKind = 'header' | 'body' | 'choice' | 'answer' | 'explanation'

export interface ExamPaperLayoutInput {
  viewMode?: ExamPaperLayoutViewMode
  includeAnswers?: boolean
  columnLayout?: ExamPaperLayoutColumnLayout
}

export interface ExamPaperRenderOptions {
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  showQuestions: boolean
  showAnswers: boolean
  isDoubleColumn: boolean
  titleSuffix: string
  layoutSuffix: string
}

export interface ExamPaperSectionChunk<TPayload> {
  id: string
  estimatedHeight: number
  kind: ExamPaperLayoutChunkKind
  payload: TPayload
}

export interface ExamPaperQuestionPlan<TPayload> {
  questionNumber: number
  sections: ExamPaperSectionChunk<TPayload>[]
}

export interface ExamPaperColumnPlan<TPayload> {
  columnIndex: number
  sectionIds: string[]
  sections: ExamPaperSectionChunk<TPayload>[]
}

export interface ExamPaperPagePlan<TPayload> {
  pageIndex: number
  pageId: string
  columns: [ExamPaperColumnPlan<TPayload>, ExamPaperColumnPlan<TPayload>]
}

export interface ExamPaperLayoutPlan<TPayload> {
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  pages: ExamPaperPagePlan<TPayload>[]
  questions: ExamPaperQuestionPlan<TPayload>[]
}

export function buildExamPaperRenderOptions(examPaper: ExamPaperLayoutInput): ExamPaperRenderOptions {
  const viewMode: ExamPaperLayoutViewMode = examPaper.viewMode ||
    (examPaper.includeAnswers === false ? 'exam-only' : 'exam-with-answers')
  const columnLayout: ExamPaperLayoutColumnLayout = examPaper.columnLayout || 'single'

  return {
    viewMode,
    columnLayout,
    showQuestions: viewMode !== 'answer-only',
    showAnswers: viewMode !== 'exam-only',
    isDoubleColumn: columnLayout === 'double',
    titleSuffix: viewMode === 'answer-only'
      ? ' - 답안'
      : viewMode === 'exam-only'
        ? ' - 시험지'
        : '',
    layoutSuffix: columnLayout === 'double' ? ' (2단)' : '',
  }
}

export function buildExamPaperLayoutPlan<TPayload>({
  questionPlans,
  viewMode,
  columnLayout,
  firstPageSlotCapacity,
  otherPageSlotCapacity,
  slotCapacity,
}: {
  questionPlans: ExamPaperQuestionPlan<TPayload>[]
  viewMode: ExamPaperLayoutViewMode
  columnLayout: ExamPaperLayoutColumnLayout
  firstPageSlotCapacity?: number
  otherPageSlotCapacity?: number
  slotCapacity?: number
}): ExamPaperLayoutPlan<TPayload> {
  if (columnLayout !== 'double') {
    return {
      viewMode,
      columnLayout,
      questions: questionPlans,
      pages: [],
    }
  }

  const paginatedPages = paginateTwoColumnQuestionChunks(
    questionPlans.map((questionPlan) => ({
      questionNumber: questionPlan.questionNumber,
      chunks: questionPlan.sections.map((section) => ({
        ...section,
        node: section.payload,
      })),
    })),
    {
      slotCapacity,
      firstPageSlotCapacity,
      otherPageSlotCapacity,
    }
  )

  return {
    viewMode,
    columnLayout,
    questions: questionPlans,
    pages: paginatedPages.map((page, pageIndex) => ({
      pageIndex,
      pageId: `page-${pageIndex + 1}`,
      columns: [
        {
          columnIndex: 0,
          sectionIds: page.left.map((section) => section.id),
          sections: page.left.map((section) => ({
            id: section.id,
            estimatedHeight: section.estimatedHeight,
            kind: section.kind as ExamPaperLayoutChunkKind,
            payload: section.node as TPayload,
          })),
        },
        {
          columnIndex: 1,
          sectionIds: page.right.map((section) => section.id),
          sections: page.right.map((section) => ({
            id: section.id,
            estimatedHeight: section.estimatedHeight,
            kind: section.kind as ExamPaperLayoutChunkKind,
            payload: section.node as TPayload,
          })),
        },
      ],
    })),
  }
}
