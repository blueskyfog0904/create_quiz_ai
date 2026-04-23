import {
  buildExamPaperRenderOptions,
  buildQuestionSectionPlan,
  buildTwoColumnFragmentQuestionPlans,
  type ExamPaperRenderOptions,
  type TwoColumnAnswerFragmentPayload,
  type TwoColumnChoiceFragmentPayload,
  type TwoColumnFragmentPlan,
} from '@/lib/exam-paper-layout-contract'
import { splitBracketUnderlineSegments } from '@/lib/questions/normalize-question-field'

export interface TwoColumnMeasurementChoice {
  label: string
  text: string
}

export interface TwoColumnMeasurementQuestion {
  number: number
  questionText: string
  questionTextForward?: string | null
  questionTextBackward?: string | null
  passageText?: string | null
  choices: TwoColumnMeasurementChoice[]
  answer: string
  explanation: string
}

export interface TwoColumnMeasurementExamPaper {
  title: string
  description?: string
  questions: TwoColumnMeasurementQuestion[]
  viewMode?: 'exam-only' | 'answer-only' | 'exam-with-answers'
  columnLayout?: 'single' | 'double'
}

export interface MeasuredTwoColumnPreviewChunk {
  id: string
  estimatedHeight: number
  kind: 'header' | 'body' | 'choice' | 'answer' | 'explanation'
  html: string
}

