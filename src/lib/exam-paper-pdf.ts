import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import examPaperVfs from '@/lib/exam-paper-pdf-vfs'
import { saveAs } from 'file-saver'
import {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnLayoutPlan,
  type TwoColumnFragmentPlan,
  type TwoColumnAnswerFragmentPayload,
  type TwoColumnChoiceFragmentPayload,
} from '@/lib/exam-paper-layout-contract'
import {
  normalizeQuestionTextBackward,
  splitBracketUnderlineSegments,
} from '@/lib/questions/normalize-question-field'

type PdfMakeWithVfs = typeof pdfMake & {
  vfs?: Record<string, string>
  fonts?: Record<string, {
    normal: string
    bold: string
    italics: string
    bolditalics: string
  }>
}

type PdfFontsModule = {
  pdfMake?: { vfs?: Record<string, string> }
  default?: {
    pdfMake?: { vfs?: Record<string, string> }
  }
}

const pdfMakeWithVfs = pdfMake as PdfMakeWithVfs
const pdfFontsModule = pdfFonts as PdfFontsModule

if (pdfFontsModule.pdfMake?.vfs) {
  pdfMakeWithVfs.vfs = pdfFontsModule.pdfMake.vfs
} else if (pdfFontsModule.default?.pdfMake?.vfs) {
  pdfMakeWithVfs.vfs = pdfFontsModule.default.pdfMake.vfs
}

pdfMakeWithVfs.vfs = {
  ...(pdfMakeWithVfs.vfs ?? {}),
  ...(examPaperVfs as Record<string, string>),
}

pdfMakeWithVfs.fonts = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
  Pretendard: {
    normal: 'Pretendard-Regular.ttf',
    bold: 'Pretendard-Bold.ttf',
    italics: 'Pretendard-Regular.ttf',
    bolditalics: 'Pretendard-Bold.ttf',
  },
}

export type ExamPaperPdfViewMode = 'exam-only' | 'answer-only' | 'exam-with-answers'
export type ExamPaperPdfColumnLayout = 'single' | 'double'

export interface ExamPaperPdfChoice {
  label: string
  text: string
}

export interface ExamPaperPdfQuestion {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices: ExamPaperPdfChoice[]
  answer: string
  explanation: string
}

export interface ExamPaperPdfDocument {
  title: string
  description?: string
  questions: ExamPaperPdfQuestion[]
  viewMode?: ExamPaperPdfViewMode
  columnLayout?: ExamPaperPdfColumnLayout
  includeAnswers?: boolean
}

type PdfPaginationChunk = {
  id: string
  estimatedHeight: number
  kind: 'header' | 'body' | 'choice' | 'answer' | 'explanation'
  node: Record<string, unknown>
}

function buildInlineSegments(text: string | null | undefined) {
  if (!text) {
    return []
  }

  return splitBracketUnderlineSegments(text).map((segment) => (
    segment.type === 'underline'
      ? { text: segment.value, decoration: 'underline' as const }
      : { text: segment.value }
  ))
}

function estimateTextHeight(text: string, charsPerLine: number, lineHeight: number, base = 0) {
  const normalized = text.trim()
  if (!normalized) {
    return base
  }

  const lineCount = normalized
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0)

  return base + (lineCount * lineHeight)
}

function createBoxLayout(borderColor = '#9ca3af') {
  return {
    hLineWidth: () => 1,
    vLineWidth: () => 1,
    hLineColor: () => borderColor,
    vLineColor: () => borderColor,
    paddingLeft: () => 10,
    paddingRight: () => 15,
    paddingTop: () => 10,
    paddingBottom: () => 10,
  }
}

function createAnswerSectionLayout(paddingTop = 12) {
  return {
    hLineWidth: () => 0,
    vLineWidth: (index: number) => (index === 0 ? 4 : 0),
    hLineColor: () => '#3b82f6',
    vLineColor: (index: number) => (index === 0 ? '#3b82f6' : '#3b82f6'),
    paddingLeft: () => 12,
    paddingRight: () => 12,
    paddingTop: () => paddingTop,
    paddingBottom: () => 12,
  }
}

