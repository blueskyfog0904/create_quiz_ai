import { splitBracketUnderlineSegments } from '@/lib/questions/normalize-question-field'
import type {
  SingleColumnBlock,
  SingleColumnPagePlan,
  SingleColumnQuestionGroups,
} from '@/lib/exam-paper-single-column-layout'
import { buildSingleColumnPlacementSteps } from '@/lib/exam-paper-single-column-layout'

const SINGLE_COLUMN_BOTTOM_GUARD_PX = 2
const SINGLE_COLUMN_PAGE_FIT_TOLERANCE_PX = 1
const SINGLE_COLUMN_PAGE_FOOTER_HEIGHT = '4.5mm'
const pageBodyByPage = new WeakMap<HTMLElement, HTMLElement>()

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

function normalizeInlineDescription(description: string | undefined) {
  if (!description) {
    return ''
  }

  return description.replace(/\s+/g, ' ').trim()
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
    pageNumber,
  }: {
    pageTitle: string
    description?: string
    includeHeader: boolean
    pageNumber: number
  }
) {
  const page = document.createElement('section')
  page.className = 'preview-page'
  page.style.width = '210mm'
  page.style.height = '297mm'
  page.style.padding = '8mm 8mm 5mm'
  page.style.boxSizing = 'border-box'
  page.style.overflow = 'hidden'
  page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Malgun Gothic", "맑은 고딕", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
  page.style.lineHeight = '1.6'
  page.style.color = '#333'
  page.style.background = '#fff'
  page.style.position = 'relative'
  page.style.display = 'flex'
  page.style.flexDirection = 'column'

  if (includeHeader) {
    const normalizedDescription = normalizeInlineDescription(description)
    const title = document.createElement('h1')
    title.className = 'page-heading'
    title.textContent = pageTitle
    if (normalizedDescription) {
      const descriptionSpan = document.createElement('span')
      descriptionSpan.className = 'title-description'
      descriptionSpan.textContent = ` - (${normalizedDescription})`
      descriptionSpan.style.fontSize = '14px'
      descriptionSpan.style.fontWeight = '400'
      descriptionSpan.style.color = '#666'
      title.appendChild(descriptionSpan)
    }
    title.style.textAlign = 'center'
    title.style.fontSize = '24px'
    title.style.margin = '0 0 10px 0'
    title.style.color = '#111'
    title.style.fontWeight = '700'
    page.appendChild(title)
  }

  const pageBody = document.createElement('div')
  pageBody.className = 'page-body single-column-page-body'
  pageBody.style.flex = '1 1 auto'
  pageBody.style.minHeight = '0'
  pageBody.style.overflow = 'hidden'
  pageBody.style.display = 'flex'
  pageBody.style.flexDirection = 'column'

  const questionsContainer = document.createElement('div')
  questionsContainer.className = 'questions-container'
  questionsContainer.style.flex = '1 1 auto'
  questionsContainer.style.minHeight = '0'
  pageBody.appendChild(questionsContainer)
  page.appendChild(pageBody)
  pageBodyByPage.set(page, pageBody)

  const pageFooter = document.createElement('div')
  pageFooter.className = 'page-footer'
  pageFooter.style.flex = `0 0 ${SINGLE_COLUMN_PAGE_FOOTER_HEIGHT}`
  pageFooter.style.height = SINGLE_COLUMN_PAGE_FOOTER_HEIGHT
  pageFooter.style.display = 'flex'
  pageFooter.style.alignItems = 'flex-end'
  pageFooter.style.justifyContent = 'center'
  pageFooter.style.paddingTop = '0.5mm'
  pageFooter.style.lineHeight = '1'
  const pageNumberEl = document.createElement('span')
  pageNumberEl.className = 'page-number'
  pageNumberEl.textContent = `- ${pageNumber} -`
  pageNumberEl.style.fontSize = '11px'
  pageNumberEl.style.color = '#6b7280'
  pageNumberEl.style.letterSpacing = '0.04em'
  pageFooter.appendChild(pageNumberEl)
  page.appendChild(pageFooter)

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
  wrapper.className = `single-column-block single-column-${block.kind}${buildAnswerFragmentClassName(block)}`
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
    wrapper.style.marginBottom = isAnswerContinuationFragment(block) ? '0' : '24px'

    const answerBlock = document.createElement('div')
    answerBlock.className = 'answer-text-block'
    answerBlock.style.marginTop = '4px'

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
      explanation.style.lineHeight = '1.6'
      explanation.innerHTML = `${block.payload.showAnswerLabel ? '해설: ' : ''}${escapeHtml(normalizeAnswerDisplayText(block.payload.explanationText)).replace(/\n/g, '<br>')}`
      answerBlock.appendChild(explanation)
    }

    wrapper.appendChild(answerBlock)
    return wrapper
  }

  return wrapper
}