export interface MeasuredTwoColumnPreviewPage {
  left: MeasuredTwoColumnPreviewChunk[]
  right: MeasuredTwoColumnPreviewChunk[]
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

function renderQuestionChoicesHtml(choices: TwoColumnMeasurementChoice[]) {
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

function buildPlannedSectionAttributes(sectionPlan: TwoColumnFragmentPlan) {
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

function buildContinuationClassName(sectionPlan: TwoColumnFragmentPlan) {
  if (sectionPlan.continuationPosition === 'single') {
    return ''
  }

  return ` chunk-linked-${sectionPlan.continuationPosition}`
}

function renderAnswerFragmentHtml(payload: TwoColumnAnswerFragmentPayload) {
  return renderPlainAnswerTextHtml({
    questionLabel: payload.questionLabel,
    answerText: payload.showAnswerLabel ? payload.answerText ?? '' : '',
    explanationText: payload.explanationText ?? '',
    showAnswerLabel: payload.showAnswerLabel,
  })
}

function renderPlannedTwoColumnSectionHtml(
  sectionPlan: TwoColumnFragmentPlan,
  showQuestions: boolean
): MeasuredTwoColumnPreviewChunk {
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
          ? renderAnswerFragmentHtml(sectionPlan.payload)
          : ''}
      </div>
    `,
  }
}

function createMeasurementHost(document: Document) {
  const host = document.createElement('div')
  host.setAttribute('data-two-column-measurement-host', 'true')
  host.style.position = 'fixed'
  host.style.left = '-200vw'
  host.style.top = '0'
  host.style.width = '210mm'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  host.style.zIndex = '-1'
  document.body.appendChild(host)
  return host
}

function createPageElement(
  document: Document,
  {
    pageTitle,
    description,
    includeHeader,
  }: {
    pageTitle: string
    description?: string
    includeHeader: boolean
  }
) {
  const page = document.createElement('section')
  page.className = 'preview-page'
  page.style.width = '210mm'
  page.style.height = '297mm'
  page.style.background = '#fff'
  page.style.padding = '12mm 10mm'
  page.style.boxSizing = 'border-box'
  page.style.overflow = 'hidden'
  page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
  page.style.lineHeight = '1.6'
  page.style.color = '#333'

  if (includeHeader) {
    const title = document.createElement('h1')
    title.textContent = pageTitle
    title.style.textAlign = 'center'
    title.style.fontSize = '24px'
    title.style.margin = '0 0 10px 0'
    title.style.color = '#111'
    title.style.fontWeight = '700'
    page.appendChild(title)

    if (description) {
      const descriptionEl = document.createElement('div')
      descriptionEl.textContent = description
      descriptionEl.style.textAlign = 'center'
      descriptionEl.style.color = '#666'
      descriptionEl.style.margin = '0 0 30px 0'
      descriptionEl.style.fontSize = '14px'
      page.appendChild(descriptionEl)
    }
  }

  const layout = document.createElement('div')
  layout.className = 'two-column-layout'
  layout.style.display = 'grid'
  layout.style.gridTemplateColumns = 'minmax(0, 1fr) minmax(0, 1fr)'
  layout.style.gap = '16px'
  layout.style.alignItems = 'start'

  const left = document.createElement('div')
  left.className = 'two-column-column'
  left.style.minWidth = '0'
  left.style.display = 'flex'
  left.style.flexDirection = 'column'

  const right = document.createElement('div')
  right.className = 'two-column-column'
  right.style.minWidth = '0'
  right.style.display = 'flex'
  right.style.flexDirection = 'column'
  right.style.borderLeft = '1px solid #e5e7eb'
  right.style.paddingLeft = '16px'

  layout.appendChild(left)
  layout.appendChild(right)
  page.appendChild(layout)

  return {
    page,
    columns: [left, right] as const,
  }
}

function createChunkElement(document: Document, chunk: MeasuredTwoColumnPreviewChunk) {
  const template = document.createElement('template')
  template.innerHTML = chunk.html.trim()
  const element = template.content.firstElementChild

  if (!element) {
    throw new Error(`failed to render two-column preview chunk ${chunk.id}`)
  }

  const htmlElement = element as HTMLElement
  htmlElement.style.breakInside = 'avoid'
  htmlElement.style.pageBreakInside = 'avoid'

  return htmlElement
}

function pageFits(page: HTMLElement) {
  const pageRect = page.getBoundingClientRect()
  const sectionElements = [...page.querySelectorAll<HTMLElement>('[data-section-id]')]

  if (sectionElements.length === 0) {
    return true
  }

  const maxBottom = Math.max(
    ...sectionElements.map((section) => section.getBoundingClientRect().bottom - pageRect.top)
  )

  return maxBottom <= page.clientHeight + 1
}

export function measureTwoColumnPreviewPages(
  examPaper: TwoColumnMeasurementExamPaper
): MeasuredTwoColumnPreviewPage[] {
  if (typeof document === 'undefined') {
    throw new Error('two-column preview measurement requires a browser document')
  }

  const renderOptions: ExamPaperRenderOptions = buildExamPaperRenderOptions(examPaper)
  const questionPlans = examPaper.questions.map((question) =>
    buildQuestionSectionPlan(question, renderOptions)
  )
  const fragmentQuestionPlans = buildTwoColumnFragmentQuestionPlans(questionPlans)
  const chunks = fragmentQuestionPlans.flatMap((questionPlan) => (
    questionPlan.sections.map((section) => (
      renderPlannedTwoColumnSectionHtml(section.payload, renderOptions.showQuestions)
    ))
  ))

  const host = createMeasurementHost(document)
  const measuredPages: MeasuredTwoColumnPreviewPage[] = []

  try {
    let pageIndex = 0
    let currentColumnIndex = 0
    let pageContext = createPageElement(document, {
      pageTitle: `${examPaper.title}${renderOptions.titleSuffix}${renderOptions.layoutSuffix}`,
      description: examPaper.description,
      includeHeader: true,
    })
    host.appendChild(pageContext.page)
    measuredPages.push({ left: [], right: [] })

    const startNextPage = () => {
      pageIndex += 1
      currentColumnIndex = 0
      pageContext = createPageElement(document, {
        pageTitle: `${examPaper.title}${renderOptions.titleSuffix}${renderOptions.layoutSuffix}`,
        description: examPaper.description,
        includeHeader: false,
      })
      host.appendChild(pageContext.page)
      measuredPages.push({ left: [], right: [] })
    }

    const appendChunkToCurrentColumn = (chunk: MeasuredTwoColumnPreviewChunk) => {
      const chunkElement = createChunkElement(document, chunk)
      pageContext.columns[currentColumnIndex].appendChild(chunkElement)
      if (currentColumnIndex === 0) {
        measuredPages[pageIndex].left.push(chunk)
      } else {
        measuredPages[pageIndex].right.push(chunk)
      }
      return chunkElement
    }

    const removeLastChunkFromCurrentColumn = () => {
      if (currentColumnIndex === 0) {
        measuredPages[pageIndex].left.pop()
      } else {
        measuredPages[pageIndex].right.pop()
      }
      pageContext.columns[currentColumnIndex].lastElementChild?.remove()
    }

    chunks.forEach((chunk) => {
      appendChunkToCurrentColumn(chunk)

      if (pageFits(pageContext.page)) {
        return
      }

      const currentColumnChildCount = pageContext.columns[currentColumnIndex].childElementCount

      if (currentColumnChildCount > 1) {
        removeLastChunkFromCurrentColumn()

        if (currentColumnIndex === 0) {
          currentColumnIndex = 1
        } else {
          startNextPage()
        }

        appendChunkToCurrentColumn(chunk)
      }
    })

    return measuredPages.filter((page) => page.left.length > 0 || page.right.length > 0)
  } finally {
    host.remove()
  }
}
