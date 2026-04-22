import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, UnderlineType } from 'docx'
import { saveAs } from 'file-saver'
import {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnLayoutPlan,
} from '@/lib/exam-paper-layout-contract'
import {
  buildSingleColumnQuestionGroups,
  paginateSingleColumnQuestionGroups,
  type SingleColumnBlock,
  type SingleColumnPagePlan,
} from '@/lib/exam-paper-single-column-layout'
import type {
  ExamPaperRenderOptions,
  ExamPaperSectionChunk,
  TwoColumnAnswerFragmentPayload,
  TwoColumnChoiceFragmentPayload,
  TwoColumnFragmentPlan,
} from '@/lib/exam-paper-layout-contract'
import {
  normalizeQuestionTextBackward,
  splitBracketUnderlineSegments,
} from '@/lib/questions/normalize-question-field'

type PdfMakeWithVfs = typeof pdfMake & {
  vfs?: { [file: string]: string }
  fonts?: Record<string, {
    normal: string
    bold: string
    italics: string
    bolditalics: string
  }>
}

type PdfFontsModule = {
  pdfMake?: { vfs?: { [file: string]: string } }
  default?: {
    pdfMake?: { vfs?: { [file: string]: string } }
  }
}

const pdfMakeWithVfs = pdfMake as PdfMakeWithVfs
const pdfFontsModule = pdfFonts as PdfFontsModule

// Register fonts
if (pdfFontsModule.pdfMake?.vfs) {
  pdfMakeWithVfs.vfs = pdfFontsModule.pdfMake.vfs
} else if (pdfFontsModule.default?.pdfMake?.vfs) {
  pdfMakeWithVfs.vfs = pdfFontsModule.default.pdfMake.vfs
}

// Add Korean font support using system fonts
pdfMakeWithVfs.fonts = {
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf'
  },
  // Use Noto Sans for better Unicode support including Korean
  NotoSans: {
    normal: 'Roboto-Regular.ttf', // Fallback to Roboto for now
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf'
  }
}

export interface Choice {
  label: string
  text: string
}

export interface Question {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices: Choice[]
  answer: string
  explanation: string
}

export type ViewMode = 'exam-only' | 'answer-only' | 'exam-with-answers'
export type ColumnLayout = 'single' | 'double'

export interface ExamPaper {
  title: string
  description?: string
  questions: Question[]
  viewMode?: ViewMode
  columnLayout?: ColumnLayout
  includeAnswers?: boolean  // deprecated, use viewMode instead
}

interface ExamPaperPrintPreviewOptions {
  autoPrint?: boolean
  closeAfterPrint?: boolean
  singleColumnMeasuredPages?: SingleColumnPagePlan[] | null
}

interface HtmlPaginationChunk {
  id: string
  estimatedHeight: number
  kind: 'header' | 'body' | 'choice' | 'answer' | 'explanation'
  html: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineBracketUnderlineHtml(text: string | null | undefined): string {
  if (!text) return ''

  return splitBracketUnderlineSegments(text)
    .map((segment) => {
      const escaped = escapeHtml(segment.value).replace(/\n/g, '<br>')

      if (segment.type === 'underline') {
        return `<span style="text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 3px; font-weight: normal;">${escaped}</span>`
      }

      return escaped
    })
    .join('')
}

function createInlineBracketUnderlineRuns(text: string | null | undefined): TextRun[] {
  if (!text) {
    return [new TextRun('')]
  }

  const runs: TextRun[] = []
  let needsBreakBeforeNextLine = false

  splitBracketUnderlineSegments(text).forEach((segment) => {
    const lines = segment.value.split('\n')

    lines.forEach((line, index) => {
      const shouldBreak = needsBreakBeforeNextLine || index > 0

      runs.push(
        new TextRun({
          text: line,
          break: shouldBreak ? 1 : undefined,
          underline: segment.type === 'underline'
            ? { type: UnderlineType.SINGLE }
            : undefined,
        })
      )
    })

    needsBreakBeforeNextLine = segment.value.endsWith('\n')
  })

  return runs.length > 0 ? runs : [new TextRun('')]
}

function renderQuestionChoicesHtml(choices: Choice[]) {
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }

  return `
    <div class="choices">
      ${choices.map((choice) => `
        <div class="choice">
          <span class="choice-label">${escapeHtml(choice.label)}</span>${escapeHtml(choice.text)}
        </div>
      `).join('')}
    </div>
  `
}

