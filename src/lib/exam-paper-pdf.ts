import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import examPaperVfs from '@/lib/exam-paper-pdf-vfs'
import { saveAs } from 'file-saver'
import {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnLayoutPlan,
  type TwoColumnFragmentPlan,
  type TwoColumnChoiceFragmentPayload,
} from '@/lib/exam-paper-layout-contract'
import {
  buildSingleColumnQuestionGroups,
  buildSingleColumnPlacementSteps,
  type SingleColumnBlock,
} from '@/lib/exam-paper-single-column-layout'
import {
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

function buildPlainAnswerTextStack({
  questionLabel,
  answerText,
  explanationText,
  showAnswerLabel = true,
}: {
  questionLabel?: string
  answerText?: string
  explanationText?: string
  showAnswerLabel?: boolean
}) {
  const stack: Array<Record<string, unknown>> = []

  if (questionLabel) {
    stack.push({
      text: questionLabel,
      fontSize: 16,
      bold: true,
      color: '#111',
      margin: [0, 0, 0, 6],
    })
  }

  if (answerText) {
    stack.push({
      text: `정답: ${answerText}`,
      fontSize: 12,
      bold: true,
      color: '#111',
      margin: explanationText ? [0, 0, 0, 4] : [0, 0, 0, 0],
    })
  }

  if (explanationText) {
    stack.push({
      text: `${showAnswerLabel ? '해설: ' : ''}${explanationText}`,
      fontSize: 12,
      color: '#111',
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

    return {
      stack: [{
        text: buildInlineSegments(bodyText),
        fontSize: 13,
        lineHeight: 1.8,
        color: '#374151',
      }],
      margin: [0, 0, 0, sectionPlan.continuationPosition === 'single' || sectionPlan.continuationPosition === 'end' ? 12 : 0],
    }
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

    return {
      stack: buildPlainAnswerTextStack({
        questionLabel: answerPayload?.questionLabel,
        answerText: answerPayload?.showAnswerLabel ? answerPayload.answerText : undefined,
        explanationText: answerPayload?.explanationText,
        showAnswerLabel: answerPayload?.showAnswerLabel ?? true,
      }),
      margin: [0, 0, 0, 10],
    }
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

function renderSingleColumnBlockNode(block: SingleColumnBlock): Record<string, unknown> {
  if (block.kind === 'header' && block.payload.type === 'header') {
    return {
      text: `${block.questionNumber}. ${block.payload.text}`,
      style: 'questionText',
    }
  }

  if (block.kind === 'body' && block.payload.type === 'body') {
    return {
      stack: [{
        text: buildInlineSegments(block.payload.text),
        fontSize: 13,
        lineHeight: 1.8,
        color: '#374151',
      }],
      margin: [0, 0, 0, 10],
    }
  }

  if (block.kind === 'choice-row' && block.payload.type === 'choice-row') {
    return {
      text: `${block.payload.label} ${block.payload.text}`,
      margin: [0, 0, 0, 0],
      fontSize: 13,
      lineHeight: 1.8,
    }
  }

  if (block.kind === 'answer' && block.payload.type === 'answer') {
    return {
      stack: buildPlainAnswerTextStack({
        questionLabel: block.payload.questionLabel,
        answerText: block.payload.answerText,
        explanationText: block.payload.explanationText,
        showAnswerLabel: block.payload.showAnswerLabel,
      }),
    }
  }

  return { text: '' }
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

  const singleColumnNodes = examPaper.questions.flatMap((question, questionIndex) => {
    const groups = buildSingleColumnQuestionGroups(question, {
      showQuestions,
      showAnswers,
    })
    const placementSteps = buildSingleColumnPlacementSteps(groups, {
      groupAnswerOnlyQuestion: !showQuestions && showAnswers,
    })

    return placementSteps.flatMap((step, stepIndex) => {
      if (step.type === 'atomic-group') {
        if (step.blocks.length === 0) {
          return []
        }

        return [{
          stack: step.blocks.map((block) => renderSingleColumnBlockNode(block)),
          unbreakable: true,
          margin: [0, questionIndex === 0 && stepIndex === 0 ? 0 : 14, 0, 8],
        }]
      }

      return step.blocks.map((block, index) => ({
        ...renderSingleColumnBlockNode(block),
        margin: [0, 0, 0, index === step.blocks.length - 1 ? 10 : 0],
      }))
    })
  })

  content.push(...singleColumnNodes)

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
