/**
 * @typedef {{ id: string, estimatedHeight: number, kind: string, node?: unknown }} PaginationChunk
 * @typedef {{ questionNumber: number, chunks: PaginationChunk[] }} QuestionChunkGroup
 * @typedef {{ left: PaginationChunk[], right: PaginationChunk[] }} TwoColumnPage
 */

const EXAM_PAPER_DEBUG_STORAGE_KEY = 'exam-paper-pdf-debug'

function isExamPaperDebugEnabled() {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    return window.__EXAM_PAPER_PDF_DEBUG__ === true ||
      window.localStorage.getItem(EXAM_PAPER_DEBUG_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function logExamPaperDebug(event, payload) {
  if (!isExamPaperDebugEnabled()) {
    return
  }

  console.log(`[exam-paper:${event}]`, payload)
}

function splitWordsIntoChunks(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean)
  const chunks = []
  let current = ''

  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word
    if (next.length > maxChars && current) {
      chunks.push(current)
      current = word
      return
    }

    current = next
  })

  if (current) {
    chunks.push(current)
  }

  return chunks
}

function splitParagraphIntoSentenceChunks(paragraph, maxChars) {
  const sentences = paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)

  if (sentences.length <= 1) {
    return paragraph.length > maxChars
      ? splitWordsIntoChunks(paragraph, maxChars)
      : [paragraph]
  }

  const chunks = []
  let current = ''

  sentences.forEach((sentence) => {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current)
        current = ''
      }

      chunks.push(...splitWordsIntoChunks(sentence, maxChars))
      return
    }

    const next = current ? `${current} ${sentence}` : sentence
    if (next.length > maxChars && current) {
      chunks.push(current)
      current = sentence
      return
    }

    current = next
  })

  if (current) {
    chunks.push(current)
  }

  return chunks
}

/**
 * @param {string | null | undefined} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
export function splitTextIntoFlowChunks(text, maxChars = 260) {
  if (!text) {
    return []
  }

  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) => splitParagraphIntoSentenceChunks(paragraph, maxChars))
}

function createPage() {
  return {
    left: [],
    right: [],
  }
}

/**
 * @param {number} pageIndex
 * @param {{ slotCapacity?: number, firstPageSlotCapacity?: number, otherPageSlotCapacity?: number, rebalanceEmptyRightColumn?: boolean }} options
 */
function getSlotCapacity(pageIndex, options) {
  if (typeof options.slotCapacity === 'number') {
    return options.slotCapacity
  }

  if (pageIndex === 0 && typeof options.firstPageSlotCapacity === 'number') {
    return options.firstPageSlotCapacity
  }

  if (typeof options.otherPageSlotCapacity === 'number') {
    return options.otherPageSlotCapacity
  }

  return 120
}

/**
 * @param {QuestionChunkGroup[]} questionGroups
 * @param {{ slotCapacity?: number, firstPageSlotCapacity?: number, otherPageSlotCapacity?: number, rebalanceEmptyRightColumn?: boolean }} [options]
 * @returns {TwoColumnPage[]}
 */