function renderAnswerPanelHtml(
  {
    answerText,
    explanationText,
  }: {
    answerText: string
    explanationText: string
  },
  showQuestions: boolean
) {
  return `
    <div class="${showQuestions ? 'answer-section' : 'answer-only-section'}">
      <div class="answer">정답: ${escapeHtml(answerText)}</div>
      <div class="explanation">
        <span class="explanation-label">해설:</span> ${escapeHtml(explanationText).replace(/\n/g, '<br>')}
      </div>
    </div>
  `
}

function renderSingleColumnBlockHtml(
  block: SingleColumnBlock,
  {
    showQuestions,
    isFirstBlockOnPage,
  }: {
    showQuestions: boolean
    isFirstBlockOnPage: boolean
  }
) {
  const baseAttributes = [
    `data-block-id="${escapeHtml(block.id)}"`,
    `data-question-number="${block.questionNumber}"`,
    `data-block-kind="${block.kind}"`,
  ].join(' ')

  if (block.kind === 'header') {
    const headerText = block.payload.type === 'header' ? block.payload.text : ''

    return `
      <div class="single-column-block single-column-header${isFirstBlockOnPage ? '' : ' question-start'}" ${baseAttributes}>
        ${showQuestions
          ? `<div class="question-text">${block.questionNumber}. ${escapeHtml(headerText)}</div>`
          : `<div class="question-number">${escapeHtml(headerText)}</div>`}
      </div>
    `
  }

  if (block.kind === 'body') {
    const bodyText = block.payload.type === 'body' ? block.payload.text : ''

    return `
      <div class="single-column-block single-column-body" ${baseAttributes}>
        <div class="text-box">
          ${renderInlineBracketUnderlineHtml(bodyText)}
        </div>
      </div>
    `
  }

  if (block.kind === 'choice-row') {
    const choiceLabel = block.payload.type === 'choice-row' ? block.payload.label : ''
    const choiceText = block.payload.type === 'choice-row' ? block.payload.text : ''

    return `
      <div class="single-column-block single-column-choice-row choice" ${baseAttributes}>
        <span class="choice-label">${escapeHtml(choiceLabel)}</span>${escapeHtml(choiceText)}
      </div>
    `
  }

  const answerText = block.payload.type === 'answer' ? block.payload.answerText : ''
  const explanationText = block.payload.type === 'answer' ? block.payload.explanationText : ''

  return `
    <div class="single-column-block single-column-answer" ${baseAttributes}>
      ${renderAnswerPanelHtml({
        answerText,
        explanationText,
      }, showQuestions)}
    </div>
  `
}

function buildSingleColumnPreviewPages(
  examPaper: ExamPaper,
  {
    showQuestions,
    showAnswers,
  }: {
    showQuestions: boolean
    showAnswers: boolean
  }
) {
  const questionGroups = examPaper.questions.map((question) => (
    buildSingleColumnQuestionGroups(question, {
      showQuestions,
      showAnswers,
    })
  ))

  return paginateSingleColumnQuestionGroups({
    questionGroups,
    hasDescription: Boolean(examPaper.description),
  })
}

type PreviewPlannedSection = TwoColumnFragmentPlan

function buildPlannedSectionAttributes(sectionPlan: PreviewPlannedSection) {
  return [
    `data-section-id="${escapeHtml(sectionPlan.id)}"`,
    `data-question-number="${sectionPlan.questionNumber}"`,
    `data-section-kind="${sectionPlan.kind}"`,
  ].join(' ')
}

function buildContinuationClassName(sectionPlan: PreviewPlannedSection) {
  if (sectionPlan.continuationPosition === 'single') {
    return ''
  }

  return ` chunk-linked-${sectionPlan.continuationPosition}`
}

function renderAnswerFragmentHtml(
  payload: TwoColumnAnswerFragmentPayload,
  sectionPlan: PreviewPlannedSection
) {
  const continuationClassName = buildContinuationClassName(sectionPlan)
  const isContinued = sectionPlan.continuationPosition !== 'single' && sectionPlan.fragmentIndex > 0

  return `
    <div class="answer-section${isContinued ? ' answer-section-continued' : ''}${continuationClassName}">
      ${payload.showAnswerLabel && payload.answerText ? `
        <div class="answer">정답: ${escapeHtml(payload.answerText)}</div>
      ` : ''}
      ${payload.explanationText ? `
        <div class="explanation">
          <span class="explanation-label">${payload.showAnswerLabel ? '해설:' : '해설 (계속):'}</span> ${escapeHtml(payload.explanationText).replace(/\n/g, '<br>')}
        </div>
      ` : ''}
    </div>
  `
}

