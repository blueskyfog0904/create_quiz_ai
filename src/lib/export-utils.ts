import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, UnderlineType } from 'docx'
import { saveAs } from 'file-saver'
import {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnLayoutPlan,
  buildTwoColumnLinearFragmentPlans,
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
  twoColumnMeasuredPages?: TwoColumnMeasuredPagePlan[] | null
}

export interface HtmlPaginationChunk {
  id: string
  estimatedHeight: number
  kind: 'header' | 'body' | 'choice' | 'answer' | 'explanation'
  html: string
}

export interface TwoColumnMeasuredPagePlan {
  pageIndex: number
  columns: [HtmlPaginationChunk[], HtmlPaginationChunk[]]
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

function renderPlainAnswerTextHtml(
  {
    questionLabel,
    answerText,
    explanationText,
    showAnswerLabel = true,
  }: {
    questionLabel?: string
    answerText?: string
    explanationText: string
    showAnswerLabel?: boolean
  }
) {
  return `
    <div class="answer-text-block">
      ${questionLabel ? `<div class="answer-text-line answer-text-question">${escapeHtml(questionLabel)}</div>` : ''}
      ${answerText ? `<div class="answer-text-line answer-text-answer">정답: ${escapeHtml(answerText)}</div>` : ''}
      ${explanationText ? `<div class="answer-text-line answer-text-explanation">${showAnswerLabel ? '해설: ' : ''}${escapeHtml(explanationText).replace(/\n/g, '<br>')}</div>` : ''}
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
        <div class="flow-body-text">
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

  const questionLabel = block.payload.type === 'answer' ? block.payload.questionLabel : ''
  const answerText = block.payload.type === 'answer' ? block.payload.answerText : ''
  const explanationText = block.payload.type === 'answer' ? block.payload.explanationText : ''

  return `
    <div class="single-column-block single-column-answer" ${baseAttributes}>
      ${renderPlainAnswerTextHtml({
        questionLabel,
        answerText,
        explanationText,
        showAnswerLabel: block.payload.type === 'answer' ? block.payload.showAnswerLabel : true,
      })}
    </div>
  `
}

function buildSingleColumnPreviewPages(
  examPaper: ExamPaper,
  {
    showQuestions,
    showAnswers,
    groupAnswerOnlyQuestion,
  }: {
    showQuestions: boolean
    showAnswers: boolean
    groupAnswerOnlyQuestion: boolean
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
    groupAnswerOnlyQuestion,
  })
}

type PreviewPlannedSection = TwoColumnFragmentPlan

function buildPlannedSectionAttributes(sectionPlan: PreviewPlannedSection) {
  return [
    `data-section-id="${escapeHtml(sectionPlan.id)}"`,
    `data-source-section-id="${escapeHtml(sectionPlan.sourceSectionId)}"`,
    `data-question-number="${sectionPlan.questionNumber}"`,
    `data-section-kind="${sectionPlan.kind}"`,
    `data-estimated-height="${sectionPlan.estimatedUnits}"`,
    `data-fragment-index="${sectionPlan.fragmentIndex}"`,
    `data-continuation-position="${sectionPlan.continuationPosition}"`,
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
  void sectionPlan

  return renderPlainAnswerTextHtml({
    questionLabel: payload.questionLabel,
    answerText: payload.showAnswerLabel ? payload.answerText ?? '' : '',
    explanationText: payload.explanationText ?? '',
    showAnswerLabel: payload.showAnswerLabel,
  })
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
        <div class="question-chunk question-body-chunk${continuationClassName}" ${sectionAttributes}>
          <div class="flow-body-text">
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

export function buildTwoColumnPreviewChunks(
  examPaper: ExamPaper,
  renderOptions: ExamPaperRenderOptions
): HtmlPaginationChunk[] {
  const questionPlans = examPaper.questions.map((question) => (
    buildQuestionSectionPlan(question, renderOptions)
  ))
  const fragments = buildTwoColumnLinearFragmentPlans(questionPlans)

  return fragments.map((fragment) => renderPlannedTwoColumnSectionHtml(
    fragment,
    renderOptions.showQuestions
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

function renderTwoColumnMeasuredPagesHtml(
  examPaper: ExamPaper,
  pages: TwoColumnMeasuredPagePlan[],
  {
    titleSuffix,
    layoutSuffix,
  }: {
    titleSuffix: string
    layoutSuffix: string
  }
) {
  return pages.map((page, pageIndex) => `
    <section class="preview-page">
      ${pageIndex === 0 ? `
        <h1>${escapeHtml(examPaper.title + titleSuffix + layoutSuffix)}</h1>
        ${examPaper.description ? `<div class="description">${escapeHtml(examPaper.description)}</div>` : ''}
      ` : ''}
      <div class="two-column-layout">
        <div class="two-column-column">
          ${page.columns[0].map((chunk) => chunk.html).join('')}
        </div>
        <div class="two-column-column">
          ${page.columns[1].map((chunk) => chunk.html).join('')}
        </div>
      </div>
    </section>
  `).join('')
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

function buildExamPaperPrintStyles({ isDoubleColumn }: ExamPaperRenderOptions) {
  return `
        @page {
          size: A4;
          margin: 0;
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
        .answer-text-block {
          margin-top: 4px;
        }
        .answer-text-line {
          font-size: 12px;
          line-height: 1.8;
          color: #111;
        }
        .answer-text-question {
          font-size: 16px;
          font-weight: 700;
          margin-bottom: 6px;
        }
        .answer-text-answer {
          font-weight: 700;
          margin-bottom: 4px;
        }
        .flow-body-text {
          margin-bottom: 12px;
          font-size: 13px;
          line-height: 1.8;
          color: #374151;
        }
        .flow-body-text.chunk-linked-start,
        .flow-body-text.chunk-linked-middle {
          margin-bottom: 0;
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
        .question-choice-chunk .choices {
          margin-bottom: 0;
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
            gap: 0;
          }
          .preview-page {
            width: 210mm;
            height: 297mm;
            padding: 12mm 10mm;
            margin: 0;
            box-shadow: none;
            overflow: hidden;
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
  `
}

export function buildExamPaperTwoColumnMeasurementHtml(examPaper: ExamPaper) {
  const renderOptions = buildExamPaperRenderOptions({
    ...examPaper,
    columnLayout: 'double',
  })
  const chunks = buildTwoColumnPreviewChunks(examPaper, renderOptions)

  return `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(examPaper.title)} - measurement</title>
      <style>${buildExamPaperPrintStyles(renderOptions)}</style>
    </head>
    <body>
      <div class="preview-shell measurement-shell">
        <section class="preview-page measurement-first-page">
          <h1>${escapeHtml(examPaper.title + renderOptions.titleSuffix + renderOptions.layoutSuffix)}</h1>
          ${examPaper.description ? `<div class="description">${escapeHtml(examPaper.description)}</div>` : ''}
          <div class="two-column-layout measurement-layout">
            <div class="two-column-column measurement-column" data-measurement-column="first">
              ${chunks.map((chunk) => chunk.html).join('')}
            </div>
            <div class="two-column-column measurement-column"></div>
          </div>
        </section>
        <section class="preview-page measurement-other-page">
          <div class="two-column-layout measurement-layout">
            <div class="two-column-column measurement-column" data-measurement-column="other"></div>
            <div class="two-column-column measurement-column"></div>
          </div>
        </section>
      </div>
    </body>
    </html>
  `
}

export function buildExamPaperPrintHtml(
  examPaper: ExamPaper,
  {
    autoPrint = false,
    closeAfterPrint = false,
    singleColumnMeasuredPages = null,
    twoColumnMeasuredPages = null,
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
      groupAnswerOnlyQuestion: !showQuestions && showAnswers,
    })
    : null
  // Shared page/column planning continues through buildExamPaperLayoutPlan inside the contract.
  const twoColumnChunkPages = isDoubleColumn && !twoColumnMeasuredPages
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
      <style>${buildExamPaperPrintStyles(renderOptions)}</style>
    </head>
    <body>
      <div class="preview-shell">
      ${isDoubleColumn
        ? twoColumnMeasuredPages
          ? renderTwoColumnMeasuredPagesHtml(examPaper, twoColumnMeasuredPages, {
            titleSuffix,
            layoutSuffix,
          })
          : renderTwoColumnChunkPaginatedHtml(examPaper, twoColumnChunkPages ?? [], {
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
    twoColumnMeasuredPages = null,
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
      twoColumnMeasuredPages,
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