function buildDecoratedBoxNode(
  content: Record<string, unknown>,
  marginBottom = 8,
  border: [boolean, boolean, boolean, boolean] = [true, true, true, true]
) {
  return {
    table: {
      widths: ['*'],
      body: [[{
        ...content,
        border,
      }]],
    },
    layout: createBoxLayout(),
    margin: [0, 0, 0, marginBottom],
  }
}

function buildAnswerSectionNode(
  stack: Array<Record<string, unknown>>,
  marginBottom = 8,
  paddingTop = 12
) {
  return {
    table: {
      widths: ['*'],
      body: [[{
        fillColor: '#f0f9ff',
        border: [true, false, false, false],
        stack,
      }]],
    },
    layout: createAnswerSectionLayout(paddingTop),
    margin: [0, 0, 0, marginBottom],
  }
}

function buildChoiceRows(rows: ExamPaperPdfChoice[]) {
  return rows.map((choice, index) => {
    const choiceText = `${choice.label} ${choice.text}`

    return {
      id: `choice-row-${index}`,
      kind: 'choice' as const,
      estimatedHeight: estimateTextHeight(choiceText, 34, 5, 5),
      node: {
        text: choiceText,
        margin: [0, 0, 0, 0],
        fontSize: 13,
        lineHeight: 1.8,
      },
    }
  })
}

function buildAnswerFragmentStack(payload: TwoColumnAnswerFragmentPayload) {
  const stack: Array<Record<string, unknown>> = []

  if (payload.showAnswerLabel && payload.answerText) {
    stack.push({
      text: `정답: ${payload.answerText}`,
      fontSize: 10,
      bold: true,
      color: '#1d4ed8',
      margin: payload.explanationText ? [0, 0, 0, 6] : [0, 0, 0, 0],
    })
  }

  if (payload.explanationText) {
    stack.push({
      text: `${payload.showAnswerLabel ? '해설' : '해설 (계속)'}: ${payload.explanationText}`,
      fontSize: 9,
      color: '#475569',
      lineHeight: 1.8,
    })
  }

  return stack
}

function renderSectionPdfNode(
  sectionPlan: TwoColumnFragmentPlan
): Record<string, unknown> {
  if (sectionPlan.kind === 'header') {
    const headerText = sectionPlan.payload.type === 'header'
      ? sectionPlan.payload.text
      : ''

    return {
      id: `question-body-${sectionPlan.questionNumber}-header`,
      text: `${sectionPlan.questionNumber}. ${headerText}`,
      style: 'questionText',
      margin: [0, 0, 0, 12],
    }
  }

  if (sectionPlan.kind === 'body') {
    const bodyText = sectionPlan.payload.type === 'body'
      ? sectionPlan.payload.text
      : ''
    const border: [boolean, boolean, boolean, boolean] = sectionPlan.continuationPosition === 'single'
      ? [true, true, true, true]
      : sectionPlan.continuationPosition === 'start'
        ? [true, true, true, false]
        : sectionPlan.continuationPosition === 'middle'
          ? [true, false, true, false]
          : [true, false, true, true]

    return buildDecoratedBoxNode({
      text: buildInlineSegments(bodyText),
      fontSize: 13,
      lineHeight: 1.8,
      color: '#374151',
    }, sectionPlan.continuationPosition === 'single' || sectionPlan.continuationPosition === 'end' ? 8 : 0, border)
  }

  if (sectionPlan.kind === 'choice') {
    const choicePayload = sectionPlan.payload.type === 'choice'
      ? sectionPlan.payload
      : {
        type: 'choice',
        rows: [],
        choiceStartIndex: 0,
        choiceEndIndex: -1,
      } satisfies TwoColumnChoiceFragmentPayload

    return {
      stack: buildChoiceRows(choicePayload.rows).map((chunk) => chunk.node),
    }
  }

  if (sectionPlan.kind === 'answer') {
    const answerPayload = sectionPlan.payload.type === 'answer'
      ? sectionPlan.payload
      : null

    return buildAnswerSectionNode(
      answerPayload ? buildAnswerFragmentStack(answerPayload) : [],
      sectionPlan.continuationPosition === 'single' || sectionPlan.continuationPosition === 'end' ? 10 : 0,
      sectionPlan.continuationPosition === 'single' || sectionPlan.continuationPosition === 'start' ? 12 : 6
    )
  }

  return { text: '' }
}