function normalizeAnswerDisplayText(text: string | null | undefined) {
  if (typeof text !== 'string') {
    return ''
  }

  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function isAnswerContinuationFragment(block: SingleColumnBlock) {
  return (
    block.kind === 'answer' &&
    block.payload.type === 'answer' &&
    (block.payload.fragmentCount ?? 1) > 1 &&
    (block.payload.fragmentIndex ?? 0) < (block.payload.fragmentCount ?? 1) - 1
  )
}

function buildAnswerFragmentClassName(block: SingleColumnBlock) {
  if (block.kind !== 'answer' || block.payload.type !== 'answer') {
    return ''
  }

  const fragmentCount = block.payload.fragmentCount ?? 1

  if (fragmentCount <= 1) {
    return ' answer-fragment-single'
  }

  const fragmentIndex = block.payload.fragmentIndex ?? 0

  if (fragmentIndex === 0) {
    return ' answer-fragment-start'
  }

  if (fragmentIndex === fragmentCount - 1) {
    return ' answer-fragment-end'
  }

  return ' answer-fragment-middle'
}

function getPageOverflowPx(page: HTMLElement, guardPx = 0) {
  const viewport = pageBodyByPage.get(page) ?? page
  const viewportClientHeight = viewport === page
    ? page.clientHeight
    : measurePageBodyClientHeight(page, viewport)

  return viewport.scrollHeight - (viewportClientHeight - guardPx)
}

function measurePageBodyClientHeight(page: HTMLElement, pageBody: HTMLElement) {
  const siblingHeight = Array.from(page.children).reduce((height, child) => {
    if (child === pageBody) {
      return height
    }
    const element = child as HTMLElement

    return height + Math.max(
      element.clientHeight,
      element.scrollHeight
    )
  }, 0)
  const pageDerivedHeight = Math.max(0, page.clientHeight - siblingHeight)

  if (pageDerivedHeight <= 0) {
    return pageBody.clientHeight
  }

  return Math.min(pageBody.clientHeight || pageDerivedHeight, pageDerivedHeight)
}

function pageHardFits(page: HTMLElement) {
  return getPageOverflowPx(page) <= SINGLE_COLUMN_PAGE_FIT_TOLERANCE_PX
}

function pageGuardFits(page: HTMLElement, guardPx = SINGLE_COLUMN_BOTTOM_GUARD_PX) {
  return getPageOverflowPx(page, guardPx) <= SINGLE_COLUMN_PAGE_FIT_TOLERANCE_PX
}

function isGuardOnlyOverflow(page: HTMLElement) {
  return !pageGuardFits(page) && pageHardFits(page)
}

function isAnswerBlock(
  block: SingleColumnBlock
): block is SingleColumnBlock & { payload: Extract<SingleColumnBlock['payload'], { type: 'answer' }> } {
  return block.kind === 'answer' && block.payload.type === 'answer'
}

function splitTextIntoMeasuredTokens(text: string): string[] {
  return Array.from(text.match(/\S+\s*/g) ?? [])
}

function createMeasuredAnswerSplitBlock(
  block: SingleColumnBlock,
  {
    text,
    splitIndex,
    splitCount,
  }: {
    text: string
    splitIndex: number
    splitCount: number
  }
): SingleColumnBlock {
  if (!isAnswerBlock(block)) {
    return block
  }

  const originalFragmentIndex = block.payload.fragmentIndex ?? 0
  const originalFragmentCount = block.payload.fragmentCount ?? 1
  const adjustedFragmentCount = originalFragmentCount + splitCount - 1
  const adjustedFragmentIndex = originalFragmentIndex + splitIndex
  const isFirstSplit = splitIndex === 0

  return {
    ...block,
    id: splitCount > 1
      ? `${block.id}-split-${splitIndex + 1}`
      : block.id,
    payload: {
      ...block.payload,
      questionLabel: isFirstSplit ? block.payload.questionLabel : '',
      answerText: isFirstSplit ? block.payload.answerText : '',
      explanationText: text,
      fragmentIndex: adjustedFragmentIndex,
      fragmentCount: adjustedFragmentCount,
      showAnswerLabel: isFirstSplit ? block.payload.showAnswerLabel : false,
    },
  }
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
      pageNumber: pageIndex + 1,
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
        pageNumber: pageIndex + 1,
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

      if (!pageGuardFits(pageContext.page) && measuredPages[pageIndex].blocks.length > blocks.length) {
        appended.forEach(() => removeLastBlocks(1))
        startNextPage()
        blocks.forEach((block) => appendBlock(block))
      }
    }

    const canAppendAnswerBlockToCurrentPage = (block: SingleColumnBlock) => {
      appendBlock(block)
      const fits = pageHardFits(pageContext.page)
      removeLastBlocks(1)
      return fits
    }

    const placeSplitAnswerFragmentBlock = (block: SingleColumnBlock) => {
      if (!isAnswerBlock(block)) {
        appendBlock(block)
        return
      }

      const tokens = splitTextIntoMeasuredTokens(block.payload.explanationText)

      if (tokens.length <= 1) {
        appendBlock(block)
        return
      }

      const chunks: string[] = []
      let remainingTokens = tokens

      while (remainingTokens.length > 0) {
        let low = 1
        let high = remainingTokens.length
        let bestFitCount = 0

        while (low <= high) {
          const mid = Math.floor((low + high) / 2)
          const candidateText = remainingTokens.slice(0, mid).join('').trim()
          const candidateBlock = createMeasuredAnswerSplitBlock(block, {
            text: candidateText,
            splitIndex: chunks.length,
            splitCount: chunks.length + 1,
          })

          if (canAppendAnswerBlockToCurrentPage(candidateBlock)) {
            bestFitCount = mid
            low = mid + 1
          } else {
            high = mid - 1
          }
        }

        if (bestFitCount === 0) {
          if (measuredPages[pageIndex].blocks.length > 0) {
            startNextPage()
            continue
          }

          bestFitCount = 1
        }

        chunks.push(remainingTokens.slice(0, bestFitCount).join('').trim())
        remainingTokens = remainingTokens.slice(bestFitCount)
      }

      chunks.forEach((chunk, index) => {
        if (index > 0) {
          startNextPage()
        }

        appendBlock(createMeasuredAnswerSplitBlock(block, {
          text: chunk,
          splitIndex: index,
          splitCount: chunks.length,
        }))
      })
    }

    const placeAnswerFragmentBlock = (block: SingleColumnBlock) => {
      appendBlock(block)

      if (pageGuardFits(pageContext.page) || isGuardOnlyOverflow(pageContext.page)) {
        return
      }

      if (measuredPages[pageIndex].blocks.length > 1) {
        removeLastBlocks(1)
        startNextPage()
        appendBlock(block)

        if (pageGuardFits(pageContext.page) || isGuardOnlyOverflow(pageContext.page)) {
          return
        }

        removeLastBlocks(1)
        placeSplitAnswerFragmentBlock(block)
        return
      }

      removeLastBlocks(1)
      placeSplitAnswerFragmentBlock(block)
    }

    const placeChoiceRows = (blocks: SingleColumnBlock[]) => {
      blocks.forEach((block) => {
        if (isAnswerBlock(block)) {
          placeAnswerFragmentBlock(block)
          return
        }

        appendBlock(block)

        if (!pageGuardFits(pageContext.page) && measuredPages[pageIndex].blocks.length > 1) {
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
