import { splitBracketUnderlineSegments } from '@/lib/questions/normalize-question-field'
import type {
  SingleColumnBlock,
  SingleColumnPagePlan,
  SingleColumnQuestionGroups,
} from '@/lib/exam-paper-single-column-layout'
import { buildSingleColumnPlacementSteps } from '@/lib/exam-paper-single-column-layout'

interface MeasureSingleColumnPreviewPagesInput {
  description?: string | undefined
  pageTitle: string
  questionGroups: SingleColumnQuestionGroups[]
  showQuestions: boolean
  groupAnswerOnlyQuestion?: boolean
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineBracketUnderlineHtml(text: string | null | undefined) {
  if (!text) {
    return ''
  }

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

function createMeasurementHost(document: Document) {
  const host = document.createElement('div')
  host.setAttribute('data-single-column-measurement-host', 'true')
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
  page.style.padding = '12mm 10mm'
  page.style.boxSizing = 'border-box'
  page.style.overflow = 'hidden'
  page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
  page.style.lineHeight = '1.6'
  page.style.color = '#333'
  page.style.background = '#fff'

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

  const questionsContainer = document.createElement('div')
  questionsContainer.className = 'questions-container'
  page.appendChild(questionsContainer)

  return {
    page,
    questionsContainer,
  }
}

function createBlockElement(
  document: Document,
  block: SingleColumnBlock,
  {
    isFirstBlockOnPage,
    showQuestions,
  }: {
    isFirstBlockOnPage: boolean
    showQuestions: boolean
  }
) {
  const wrapper = document.createElement('div')
  wrapper.className = `single-column-block single-column-${block.kind}`
  wrapper.setAttribute('data-block-id', block.id)
  wrapper.setAttribute('data-question-number', `${block.questionNumber}`)
  wrapper.setAttribute('data-block-kind', block.kind)
  wrapper.style.breakInside = 'avoid'
  wrapper.style.pageBreakInside = 'avoid'

  if (block.kind === 'header') {
    if (!isFirstBlockOnPage) {
      wrapper.style.marginTop = '24px'
    }

    const header = document.createElement('div')
    header.className = showQuestions ? 'question-text' : 'question-number'
    header.textContent = showQuestions
      ? `${block.questionNumber}. ${block.payload.type === 'header' ? block.payload.text : ''}`
      : block.payload.type === 'header'
        ? block.payload.text
        : ''

    if (showQuestions) {
      header.style.fontWeight = 'normal'
      header.style.fontSize = '12px'
      header.style.marginBottom = '4px'
      header.style.color = '#111'
      header.style.lineHeight = '1.6'
    } else {
      header.style.fontWeight = '700'
      header.style.fontSize = '16px'
      header.style.marginBottom = '12px'
      header.style.color = '#111'
    }

    wrapper.appendChild(header)
    return wrapper
  }

  if (block.kind === 'body' && block.payload.type === 'body') {
    const bodyText = document.createElement('div')
    const isSupplemental = block.payload.sectionKey === 'forward' || block.payload.sectionKey === 'backward'
    bodyText.className = [
      'flow-body-text',
      'flow-body-segment',
      `flow-body-segment-${block.payload.sectionKey}`,
      isSupplemental ? 'flow-body-supplemental' : '',
    ].filter(Boolean).join(' ')
    bodyText.style.marginBottom = '12px'
    bodyText.style.fontSize = '12px'
    bodyText.style.lineHeight = '1.6'
    bodyText.style.color = '#374151'
    if (isSupplemental) {
      bodyText.style.borderTop = '1px solid #d1d5db'
      bodyText.style.borderBottom = '1px solid #d1d5db'
      bodyText.style.padding = '5px 0'
    }
    bodyText.innerHTML = renderInlineBracketUnderlineHtml(block.payload.text)
    wrapper.appendChild(bodyText)
    return wrapper
  }

  if (block.kind === 'choice-row' && block.payload.type === 'choice-row') {
    wrapper.className += ' choice'
    wrapper.style.marginLeft = '0'
    wrapper.style.marginBottom = '0'
    wrapper.style.fontSize = '12px'
    wrapper.style.lineHeight = '1.6'

    const label = document.createElement('span')
    label.className = 'choice-label'
    label.textContent = block.payload.label
    label.style.fontWeight = '300'
    label.style.marginRight = '5px'
    wrapper.appendChild(label)
    wrapper.append(block.payload.text)
    return wrapper
  }

  if (block.kind === 'answer' && block.payload.type === 'answer') {
    wrapper.style.marginBottom = '24px'

    const answerBlock = document.createElement('div')
    answerBlock.className = 'answer-text-block'

    if (block.payload.questionLabel) {
      const questionLabel = document.createElement('div')
      questionLabel.className = 'answer-text-line answer-text-question'
      questionLabel.textContent = block.payload.questionLabel
      questionLabel.style.fontWeight = '700'
      questionLabel.style.fontSize = '16px'
      questionLabel.style.marginBottom = '6px'
      answerBlock.appendChild(questionLabel)
    }

    if (block.payload.answerText) {
      const answer = document.createElement('div')
      answer.className = 'answer-text-line answer-text-answer'
      answer.textContent = `정답: ${block.payload.answerText}`
      answer.style.fontWeight = '700'
      answer.style.fontSize = '12px'
      answer.style.marginBottom = '4px'
      answerBlock.appendChild(answer)
    }

    if (block.payload.explanationText) {
      const explanation = document.createElement('div')
      explanation.className = 'answer-text-line answer-text-explanation'
      explanation.style.fontSize = '12px'
      explanation.style.lineHeight = '1.8'
      explanation.innerHTML = `${block.payload.showAnswerLabel ? '해설: ' : ''}${escapeHtml(block.payload.explanationText).replace(/\n/g, '<br>')}`
      answerBlock.appendChild(explanation)
    }

    wrapper.appendChild(answerBlock)
    return wrapper
  }

  return wrapper
}

function pageFits(page: HTMLElement) {
  return page.scrollHeight <= page.clientHeight + 1
}

export function measureSingleColumnPreviewPages({
  pageTitle,
  description,
  questionGroups,
  showQuestions,
  groupAnswerOnlyQuestion = false,
}: MeasureSingleColumnPreviewPagesInput): SingleColumnPagePlan[] {
  if (typeof document === 'undefined') {
    throw new Error('single-column preview measurement requires a browser document')
  }

  const host = createMeasurementHost(document)
  const measuredPages: SingleColumnPagePlan[] = []

  try {
    let pageIndex = 0
    let pageContext = createPageElement(document, {
      pageTitle,
      description,
      includeHeader: true,
    })
    host.appendChild(pageContext.page)
    measuredPages.push({
      pageIndex,
      blockIds: [],
      blocks: [],
    })

    const startNextPage = () => {
      pageIndex += 1
      pageContext = createPageElement(document, {
        pageTitle,
        description,
        includeHeader: false,
      })
      host.appendChild(pageContext.page)
      measuredPages.push({
        pageIndex,
        blockIds: [],
        blocks: [],
      })
    }

    const appendBlock = (block: SingleColumnBlock) => {
      const currentPagePlan = measuredPages[pageIndex]
      const blockElement = createBlockElement(document, block, {
        showQuestions,
        isFirstBlockOnPage: currentPagePlan.blocks.length === 0,
      })
      pageContext.questionsContainer.appendChild(blockElement)
      currentPagePlan.blocks.push(block)
      currentPagePlan.blockIds.push(block.id)
      return blockElement
    }

    const removeLastBlocks = (count: number) => {
      const currentPagePlan = measuredPages[pageIndex]
      for (let index = 0; index < count; index += 1) {
        currentPagePlan.blocks.pop()
        currentPagePlan.blockIds.pop()
        pageContext.questionsContainer.lastElementChild?.remove()
      }
    }

    const placeAtomicGroup = (blocks: SingleColumnBlock[]) => {
      if (blocks.length === 0) {
        return
      }

      const appended = blocks.map((block) => appendBlock(block))

      if (!pageFits(pageContext.page) && measuredPages[pageIndex].blocks.length > blocks.length) {
        appended.forEach(() => removeLastBlocks(1))
        startNextPage()
        blocks.forEach((block) => appendBlock(block))
      }
    }

    const placeChoiceRows = (blocks: SingleColumnBlock[]) => {
      blocks.forEach((block) => {
        appendBlock(block)

        if (!pageFits(pageContext.page) && measuredPages[pageIndex].blocks.length > 1) {
          removeLastBlocks(1)
          startNextPage()
          appendBlock(block)
        }
      })
    }

    let hasStartedAnswerFragmentGroups = false

    questionGroups.forEach((group) => {
      if (
        group.placementMode === 'answer-fragments' &&
        !hasStartedAnswerFragmentGroups &&
        measuredPages[pageIndex].blocks.length > 0
      ) {
        startNextPage()
      }
      if (group.placementMode === 'answer-fragments') {
        hasStartedAnswerFragmentGroups = true
      }

      buildSingleColumnPlacementSteps(group, {
        groupAnswerOnlyQuestion,
      }).forEach((step) => {
        if (step.type === 'atomic-group') {
          placeAtomicGroup(step.blocks)
          return
        }

        placeChoiceRows(step.blocks)
      })
    })

    return measuredPages.filter((page) => page.blocks.length > 0)
  } finally {
    host.remove()
  }
}