function buildQuestionChunksForTwoColumn(
  sections: TwoColumnFragmentPlan[]
): PdfPaginationChunk[] {
  return sections.map((sectionPlan) => ({
    id: sectionPlan.id,
    kind: sectionPlan.kind,
    estimatedHeight: sectionPlan.estimatedUnits,
    node: renderSectionPdfNode(sectionPlan),
  }))
}

function buildPdfDocumentDefinition(examPaper: ExamPaperPdfDocument) {
  const {
    viewMode,
    columnLayout,
    showQuestions,
    showAnswers,
    titleSuffix,
    layoutSuffix,
  } = buildExamPaperRenderOptions(examPaper)

  const content: Array<Record<string, unknown>> = [
    {
      text: `${examPaper.title}${titleSuffix}${layoutSuffix}`,
      style: 'title',
    },
  ]

  if (examPaper.description) {
    content.push({
      text: examPaper.description,
      style: 'description',
    })
  }

  if (columnLayout === 'double') {
    const questionPlans = examPaper.questions.map((question) =>
      buildQuestionSectionPlan(question, {
        viewMode,
        columnLayout,
        showQuestions,
        showAnswers,
        isDoubleColumn: true,
        titleSuffix,
        layoutSuffix,
      })
    )
    // Shared two-column parity path: buildTwoColumnLayoutPlan supersedes the older
    // buildExamPaperLayoutPlan-only PDF pagination lane while keeping local node rendering.
    const layoutPlan = buildTwoColumnLayoutPlan({
      questionPlans,
      profile: 'shared-default',
      target: 'pdf',
      hasDescription: Boolean(examPaper.description),
    })
    const questionChunkMap = new Map(
      layoutPlan.pages.flatMap((page) => (
        page.columns.flatMap((column) => (
          buildQuestionChunksForTwoColumn(
            column.sections.map((section) => section.payload)
          ).map((chunk) => [chunk.id, chunk] as const)
        ))
      ))
    )

    layoutPlan.pages.forEach((page, index) => {
      content.push({
        columns: [
          {
            stack: page.columns[0].sectionIds
              .map((sectionId) => questionChunkMap.get(sectionId)?.node)
              .filter((node): node is Record<string, unknown> => Boolean(node)),
          },
          {
            stack: page.columns[1].sectionIds
              .map((sectionId) => questionChunkMap.get(sectionId)?.node)
              .filter((node): node is Record<string, unknown> => Boolean(node)),
          },
        ],
        columnGap: 18,
        ...(index < layoutPlan.pages.length - 1 ? { pageBreak: 'after' } : {}),
      })
    })

    return {
      pageSize: 'A4',
      pageMargins: [36, 40, 36, 40],
      content,
      defaultStyle: {
        font: 'Pretendard',
        fontSize: 11,
        lineHeight: 1.5,
      },
      styles: {
        title: {
          fontSize: 24,
          bold: true,
          alignment: 'center',
          margin: [0, 0, 0, 10],
        },
        description: {
          fontSize: 14,
          color: '#64748b',
          alignment: 'center',
          margin: [0, 0, 0, 30],
        },
        questionText: {
          fontSize: 14,
          bold: true,
          margin: [0, 0, 0, 12],
        },
        boxedText: {
          fontSize: 13,
          lineHeight: 1.8,
          margin: [0, 0, 0, 10],
        },
        answer: {
          fontSize: 10,
          bold: true,
          color: '#1d4ed8',
          margin: [0, 4, 0, 4],
        },
        explanation: {
          fontSize: 9,
          color: '#475569',
        },
      },
    } as unknown as import('pdfmake/interfaces').TDocumentDefinitions
  }

  const keepQuestionTogether = columnLayout === 'single'

  const questionNodes = examPaper.questions.map((question) => {
    const stack: Array<Record<string, unknown>> = []

    if (showQuestions) {
      stack.push({
        text: `${question.number}. ${question.questionText}`,
        style: 'questionText',
      })

      if (question.questionTextForward) {
        stack.push({
          ...buildDecoratedBoxNode({
            text: buildInlineSegments(question.questionTextForward),
            fontSize: 13,
            lineHeight: 1.8,
            color: '#374151',
          }, 10),
        })
      }

      if (question.passageText) {
        stack.push({
          ...buildDecoratedBoxNode({
            text: buildInlineSegments(question.passageText),
            fontSize: 13,
            lineHeight: 1.8,
            color: '#374151',
          }, 10),
        })
      }

      const normalizedBackward = normalizeQuestionTextBackward(question.questionTextBackward)
      if (normalizedBackward) {
        stack.push({
          ...buildDecoratedBoxNode({
            text: buildInlineSegments(normalizedBackward),
            fontSize: 13,
            lineHeight: 1.8,
            color: '#374151',
          }, 10),
        })
      }

      if (Array.isArray(question.choices) && question.choices.length > 0) {
        stack.push({
          stack: question.choices.map((choice) => ({
            text: `${choice.label} ${choice.text}`,
            margin: [0, 0, 0, 8],
            fontSize: 13,
            lineHeight: 1.8,
          })),
          margin: [0, 0, 0, 10],
        })
      }
    }

    if (showAnswers) {
      stack.push({
        ...buildAnswerSectionNode([
          {
            text: `정답: ${question.answer}`,
            fontSize: 10,
            bold: true,
            color: '#1d4ed8',
            margin: [0, 0, 0, 6],
          },
          {
            text: `해설: ${question.explanation}`,
            fontSize: 9,
            color: '#475569',
            lineHeight: 1.8,
          },
        ], 12),
      })
    }

    return {
      stack,
      unbreakable: keepQuestionTogether,
      margin: [0, 0, 0, 14],
    }
  })

  content.push(...questionNodes)

  return {
    pageSize: 'A4',
    pageMargins: [36, 40, 36, 40],
    content,
    defaultStyle: {
      font: 'Pretendard',
      fontSize: 11,
      lineHeight: 1.5,
    },
    styles: {
      title: {
        fontSize: 24,
        bold: true,
        alignment: 'center',
        margin: [0, 0, 0, 10],
      },
      description: {
        fontSize: 14,
        color: '#64748b',
        alignment: 'center',
        margin: [0, 0, 0, 30],
      },
      questionText: {
        fontSize: 14,
        bold: true,
        margin: [0, 0, 0, 12],
      },
      boxedText: {
        fontSize: 13,
        lineHeight: 1.8,
        margin: [0, 0, 0, 10],
      },
      answer: {
        fontSize: 10,
        bold: true,
        color: '#1d4ed8',
        margin: [0, 4, 0, 4],
      },
      explanation: {
        fontSize: 9,
        color: '#475569',
      },
    },
  } as unknown as import('pdfmake/interfaces').TDocumentDefinitions
}