function renderPlannedTwoColumnSectionHtml(
  sectionPlan: PreviewPlannedSection,
  showQuestions: boolean
): HtmlPaginationChunk {
  const sectionAttributes = buildPlannedSectionAttributes(sectionPlan)
  const continuationClassName = buildContinuationClassName(sectionPlan)

  if (sectionPlan.kind === 'header') {
    const headerText = sectionPlan.payload.type === 'header'
      ? sectionPlan.payload.text
      : ''

    return {
      id: sectionPlan.id,
      estimatedHeight: sectionPlan.estimatedUnits,
      kind: 'header',
      html: `
        <div class="question-chunk question-chunk-anchor" ${sectionAttributes}>
          ${showQuestions ? `
            <div class="question-text">
              ${sectionPlan.questionNumber}. ${escapeHtml(headerText)}
            </div>
          ` : `
            <div class="question-number">${sectionPlan.questionNumber}번</div>
          `}
        </div>
      `,
    }
  }

  if (sectionPlan.kind === 'body') {
    const bodyText = sectionPlan.payload.type === 'body'
      ? sectionPlan.payload.text
      : ''

    return {
      id: sectionPlan.id,
      estimatedHeight: sectionPlan.estimatedUnits,
      kind: 'body',
      html: `
        <div class="question-chunk question-body-chunk" ${sectionAttributes}>
          <div class="text-box${continuationClassName}">
            ${renderInlineBracketUnderlineHtml(bodyText)}
          </div>
        </div>
      `,
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
      id: sectionPlan.id,
      estimatedHeight: sectionPlan.estimatedUnits,
      kind: 'choice',
      html: `
        <div class="question-chunk question-choice-chunk" ${sectionAttributes}>
          ${renderQuestionChoicesHtml(choicePayload.rows)}
        </div>
      `,
    }
  }

  return {
    id: sectionPlan.id,
    estimatedHeight: sectionPlan.estimatedUnits,
    kind: 'answer',
    html: `
      <div class="question-chunk question-answer-chunk" ${sectionAttributes}>
        ${sectionPlan.payload.type === 'answer'
          ? renderAnswerFragmentHtml(sectionPlan.payload, sectionPlan)
          : ''}
      </div>
    `,
  }
}

function mapPlannedSectionsToHtmlChunks(
  sections: ExamPaperSectionChunk<PreviewPlannedSection>[],
  showQuestions: boolean
) {
  return sections.map((section) => renderPlannedTwoColumnSectionHtml(
    section.payload,
    showQuestions
  ))
}

function buildTwoColumnPreviewPages(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions
) {
  const questionPlans = examPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, renderOptions)
  )
  const layoutPlan = buildTwoColumnLayoutPlan({
    questionPlans,
    profile: 'shared-default',
    target: 'preview',
    hasDescription: Boolean(examPaper.description),
  })

  return layoutPlan.pages.map((page) => {
    const [left, right] = page.columns.map((column) => (
      mapPlannedSectionsToHtmlChunks(column.sections, renderOptions.showQuestions)
    )) as [HtmlPaginationChunk[], HtmlPaginationChunk[]]

    return {
      left,
      right,
    }
  })
}

function renderTwoColumnChunkPaginatedHtml(
  examPaper: ExamPaper,
  paginatedPages: Array<{
    left: HtmlPaginationChunk[]
    right: HtmlPaginationChunk[]
  }>,
  {
    titleSuffix,
    layoutSuffix,
  }: {
    titleSuffix: string
    layoutSuffix: string
  }
) {
  return paginatedPages.map((page, pageIndex) => `
    <section class="preview-page">
      ${pageIndex === 0 ? `
        <h1>${escapeHtml(examPaper.title + titleSuffix + layoutSuffix)}</h1>
        ${examPaper.description ? `<div class="description">${escapeHtml(examPaper.description)}</div>` : ''}
      ` : ''}
      <div class="two-column-layout">
        <div class="two-column-column">
          ${page.left.map((chunk) => chunk.html).join('')}
        </div>
        <div class="two-column-column">
          ${page.right.map((chunk) => chunk.html).join('')}
        </div>
      </div>
    </section>
  `).join('')
}