export function paginateTwoColumnQuestionChunks(questionGroups, options = {}) {
  /** @type {TwoColumnPage[]} */
  const pages = [createPage()]
  const usage = [{ left: 0, right: 0 }]
  let pageIndex = 0
  /** @type {'left' | 'right'} */
  let columnKey = 'left'

  const ensurePage = (index) => {
    if (!pages[index]) {
      pages[index] = createPage()
      usage[index] = { left: 0, right: 0 }
    }
  }

  const moveToNextSlot = () => {
    if (columnKey === 'left') {
      columnKey = 'right'
      return
    }

    pageIndex += 1
    ensurePage(pageIndex)
    columnKey = 'left'
  }

  const carryOverflowUsageForward = () => {
    // Oversized chunks stay attached to the slot where they start rendering,
    // but any extra estimated height still consumes following slots so later
    // chunks cannot backfill into space that the overflow has already used.
    let overflow = usage[pageIndex][columnKey] - getSlotCapacity(pageIndex, options)

    while (overflow > 0) {
      logExamPaperDebug('paginate-carry-overflow', {
        pageIndex,
        columnKey,
        overflow,
        slotCapacity: getSlotCapacity(pageIndex, options),
      })
      moveToNextSlot()
      ensurePage(pageIndex)
      usage[pageIndex][columnKey] = overflow
      overflow -= getSlotCapacity(pageIndex, options)
    }
  }

  const placeChunk = (chunk) => {
    ensurePage(pageIndex)
    const capacity = getSlotCapacity(pageIndex, options)
    const currentUsage = usage[pageIndex][columnKey]
    const remaining = capacity - currentUsage

    logExamPaperDebug('paginate-check', {
      pageIndex,
      columnKey,
      chunkId: chunk.id,
      kind: chunk.kind,
      estimatedHeight: chunk.estimatedHeight,
      currentUsage,
      remaining,
      capacity,
    })

    if (currentUsage > 0 && chunk.estimatedHeight > remaining) {
      logExamPaperDebug('paginate-move-next-slot', {
        reason: 'chunk_exceeds_remaining',
        pageIndex,
        columnKey,
        chunkId: chunk.id,
        kind: chunk.kind,
        estimatedHeight: chunk.estimatedHeight,
        remaining,
      })
      moveToNextSlot()
      placeChunk(chunk)
      return
    }

    pages[pageIndex][columnKey].push(chunk)
    usage[pageIndex][columnKey] += chunk.estimatedHeight
    logExamPaperDebug('paginate-placed', {
      pageIndex,
      columnKey,
      chunkId: chunk.id,
      kind: chunk.kind,
      estimatedHeight: chunk.estimatedHeight,
      usageAfter: usage[pageIndex][columnKey],
    })
    carryOverflowUsageForward()
  }

  questionGroups.forEach((group) => {
    group.chunks.forEach((chunk) => {
      placeChunk(chunk)
    })
  })

  const filteredPages = pages.filter((page) => page.left.length > 0 || page.right.length > 0)

  if (options.rebalanceEmptyRightColumn) {
    filteredPages.forEach((page) => {
      if (page.right.length > 0 || page.left.length <= 1) {
        return
      }

      page.right.push(page.left.pop())
    })
  }

  return filteredPages
}
/**
 * @param {Array<{ id: string, estimatedHeight?: number, measuredHeightPx?: number, kind?: string, html?: string }>} chunks
 * @param {{ firstPageColumnHeightPx: number, otherPageColumnHeightPx: number, bottomGuardPx?: number }} options
 * @returns {Array<{ pageIndex: number, columns: [unknown[], unknown[]] }>}
 */
export function paginateMeasuredTwoColumnChunks(chunks, options) {
  const {
    firstPageColumnHeightPx,
    otherPageColumnHeightPx,
    bottomGuardPx = 8,
  } = options

  const pages = [createPage()]
  const usage = [{ left: 0, right: 0 }]
  let pageIndex = 0
  /** @type {'left' | 'right'} */
  let columnKey = 'left'

  const ensurePage = (index) => {
    if (!pages[index]) {
      pages[index] = createPage()
      usage[index] = { left: 0, right: 0 }
    }
  }

  const getCapacity = (index) => Math.max(
    0,
    (index === 0 ? firstPageColumnHeightPx : otherPageColumnHeightPx) - bottomGuardPx
  )

  const moveToNextSlot = () => {
    if (columnKey === 'left') {
      columnKey = 'right'
      return
    }

    pageIndex += 1
    ensurePage(pageIndex)
    columnKey = 'left'
  }

  chunks.forEach((chunk) => {
    ensurePage(pageIndex)
    const height = Math.ceil(chunk.measuredHeightPx || chunk.estimatedHeight || 0)
    const remaining = getCapacity(pageIndex) - usage[pageIndex][columnKey]

    if (usage[pageIndex][columnKey] > 0 && height > remaining) {
      moveToNextSlot()
      ensurePage(pageIndex)
    }

    pages[pageIndex][columnKey].push(chunk)
    usage[pageIndex][columnKey] += height
  })

  return pages
    .filter((page) => page.left.length > 0 || page.right.length > 0)
    .map((page, index) => ({
      pageIndex: index,
      columns: [page.left, page.right],
    }))
}