export function buildExamPaperPdfFileName(examPaper: ExamPaperPdfDocument) {
  const { titleSuffix, layoutSuffix } = buildExamPaperRenderOptions(examPaper)
  return `${examPaper.title}${titleSuffix}${layoutSuffix}.pdf`
}

export async function buildExamPaperPdfBlob(examPaper: ExamPaperPdfDocument): Promise<Blob> {
  const docDefinition = buildPdfDocumentDefinition(examPaper)

  return await new Promise<Blob>((resolve, reject) => {
    pdfMakeWithVfs.createPdf(docDefinition).getBlob((blob: Blob | null) => {
      if (!blob) {
        reject(new Error('PDF blob 생성에 실패했습니다.'))
        return
      }

      resolve(blob)
    })
  })
}

export async function downloadExamPaperPdf(blob: Blob, fileName: string) {
  saveAs(blob, fileName)
}

export async function openExamPaperPdfInNewTab(examPaper: ExamPaperPdfDocument) {
  const blob = await buildExamPaperPdfBlob(examPaper)
  const blobUrl = URL.createObjectURL(blob)
  const previewWindow = window.open(blobUrl, '_blank')

  if (!previewWindow) {
    URL.revokeObjectURL(blobUrl)
    throw new Error('팝업 차단으로 인해 PDF 미리보기 창을 열 수 없습니다. 팝업을 허용해주세요.')
  }

  setTimeout(() => URL.revokeObjectURL(blobUrl), 5 * 60 * 1000)
  return {
    blob,
    blobUrl,
  }
}