export function buildExamPaperPrintHtml(
  examPaper: ExamPaper,
  {
    autoPrint = false,
    closeAfterPrint = false,
    singleColumnMeasuredPages = null,
  }: ExamPaperPrintPreviewOptions = {}
) {
  const renderOptions = buildExamPaperRenderOptions(examPaper)
  const {
    showQuestions,
    showAnswers,
    isDoubleColumn,
    titleSuffix,
    layoutSuffix,
  } = renderOptions
  const singleColumnPages = !isDoubleColumn
    ? singleColumnMeasuredPages ?? buildSingleColumnPreviewPages(examPaper, {
      showQuestions,
      showAnswers,
    })
    : null
  // Shared page/column planning continues through buildExamPaperLayoutPlan inside the contract.
  const twoColumnChunkPages = isDoubleColumn
    ? buildTwoColumnPreviewPages(examPaper, renderOptions)
    : null
  // 2-column preview pages render via helper markup using class="two-column-layout"
  // and class="two-column-column" once chunk-aware pagination is enabled.

  return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(examPaper.title + titleSuffix)}</title>
      <style>
        @page {
          size: A4;
          margin: 12mm;
        }
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
          line-height: 1.6;
          color: #333;
          padding: 12px;
          background: #e5e7eb;
        }
        .preview-shell {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        .preview-page {
          width: 210mm;
          height: 297mm;
          background: #fff;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
          padding: 12mm 10mm;
          overflow: hidden;
        }
        h1 {
          text-align: center;
          font-size: 24px;
          margin-bottom: 10px;
          color: #111;
          font-weight: 700;
        }
        .description {
          text-align: center;
          color: #666;
          margin-bottom: 30px;
          font-size: 14px;
        }
        .question {
          margin-bottom: 24px;
          page-break-inside: avoid;
        }
        .single-column-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .single-column-header.question-start {
          margin-top: 24px;
        }
        .single-column-choice-row {
          margin-left: 0;
          margin-bottom: 0;
          font-size: 13px;
          line-height: 1.8;
        }
        .single-column-answer {
          margin-bottom: 24px;
        }
        .question-number {
          font-weight: 700;
          font-size: 16px;
          margin-bottom: 12px;
          color: #111;
        }
        .question-text {
          font-weight: normal;
          font-size: 14px;
          margin-bottom: 12px;
          color: #111;
          line-height: 1.8;
        }
        .choices {
          margin-left: 0;
          margin-bottom: 15px;
        }
        .choice {
          margin-bottom: 0;
          font-size: 13px;
          line-height: 1.8;
        }
        .choice-label {
          font-weight: 600;
          margin-right: 5px;
        }
        .answer-section {
          margin-top: 15px;
          padding: 12px;
          background-color: #f0f9ff;
          border-left: 4px solid #3b82f6;
          border-radius: 4px;
        }
        .answer-only-section {
          padding: 12px;
          background-color: #f0f9ff;
          border-left: 4px solid #3b82f6;
          border-radius: 4px;
        }
        .answer-section-continued {
          margin-top: 6px;
        }
        .answer-section.chunk-linked-start {
          border-bottom-left-radius: 0;
          border-bottom-right-radius: 0;
          margin-bottom: 0;
        }
        .answer-section.answer-section-continued.chunk-linked-middle {
          border-top: none;
          border-radius: 0;
          margin-top: 0;
          margin-bottom: 0;
        }
        .answer-section.answer-section-continued.chunk-linked-end {
          border-top: none;
          border-top-left-radius: 0;
          border-top-right-radius: 0;
          margin-top: 0;
        }
        .answer {
          font-weight: 700;
          color: #1e40af;
          margin-bottom: 8px;
          font-size: 13px;
        }
        .explanation {
          color: #475569;
          font-size: 12px;
          line-height: 1.8;
        }
        .explanation-label {
          font-weight: 600;
        }
        .text-box {
          padding: 10px 15px;
          border: 1px solid #9ca3af;
          border-radius: 4px;
          margin-bottom: 12px;
          font-size: 13px;
          line-height: 1.8;
          color: #374151;
        }
        .text-box.chunk-linked-start {
          border-bottom-left-radius: 0;
          border-bottom-right-radius: 0;
          margin-bottom: 0;
        }
        .text-box.chunk-linked-middle {
          border-top: none;
          border-radius: 0;
          margin-bottom: 0;
        }
        .text-box.chunk-linked-end {
          border-top: none;
          border-top-left-radius: 0;
          border-top-right-radius: 0;
        }
        .questions-container {
          ${isDoubleColumn ? `
            column-count: 2;
            column-gap: 16px;
            column-rule: 1px solid #e5e7eb;
            column-fill: auto;
          ` : ''}
        }
        .two-column-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 16px;
          align-items: start;
        }
        .two-column-column {
          min-width: 0;
          display: flex;
          flex-direction: column;
        }
        .two-column-column + .two-column-column {
          border-left: 1px solid #e5e7eb;
          padding-left: 16px;
        }
        .question-chunk {
          margin-bottom: 10px;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .question-body-chunk.chunk-linked-start,
        .question-body-chunk.chunk-linked-middle {
          margin-bottom: 0;
        }
        .question-chunk-anchor {
          margin-bottom: 12px;
        }
        .question-choice-chunk .choice {
          margin-left: 0;
        }
        .questions-container .question {
          ${isDoubleColumn ? `
            break-inside: avoid;
            page-break-inside: avoid;
            margin-bottom: 20px;
          ` : ''}
        }
        @media print {
          body {
            padding: 0;
            background: #fff;
          }
          .no-print {
            display: none;
          }
          .preview-shell {
            display: block;
          }
          .preview-page {
            width: auto;
            min-height: auto;
            padding: 0;
            margin: 0;
            box-shadow: none;
            break-after: page;
            page-break-after: always;
          }
          .preview-page:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .questions-container {
            ${isDoubleColumn ? `
              column-count: 2;
              column-gap: 16px;
              column-rule: 1px solid #e5e7eb;
              column-fill: auto;
            ` : ''}
          }
          .two-column-column + .two-column-column {
            border-left: 1px solid #e5e7eb;
          }
        }
      </style>
    </head>
    <body>
      <div class="preview-shell">
      ${isDoubleColumn
        ? renderTwoColumnChunkPaginatedHtml(examPaper, twoColumnChunkPages ?? [], {
            titleSuffix,
            layoutSuffix,
          })
        : (singleColumnPages ?? []).map((page, pageIndex) => `
        <section class="preview-page">
          ${pageIndex === 0 ? `
            <h1>${escapeHtml(examPaper.title + titleSuffix + layoutSuffix)}</h1>
            ${examPaper.description ? `<div class="description">${escapeHtml(examPaper.description)}</div>` : ''}
          ` : ''}
          <div class="questions-container">
      ${page.blocks.map((block, blockIndex) => `
        ${renderSingleColumnBlockHtml(block, {
          showQuestions,
          isFirstBlockOnPage: blockIndex === 0,
        })}
      `).join('')}
          </div>
        </section>
      `).join('')}
      </div>
      
      ${autoPrint ? `
      <script>
        window.onload = function() {
          setTimeout(function() {
            window.print();
            ${closeAfterPrint ? `
            setTimeout(function() {
              window.close();
            }, 100);
            ` : ''}
          }, 500);
        }
      </script>
      ` : ''}
    </body>
    </html>
  `
}

export function openExamPaperPrintPreview(
  examPaper: ExamPaper,
  {
    autoPrint = false,
    closeAfterPrint = false,
    singleColumnMeasuredPages = null,
  }: ExamPaperPrintPreviewOptions = {}
) {
  const printWindow = window.open('', '_blank')

  if (!printWindow) {
    throw new Error('팝업 차단으로 인해 PDF를 생성할 수 없습니다. 팝업을 허용해주세요.')
  }

  printWindow.document.write(
    buildExamPaperPrintHtml(examPaper, {
      autoPrint,
      closeAfterPrint,
      singleColumnMeasuredPages,
    })
  )
  printWindow.document.close()

  return printWindow
}

export async function exportToPDF(examPaper: ExamPaper) {
  openExamPaperPrintPreview(examPaper, {
    autoPrint: true,
    closeAfterPrint: true,
  })
}

export async function exportToWord(examPaper: ExamPaper) {
  // Determine view mode (support legacy includeAnswers for backwards compatibility)
  const viewMode: ViewMode = examPaper.viewMode || 
    (examPaper.includeAnswers === false ? 'exam-only' : 'exam-with-answers')
  const columnLayout: ColumnLayout = examPaper.columnLayout || 'single'
  
  const showQuestions = viewMode !== 'answer-only'
  const showAnswers = viewMode !== 'exam-only'
  const isDoubleColumn = columnLayout === 'double'
  
  const children: Paragraph[] = []

  const titleSuffix = viewMode === 'answer-only' ? ' - 답안' : 
                      viewMode === 'exam-only' ? ' - 시험지' : ''
  const layoutSuffix = isDoubleColumn ? ' (2단)' : ''

  // Title
  children.push(
    new Paragraph({
      text: examPaper.title + titleSuffix + layoutSuffix,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    })
  )

  // Description
  if (examPaper.description) {
    children.push(
      new Paragraph({
        text: examPaper.description,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    )
  }

  // Questions
  examPaper.questions.forEach((question) => {
    if (showQuestions) {
      // 1. Question number and text
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${question.number}. `,
              bold: true,
              size: 24
            })
          ],
          spacing: { before: 300, after: 100 }
        })
      )

      // Question text (passage) with spacing - no underlines for question_text
      children.push(
        new Paragraph({
          children: [new TextRun({ text: question.questionText })],
          spacing: { after: 200 }
        })
      )

      // 2. Question Text Forward (if exists)
      if (question.questionTextForward) {
        children.push(
          new Paragraph({
            children: createInlineBracketUnderlineRuns(question.questionTextForward),
            spacing: { before: 100, after: 100 },
            border: {
              top: { style: 'single' as const, size: 6, color: '9CA3AF' },
              bottom: { style: 'single' as const, size: 6, color: '9CA3AF' },
              left: { style: 'single' as const, size: 6, color: '9CA3AF' },
              right: { style: 'single' as const, size: 6, color: '9CA3AF' }
            },
            indent: { left: 360, right: 360 }
          })
        )
      }

      // 3. Passage Text (if exists)
      if (question.passageText) {
        children.push(
          new Paragraph({
            children: createInlineBracketUnderlineRuns(question.passageText),
            spacing: { before: 100, after: 100 },
            border: {
              top: { style: 'single' as const, size: 6, color: '9CA3AF' },
              bottom: { style: 'single' as const, size: 6, color: '9CA3AF' },
              left: { style: 'single' as const, size: 6, color: '9CA3AF' },
              right: { style: 'single' as const, size: 6, color: '9CA3AF' }
            },
            indent: { left: 360, right: 360 }
          })
        )
      }

      // 4. Question Text Backward (if exists)
      const normalizedQuestionTextBackward = normalizeQuestionTextBackward(question.questionTextBackward)
      if (normalizedQuestionTextBackward) {
        children.push(
          new Paragraph({
            children: createInlineBracketUnderlineRuns(normalizedQuestionTextBackward),
            spacing: { before: 100, after: 200 },
            border: {
              top: { style: 'single' as const, size: 6, color: '9CA3AF' },
              bottom: { style: 'single' as const, size: 6, color: '9CA3AF' },
              left: { style: 'single' as const, size: 6, color: '9CA3AF' },
              right: { style: 'single' as const, size: 6, color: '9CA3AF' }
            },
            indent: { left: 360, right: 360 }
          })
        )
      }

      // 5. Choices (only if exists)
      if (Array.isArray(question.choices) && question.choices.length > 0) {
        question.choices.forEach((choice) => {
          children.push(
            new Paragraph({
              text: `${choice.label} ${choice.text}`,
              spacing: { after: 100 },
              indent: { left: 720 }
            })
          )
        })
      }
    } else {
      // Answer-only mode: just show question number
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${question.number}번`,
              bold: true,
              size: 24
            })
          ],
          spacing: { before: 300, after: 100 }
        })
      )
    }

    // Answer and Explanation
    if (showAnswers) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `정답: ${question.answer}`,
              bold: true,
              size: 24
            })
          ],
          spacing: { before: 200, after: 100 }
        })
      )

      // Explanation
      children.push(
        new Paragraph({
          text: `해설: ${question.explanation}`,
          spacing: { after: 400 }
        })
      )
    }
  })

  const doc = new Document({
    sections: [{
      properties: isDoubleColumn ? {
        column: {
          count: 2,
          space: 708, // 0.5 inch in twips (1440 twips = 1 inch)
          separate: true
        }
      } : {},
      children: children
    }]
  })

  // Generate and save
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${examPaper.title}${titleSuffix}${layoutSuffix}.docx`)
}
