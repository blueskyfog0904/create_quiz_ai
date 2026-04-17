import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import examPaperVfs from '@/lib/exam-paper-pdf-vfs'
import { saveAs } from 'file-saver'
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

function estimateQuestionNodeWeight(question: ExamPaperPdfQuestion, showQuestions: boolean, showAnswers: boolean) {
  let weight = question.questionText.length

  if (showQuestions) {
    weight += question.questionTextForward?.length ?? 0
    weight += question.questionTextBackward?.length ?? 0
    weight += question.passageText?.length ?? 0
    weight += question.choices.reduce((sum, choice) => sum + choice.text.length + choice.label.length, 0)
  }

  if (showAnswers) {
    weight += question.answer.length + question.explanation.length
  }

  return weight
}

function splitQuestionNodesForDoubleColumn<T>(nodes: T[], weights: number[]) {
  const leftColumn: T[] = []
  const rightColumn: T[] = []
  let leftWeight = 0
  let rightWeight = 0

  nodes.forEach((node, index) => {
    if (leftWeight <= rightWeight) {
      leftColumn.push(node)
      leftWeight += weights[index] ?? 0
      return
    }

    rightColumn.push(node)
    rightWeight += weights[index] ?? 0
  })

  return { leftColumn, rightColumn }
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

  const questionWeights = examPaper.questions.map((question) =>
    estimateQuestionNodeWeight(question, showQuestions, showAnswers)
  )

  const questionNodes = examPaper.questions.map((question) => {
    const stack: Array<Record<string, unknown>> = []

    if (showQuestions) {
      stack.push({
        text: `${question.number}. ${question.questionText}`,
        style: 'questionText',
      })

      if (question.questionTextForward) {
        stack.push({
          text: buildInlineSegments(question.questionTextForward),
          style: 'boxedText',
        })
      }

      if (question.passageText) {
        stack.push({
          text: buildInlineSegments(question.passageText),
          style: 'boxedText',
        })
      }

      const normalizedBackward = normalizeQuestionTextBackward(question.questionTextBackward)
      if (normalizedBackward) {
        stack.push({
          text: buildInlineSegments(normalizedBackward),
          style: 'boxedText',
        })
      }

      if (Array.isArray(question.choices) && question.choices.length > 0) {
        stack.push({
          ul: question.choices.map((choice) => `${choice.label} ${choice.text}`),
          margin: [14, 0, 0, 10],
          fontSize: 10,
          lineHeight: 1.4,
        })
      }
    }

    if (showAnswers) {
      stack.push({
        text: `정답: ${question.answer}`,
        style: 'answer',
      })
      stack.push({
        text: `해설: ${question.explanation}`,
        style: 'explanation',
      })
    }

    return {
      stack,
      unbreakable: true,
      margin: [0, 0, 0, 14],
    }
  })

  if (columnLayout === 'double') {
    const { leftColumn, rightColumn } = splitQuestionNodesForDoubleColumn(questionNodes, questionWeights)

    content.push({
      columns: [
        { stack: leftColumn },
        { stack: rightColumn },
      ],
      columnGap: 18,
    })
  } else {
    content.push(...questionNodes)
  }

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
        fontSize: 18,
        bold: true,
        alignment: 'center',
        margin: [0, 0, 0, 8],
      },
      description: {
        fontSize: 10,
        color: '#64748b',
        alignment: 'center',
        margin: [0, 0, 0, 18],
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
