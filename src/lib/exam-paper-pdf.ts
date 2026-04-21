import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import examPaperVfs from '@/lib/exam-paper-pdf-vfs'
import { saveAs } from 'file-saver'
import { paginateTwoColumnQuestionChunks } from '@/lib/exam-paper-pdf-pagination.js'
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

function getExportOptions(examPaper: ExamPaperPdfDocument) {
  const viewMode: ExamPaperPdfViewMode = examPaper.viewMode ||
    (examPaper.includeAnswers === false ? 'exam-only' : 'exam-with-answers')
  const columnLayout: ExamPaperPdfColumnLayout = examPaper.columnLayout || 'single'

  return {
    viewMode,
    columnLayout,
    showQuestions: viewMode !== 'answer-only',
    showAnswers: viewMode !== 'exam-only',
    titleSuffix: viewMode === 'answer-only'
      ? ' - 답안'
      : viewMode === 'exam-only'
        ? ' - 시험지'
        : '',
    layoutSuffix: columnLayout === 'double' ? ' (2단)' : '',
  }
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

function createAnswerSectionLayout() {
  return {
    hLineWidth: () => 0,
    vLineWidth: (index: number) => (index === 0 ? 4 : 0),
    hLineColor: () => '#3b82f6',
    vLineColor: (index: number) => (index === 0 ? '#3b82f6' : '#3b82f6'),
    paddingLeft: () => 12,
    paddingRight: () => 12,
    paddingTop: () => 12,
    paddingBottom: () => 12,
  }
}

function buildDecoratedBoxNode(content: Record<string, unknown>, marginBottom = 8) {
  return {
    table: {
      widths: ['*'],
      body: [[{
        ...content,
        border: [true, true, true, true],
      }]],
    },
    layout: createBoxLayout(),
    margin: [0, 0, 0, marginBottom],
  }
}

function buildAnswerSectionNode(stack: Array<Record<string, unknown>>, marginBottom = 8) {
  return {
    table: {
      widths: ['*'],
      body: [[{
        fillColor: '#f0f9ff',
        border: [true, false, false, false],
        stack,
      }]],
    },
    layout: createAnswerSectionLayout(),
    margin: [0, 0, 0, marginBottom],
  }
}

function buildBoxedTextChunks(questionNumber: number, section: string, text: string | null | undefined) {
  const normalizedText = text?.trim()
  if (!normalizedText) {
    return []
  }

  return [{
    id: `question-body-${questionNumber}-${section}`,
    kind: 'body' as const,
    estimatedHeight: estimateTextHeight(normalizedText, 34, 4.8, 6),
    node: buildDecoratedBoxNode({
      text: buildInlineSegments(normalizedText),
      fontSize: 10,
      lineHeight: 1.45,
      color: '#374151',
    }),
  }]
}

function buildChoiceChunks(question: ExamPaperPdfQuestion) {
  return question.choices.map((choice, index) => {
    const choiceText = `${choice.label} ${choice.text}`

    return {
      id: `question-body-${question.number}-choice-${index}`,
      kind: 'choice' as const,
      estimatedHeight: estimateTextHeight(choiceText, 34, 5, 5),
      node: {
        text: choiceText,
        margin: [0, 0, 0, 6],
        fontSize: 10,
        lineHeight: 1.4,
      },
    }
  })
}

function buildExplanationChunks(questionNumber: number, answer: string, explanation: string) {
  const answerText = answer.trim()
  const explanationText = explanation.trim()
  const stack: Array<Record<string, unknown>> = []

  if (answerText) {
    stack.push({
      text: `정답: ${answerText}`,
      fontSize: 10,
      bold: true,
      color: '#1d4ed8',
      margin: explanationText ? [0, 0, 0, 6] : [0, 0, 0, 0],
    })
  }

  if (explanationText) {
    stack.push({
      text: `해설: ${explanationText}`,
      fontSize: 9,
      color: '#475569',
      lineHeight: 1.8,
    })
  }

  if (stack.length === 0) {
    return []
  }

  return [{
    id: `question-answer-${questionNumber}`,
    kind: 'answer' as const,
    estimatedHeight: estimateTextHeight(`${answerText}\n${explanationText}`.trim(), 40, 4.8, 18),
    node: buildAnswerSectionNode(stack, 10),
  }]
}

function buildQuestionChunksForTwoColumn(
  question: ExamPaperPdfQuestion,
  options: { showQuestions: boolean, showAnswers: boolean }
): PdfPaginationChunk[] {
  const { showQuestions, showAnswers } = options
  const chunks: PdfPaginationChunk[] = []

  if (showQuestions) {
    const headingNode = {
      text: `${question.number}. ${question.questionText}`,
      style: 'questionText',
    }

    const bodyChunks = [
      ...buildBoxedTextChunks(question.number, 'forward', question.questionTextForward),
      ...(question.passageText
        ? [{
          id: `question-body-${question.number}-passage`,
          kind: 'body' as const,
          estimatedHeight: estimateTextHeight(question.passageText.trim(), 34, 4.8, 6),
          node: buildDecoratedBoxNode({
            text: buildInlineSegments(question.passageText.trim()),
            fontSize: 10,
            lineHeight: 1.45,
            color: '#374151',
          }),
        }]
        : []),
      ...buildBoxedTextChunks(
        question.number,
        'backward',
        normalizeQuestionTextBackward(question.questionTextBackward)
      ),
      ...buildChoiceChunks(question),
    ]

    const [firstBodyChunk, ...remainingBodyChunks] = bodyChunks
    const anchorStack = firstBodyChunk
      ? [headingNode, firstBodyChunk.node]
      : [headingNode]

    const anchorHeight = estimateTextHeight(question.questionText, 30, 6, 10) +
      (firstBodyChunk?.estimatedHeight ?? 0)

    chunks.push({
      id: `question-body-${question.number}-anchor`,
      kind: 'header',
      estimatedHeight: anchorHeight,
      node: {
        id: `question-body-${question.number}`,
        stack: anchorStack,
        unbreakable: true,
        margin: [0, 0, 0, 8],
      },
    })

    chunks.push(...remainingBodyChunks)
  }

  if (showAnswers) {
    chunks.push(...buildExplanationChunks(question.number, question.answer, question.explanation))
  }

  return chunks
}

function buildPdfDocumentDefinition(examPaper: ExamPaperPdfDocument) {
  const {
    showQuestions,
    showAnswers,
    columnLayout,
    titleSuffix,
    layoutSuffix,
  } = getExportOptions(examPaper)

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
    const paginatedPages = paginateTwoColumnQuestionChunks(
      examPaper.questions.map((question) => ({
        questionNumber: question.number,
        chunks: buildQuestionChunksForTwoColumn(question, {
          showQuestions,
          showAnswers,
        }),
      })),
      {
        firstPageSlotCapacity: examPaper.description ? 220 : 245,
        otherPageSlotCapacity: 280,
      }
    )

    paginatedPages.forEach((page, index) => {
      content.push({
        columns: [
          {
            stack: page.left.map((chunk) => chunk.node),
          },
          {
            stack: page.right.map((chunk) => chunk.node),
          },
        ],
        columnGap: 18,
        ...(index < paginatedPages.length - 1 ? { pageBreak: 'after' } : {}),
      })
    })

    return {
      pageSize: 'A4',
      pageMargins: [36, 40, 36, 40],
      content,
      defaultStyle: {
        font: 'Pretendard',
        fontSize: 11,
        lineHeight: 1.45,
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
          fontSize: 11,
          bold: true,
          margin: [0, 0, 0, 8],
        },
        boxedText: {
          fontSize: 10,
          lineHeight: 1.45,
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
            fontSize: 10,
            lineHeight: 1.45,
            color: '#374151',
          }, 10),
        })
      }

      if (question.passageText) {
        stack.push({
          ...buildDecoratedBoxNode({
            text: buildInlineSegments(question.passageText),
            fontSize: 10,
            lineHeight: 1.45,
            color: '#374151',
          }, 10),
        })
      }

      const normalizedBackward = normalizeQuestionTextBackward(question.questionTextBackward)
      if (normalizedBackward) {
        stack.push({
          ...buildDecoratedBoxNode({
            text: buildInlineSegments(normalizedBackward),
            fontSize: 10,
            lineHeight: 1.45,
            color: '#374151',
          }, 10),
        })
      }

      if (Array.isArray(question.choices) && question.choices.length > 0) {
        stack.push({
          stack: question.choices.map((choice) => ({
            text: `${choice.label} ${choice.text}`,
            margin: [0, 0, 0, 6],
            fontSize: 10,
            lineHeight: 1.4,
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
      lineHeight: 1.45,
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
        fontSize: 11,
        bold: true,
        margin: [0, 0, 0, 8],
      },
      boxedText: {
        fontSize: 10,
        lineHeight: 1.45,
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
  const { titleSuffix, layoutSuffix } = getExportOptions(examPaper)
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
