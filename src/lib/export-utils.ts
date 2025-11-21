import pdfMake from 'pdfmake/build/pdfmake'
import * as pdfFonts from 'pdfmake/build/vfs_fonts'
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx'
import { saveAs } from 'file-saver'

// Register fonts
if (pdfFonts && (pdfFonts as any).pdfMake && (pdfFonts as any).pdfMake.vfs) {
  (pdfMake as any).vfs = (pdfFonts as any).pdfMake.vfs
} else if (pdfFonts && (pdfFonts as any).default && (pdfFonts as any).default.pdfMake) {
  (pdfMake as any).vfs = (pdfFonts as any).default.pdfMake.vfs
}

// Add Korean font support using system fonts
;(pdfMake as any).fonts = {
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
  choices: Choice[]
  answer: string
  explanation: string
}

interface ExamPaper {
  title: string
  description?: string
  questions: Question[]
  includeAnswers?: boolean
}

export async function exportToPDF(examPaper: ExamPaper) {
  const includeAnswers = examPaper.includeAnswers !== false // default to true
  // Create a print-friendly HTML page
  const printWindow = window.open('', '_blank')
  
  if (!printWindow) {
    throw new Error('팝업 차단으로 인해 PDF를 생성할 수 없습니다. 팝업을 허용해주세요.')
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <title>${examPaper.title}</title>
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
          margin-bottom: 30px;
          page-break-inside: avoid;
        }
        .question-text {
          font-weight: 600;
          font-size: 14px;
          margin-bottom: 12px;
          color: #111;
          line-height: 1.8;
        }
        .choices {
          margin-left: 20px;
          margin-bottom: 15px;
        }
        .choice {
          margin-bottom: 8px;
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
        @media print {
          body {
            padding: 0;
          }
          .no-print {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <h1>${examPaper.title}</h1>
      ${examPaper.description ? `<div class="description">${examPaper.description}</div>` : ''}
      
      ${examPaper.questions.map((question) => `
        <div class="question">
          <div class="question-text">
            ${question.number}. ${question.questionText.replace(/\n/g, '<br>')}
          </div>
          
          <div class="choices">
            ${question.choices.map((choice) => `
              <div class="choice">
                <span class="choice-label">${choice.label}</span>${choice.text}
              </div>
            `).join('')}
          </div>
          
          ${includeAnswers ? `
          <div class="answer-section">
            <div class="answer">정답: ${question.answer}</div>
            <div class="explanation">
              <span class="explanation-label">해설:</span> ${question.explanation.replace(/\n/g, '<br>')}
            </div>
          </div>
          ` : ''}
        </div>
      `).join('')}
      
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
  const includeAnswers = examPaper.includeAnswers !== false // default to true
  const children: Paragraph[] = []

  // Title
  children.push(
    new Paragraph({
      text: examPaper.title,
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
    // Question number only
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

    // Question text (passage) with spacing
    children.push(
      new Paragraph({
        text: question.questionText,
        spacing: { after: 200 }
      })
    )

    // Choices
    question.choices.forEach((choice) => {
      children.push(
        new Paragraph({
          text: `${choice.label} ${choice.text}`,
          spacing: { after: 100 },
          indent: { left: 720 }
        })
      )
    })

    // Answer (only if includeAnswers is true)
    if (includeAnswers) {
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
      properties: {},
      children: children
    }]
  })

  // Generate and save
  const blob = await Packer.toBlob(doc)
  saveAs(blob, `${examPaper.title}.docx`)
}
