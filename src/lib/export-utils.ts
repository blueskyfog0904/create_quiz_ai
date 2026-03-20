import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel, UnderlineType } from 'docx'
import { saveAs } from 'file-saver'
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

interface Choice {
  label: string
  text: string
}

interface Question {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices: Choice[]
  answer: string
  explanation: string
}

type ViewMode = 'exam-only' | 'answer-only' | 'exam-with-answers'
type ColumnLayout = 'single' | 'double'

interface ExamPaper {
  title: string
  description?: string
  questions: Question[]
  viewMode?: ViewMode
  columnLayout?: ColumnLayout
  includeAnswers?: boolean  // deprecated, use viewMode instead
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

export async function exportToPDF(examPaper: ExamPaper) {
  // Determine view mode (support legacy includeAnswers for backwards compatibility)
  const viewMode: ViewMode = examPaper.viewMode || 
    (examPaper.includeAnswers === false ? 'exam-only' : 'exam-with-answers')
  const columnLayout: ColumnLayout = examPaper.columnLayout || 'single'
  
  const showQuestions = viewMode !== 'answer-only'
  const showAnswers = viewMode !== 'exam-only'
  const isDoubleColumn = columnLayout === 'double'
  
  // Create a print-friendly HTML page
  const printWindow = window.open('', '_blank')
  
  if (!printWindow) {
    throw new Error('팝업 차단으로 인해 PDF를 생성할 수 없습니다. 팝업을 허용해주세요.')
  }

  const titleSuffix = viewMode === 'answer-only' ? ' - 답안' : 
                      viewMode === 'exam-only' ? ' - 시험지' : ''
  const layoutSuffix = isDoubleColumn ? ' (2단)' : ''

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>${escapeHtml(examPaper.title + titleSuffix)}</title>
      <style>
        @page {
          size: A4;
          margin: 20mm;
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
          padding: 20px;
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
          margin-bottom: ${isDoubleColumn ? '20px' : '30px'};
          page-break-inside: avoid;
        }
        .question-number {
          font-weight: 700;
          font-size: ${isDoubleColumn ? '13px' : '16px'};
          margin-bottom: ${isDoubleColumn ? '8px' : '12px'};
          color: #111;
        }
        .question-text {
          font-weight: normal;
          font-size: ${isDoubleColumn ? '11px' : '14px'};
          margin-bottom: ${isDoubleColumn ? '8px' : '12px'};
          color: #111;
          line-height: ${isDoubleColumn ? '1.6' : '1.8'};
        }
        .choices {
          margin-left: ${isDoubleColumn ? '12px' : '20px'};
          margin-bottom: ${isDoubleColumn ? '10px' : '15px'};
        }
        .choice {
          margin-bottom: ${isDoubleColumn ? '4px' : '8px'};
          font-size: ${isDoubleColumn ? '10px' : '13px'};
          line-height: ${isDoubleColumn ? '1.5' : '1.8'};
        }
        .choice-label {
          font-weight: 600;
          margin-right: 5px;
        }
        .answer-section {
          margin-top: ${isDoubleColumn ? '10px' : '15px'};
          padding: ${isDoubleColumn ? '8px' : '12px'};
          background-color: #f0f9ff;
          border-left: ${isDoubleColumn ? '3px' : '4px'} solid #3b82f6;
          border-radius: 4px;
        }
        .answer-only-section {
          padding: ${isDoubleColumn ? '8px' : '12px'};
          background-color: #f0f9ff;
          border-left: ${isDoubleColumn ? '3px' : '4px'} solid #3b82f6;
          border-radius: 4px;
        }
        .answer {
          font-weight: 700;
          color: #1e40af;
          margin-bottom: ${isDoubleColumn ? '4px' : '8px'};
          font-size: ${isDoubleColumn ? '10px' : '13px'};
        }
        .explanation {
          color: #475569;
          font-size: ${isDoubleColumn ? '9px' : '12px'};
          line-height: ${isDoubleColumn ? '1.5' : '1.8'};
        }
        .explanation-label {
          font-weight: 600;
        }
        .text-box {
          padding: ${isDoubleColumn ? '6px 10px' : '10px 15px'};
          border: 1px solid #9ca3af;
          border-radius: 4px;
          margin-bottom: ${isDoubleColumn ? '8px' : '12px'};
          font-size: ${isDoubleColumn ? '10px' : '13px'};
          line-height: ${isDoubleColumn ? '1.5' : '1.8'};
          color: #374151;
        }
        .questions-container {
          ${isDoubleColumn ? `
            column-count: 2;
            column-gap: 25px;
            column-rule: 1px solid #e5e7eb;
          ` : ''}
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
          }
          .no-print {
            display: none;
          }
          .questions-container {
            ${isDoubleColumn ? `
              column-count: 2;
              column-gap: 25px;
              column-rule: 1px solid #e5e7eb;
            ` : ''}
          }
        }
      </style>
    </head>
    <body>
      <h1>${escapeHtml(examPaper.title + titleSuffix + layoutSuffix)}</h1>
      ${examPaper.description ? `<div class="description">${escapeHtml(examPaper.description)}</div>` : ''}
      
      <div class="questions-container">
      ${examPaper.questions.map((question) => `
        <div class="question">
          ${showQuestions ? `
            <div class="question-text">
              ${question.number}. ${escapeHtml(question.questionText)}
            </div>
            
            ${question.questionTextForward ? `
              <div class="text-box">
                ${renderInlineBracketUnderlineHtml(question.questionTextForward)}
              </div>
            ` : ''}
            
            ${question.passageText ? `
              <div class="text-box">
                ${renderInlineBracketUnderlineHtml(question.passageText)}
              </div>
            ` : ''}
            
            ${normalizeQuestionTextBackward(question.questionTextBackward) ? `
              <div class="text-box">
                ${renderInlineBracketUnderlineHtml(normalizeQuestionTextBackward(question.questionTextBackward))}
              </div>
            ` : ''}
            
            ${Array.isArray(question.choices) && question.choices.length > 0 ? `
              <div class="choices">
                ${question.choices.map((choice) => `
                  <div class="choice">
                    <span class="choice-label">${escapeHtml(choice.label)}</span>${escapeHtml(choice.text)}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          ` : `
            <div class="question-number">${question.number}번</div>
          `}
          
          ${showAnswers ? `
          <div class="${showQuestions ? 'answer-section' : 'answer-only-section'}">
            <div class="answer">정답: ${escapeHtml(question.answer)}</div>
            <div class="explanation">
              <span class="explanation-label">해설:</span> ${escapeHtml(question.explanation).replace(/\n/g, '<br>')}
            </div>
          </div>
          ` : ''}
        </div>
      `).join('')}
      </div>
      
      <script>
        window.onload = function() {
          // 자동으로 인쇄 대화상자 열기
          setTimeout(function() {
            window.print();
            // 인쇄 후 창 닫기 (사용자가 취소할 수도 있음)
            setTimeout(function() {
              window.close();
            }, 100);
          }, 500);
        }
      </script>
    </body>
    </html>
  `

  printWindow.document.write(htmlContent)
  printWindow.document.close()
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
