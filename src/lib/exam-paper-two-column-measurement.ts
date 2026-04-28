import type { ExamPaper, HtmlPaginationChunk, TwoColumnMeasuredPagePlan } from '@/lib/export-utils'
import {
  buildExamPaperTwoColumnMeasurementHtml,
  renderInlineBracketUnderlineHtml,
} from '@/lib/export-utils'
import { paginateMeasuredTwoColumnChunks } from '@/lib/exam-paper-pdf-pagination.js'
import type { TwoColumnBodyPart } from '@/lib/exam-paper-layout-contract'

interface MeasuredTwoColumnBodyPart extends TwoColumnBodyPart {
  sourcePartStartOffset?: number
  sourcePartEndOffset?: number
}

interface MeasuredTwoColumnChunk extends HtmlPaginationChunk {
  measuredHeightPx: number
  bodyParts?: MeasuredTwoColumnBodyPart[]
}

interface MeasurementResult {
  chunks: MeasuredTwoColumnChunk[]
  firstPageColumnHeightPx: number
  otherPageColumnHeightPx: number
}

interface MeasuredBodyLineChunkSlice {
  bodyRawText: string
  bodyStartOffset: number
  bodyEndOffset: number
}

export async function buildMeasuredTwoColumnPreviewPages({
  examPaper,
  signal,
}: {
  examPaper: ExamPaper
  signal?: AbortSignal
}): Promise<TwoColumnMeasuredPagePlan[]> {
  if (typeof document === 'undefined') {
    throw new Error('2단 DOM 측정 pagination은 브라우저 환경에서만 실행할 수 있습니다.')
  }

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.tabIndex = -1
  iframe.style.position = 'fixed'
  iframe.style.left = '-10000px'
  iframe.style.top = '0'
  iframe.style.width = '220mm'
  iframe.style.height = '310mm'
  iframe.style.visibility = 'hidden'
  iframe.style.pointerEvents = 'none'

  document.body.appendChild(iframe)

  try {
    await writeMeasurementDocument(
      iframe,
      buildExamPaperTwoColumnMeasurementHtml(examPaper),
      signal
    )
    const measured = await readMeasurementResult(iframe, signal)

    return paginateMeasuredTwoColumnChunks(measured.chunks, {
      firstPageColumnHeightPx: measured.firstPageColumnHeightPx,
      otherPageColumnHeightPx: measured.otherPageColumnHeightPx,
      bottomGuardPx: 8,
      forceAnswerStartOnNewPage: examPaper.viewMode === 'exam-with-answers',
    }) as TwoColumnMeasuredPagePlan[]
  } finally {
    iframe.remove()
  }
}

async function writeMeasurementDocument(
  iframe: HTMLIFrameElement,
  html: string,
  signal?: AbortSignal
) {
  if (signal?.aborted) {
    throw new DOMException('Measurement aborted', 'AbortError')
  }

  await new Promise<void>((resolve, reject) => {
    iframe.onload = () => resolve()
    iframe.onerror = () => reject(new Error('2단 측정 iframe 로드에 실패했습니다.'))
    iframe.srcdoc = html
  })

  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('2단 측정 문서에 접근할 수 없습니다.')
  }

  await doc.fonts?.ready
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

async function readMeasurementResult(
  iframe: HTMLIFrameElement,
  signal?: AbortSignal
): Promise<MeasurementResult> {
  if (signal?.aborted) {
    throw new DOMException('Measurement aborted', 'AbortError')
  }

  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('2단 측정 문서에 접근할 수 없습니다.')
  }

  const firstPage = doc.querySelector<HTMLElement>('.measurement-first-page')
  const otherPage = doc.querySelector<HTMLElement>('.measurement-other-page')
  const firstColumn = doc.querySelector<HTMLElement>('[data-measurement-column="first"]')
  const otherColumn = doc.querySelector<HTMLElement>('[data-measurement-column="other"]')

  if (!firstPage || !otherPage || !firstColumn || !otherColumn) {
    throw new Error('2단 측정 DOM 구조가 올바르지 않습니다.')
  }

  return {
    chunks: [...firstColumn.querySelectorAll<HTMLElement>('[data-section-id]')]
      .flatMap((element) => toMeasuredChunks(element))
      .filter((chunk) => chunk.id && chunk.measuredHeightPx > 0),
    firstPageColumnHeightPx: measureUsableColumnHeight(firstPage, firstColumn),
    otherPageColumnHeightPx: measureUsableColumnHeight(otherPage, otherColumn),
  }
}

function toMeasuredChunks(element: HTMLElement): MeasuredTwoColumnChunk[] {
  const baseChunk: MeasuredTwoColumnChunk = {
    id: element.dataset.sectionId ?? '',
    estimatedHeight: Number(element.dataset.estimatedHeight ?? '0'),
    kind: normalizeChunkKind(element.dataset.sectionKind),
    html: element.outerHTML,
    sourceSectionId: element.dataset.sourceSectionId ?? element.dataset.sectionId ?? undefined,
    questionNumber: parseOptionalNumber(element.dataset.questionNumber),
    bodyParts: decodeBodyPartsDataAttribute(element.dataset.bodyParts),
    measuredHeightPx: measureOuterHeight(element),
  }

  if (baseChunk.kind !== 'body') {
    return [baseChunk]
  }

  return splitMeasuredBodyElementIntoLineChunks(element, baseChunk)
}

function splitMeasuredBodyElementIntoLineChunks(
  element: HTMLElement,
  baseChunk: MeasuredTwoColumnChunk
): MeasuredTwoColumnChunk[] {
  const rawText = decodeExactBodyRawText(element.dataset.bodyRawTextExact)
    ?? element.dataset.bodyRawText
    ?? ''
  const flowElement = element.querySelector<HTMLElement>('.flow-body-text')

  if (!flowElement || !rawText.trim()) {
    return [{
      ...baseChunk,
      html: '',
      bodyRawText: rawText,
      bodyStartOffset: 0,
      bodyEndOffset: rawText.length,
      bodyLineIndex: 0,
      bodyLineCount: 1,
    }]
  }

  const lineHeightPx = resolveLineHeightPx(flowElement)
  const flowRect = flowElement.getBoundingClientRect()
  const trailingGapPx = Math.max(0, measureOuterHeight(element) - flowRect.height)
  const lineSlices = measureBodyLines(rawText, flowElement)
  const supplementalInset = measureSupplementalInset(flowElement)

  return lineSlices.map((lineSlice, index) => {
    const supplementalInsetPx = calculateSupplementalInsetForLine(
      baseChunk.bodyParts,
      lineSlice,
      supplementalInset
    )

    return {
      ...baseChunk,
      id: `${baseChunk.id}-line-${index + 1}`,
      html: '',
      bodyRawText: lineSlice.bodyRawText,
      bodyStartOffset: lineSlice.bodyStartOffset,
      bodyEndOffset: lineSlice.bodyEndOffset,
      bodyLineIndex: index,
      bodyLineCount: lineSlices.length,
      bodyParts: sliceBodyParts(baseChunk.bodyParts, lineSlice.bodyStartOffset, lineSlice.bodyEndOffset),
      measuredHeightPx: lineHeightPx + supplementalInsetPx + (index === lineSlices.length - 1 ? trailingGapPx : 0),
    }
  })
}

function decodeBodyPartsDataAttribute(value: string | undefined) {
  if (!value) {
    return undefined
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as TwoColumnBodyPart[]

    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function sliceBodyParts(
  bodyParts: MeasuredTwoColumnBodyPart[] | undefined,
  startOffset: number,
  endOffset: number
) {
  if (!bodyParts || bodyParts.length === 0) {
    return undefined
  }

  const slicedParts = bodyParts.flatMap((part) => {
    const start = Math.max(part.startOffset, startOffset)
    const end = Math.min(part.endOffset, endOffset)

    if (start >= end) {
      return []
    }

    return [{
      sectionKey: part.sectionKey,
      text: part.text.slice(start - part.startOffset, end - part.startOffset),
      startOffset: start,
      endOffset: end,
      sourcePartStartOffset: part.sourcePartStartOffset ?? part.startOffset,
      sourcePartEndOffset: part.sourcePartEndOffset ?? part.endOffset,
    }]
  })

  return slicedParts.length > 0 ? slicedParts : undefined
}

function measureSupplementalInset(flowElement: HTMLElement) {
  const supplementalElement = flowElement.querySelector<HTMLElement>('.flow-body-supplemental')
  const view = flowElement.ownerDocument.defaultView
  const style = supplementalElement ? view?.getComputedStyle(supplementalElement) : undefined

  return {
    startPx: (
      parseCssPixelValue(style?.paddingTop)
      + parseCssPixelValue(style?.borderTopWidth)
    ),
    endPx: (
      parseCssPixelValue(style?.paddingBottom)
      + parseCssPixelValue(style?.borderBottomWidth)
    ),
  }
}

function calculateSupplementalInsetForLine(
  bodyParts: MeasuredTwoColumnBodyPart[] | undefined,
  lineSlice: MeasuredBodyLineChunkSlice,
  supplementalInset: { startPx: number; endPx: number }
) {
  if (!bodyParts || bodyParts.length === 0) {
    return 0
  }

  return bodyParts.reduce((heightPx, part) => {
    if (!isSupplementalBodyPart(part)) {
      return heightPx
    }

    const intersectsLine = part.startOffset < lineSlice.bodyEndOffset && part.endOffset > lineSlice.bodyStartOffset

    if (!intersectsLine) {
      return heightPx
    }

    const startsInLine = part.startOffset >= lineSlice.bodyStartOffset && part.startOffset < lineSlice.bodyEndOffset
    const endsInLine = part.endOffset > lineSlice.bodyStartOffset && part.endOffset <= lineSlice.bodyEndOffset

    return heightPx
      + (startsInLine ? supplementalInset.startPx : 0)
      + (endsInLine ? supplementalInset.endPx : 0)
  }, 0)
}

function measureBodyLines(
  rawText: string,
  referenceFlowElement: HTMLElement
): MeasuredBodyLineChunkSlice[] {
  const probe = createBodyLineMeasurementProbe(referenceFlowElement)
  const lines: MeasuredBodyLineChunkSlice[] = []

  try {
    let startOffset = 0

    while (startOffset < rawText.length) {
      const remainingText = rawText.slice(startOffset)
      const fittingOffset = findLargestFittingOffset(remainingText, probe)
      const snappedOffset = snapOffsetToWordBoundary(remainingText, fittingOffset)
      const relativeEndOffset = Math.max(1, snappedOffset || fittingOffset)
      const endOffset = Math.min(rawText.length, startOffset + relativeEndOffset)
      const bodyRawText = rawText.slice(startOffset, endOffset)

      if (!bodyRawText) {
        break
      }

      lines.push({
        bodyRawText,
        bodyStartOffset: startOffset,
        bodyEndOffset: endOffset,
      })
      startOffset = endOffset
    }
  } finally {
    probe.host.remove()
  }

  return lines.length > 0
    ? lines
    : [{
      bodyRawText: rawText,
      bodyStartOffset: 0,
      bodyEndOffset: rawText.length,
    }]
}

function createBodyLineMeasurementProbe(referenceFlowElement: HTMLElement) {
  const doc = referenceFlowElement.ownerDocument
  const view = doc.defaultView
  const referenceStyle = view?.getComputedStyle(referenceFlowElement)
  const referenceRect = referenceFlowElement.getBoundingClientRect()
  const host = doc.createElement('div')
  const probe = doc.createElement('div')

  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  host.style.width = `${referenceRect.width}px`

  probe.className = 'flow-body-text'
  probe.style.margin = '0'
  probe.style.width = '100%'
  probe.style.fontFamily = referenceStyle?.fontFamily ?? ''
  probe.style.fontSize = referenceStyle?.fontSize ?? ''
  probe.style.fontWeight = referenceStyle?.fontWeight ?? ''
  probe.style.fontStyle = referenceStyle?.fontStyle ?? ''
  probe.style.letterSpacing = referenceStyle?.letterSpacing ?? ''
  probe.style.wordSpacing = referenceStyle?.wordSpacing ?? ''
  probe.style.lineHeight = referenceStyle?.lineHeight ?? ''
  probe.style.whiteSpace = referenceStyle?.whiteSpace ?? 'normal'
  probe.style.wordBreak = referenceStyle?.wordBreak ?? 'normal'
  probe.style.overflowWrap = referenceStyle?.overflowWrap ?? 'normal'
  probe.style.textTransform = referenceStyle?.textTransform ?? 'none'
  probe.style.hyphens = referenceStyle?.hyphens ?? 'manual'

  host.appendChild(probe)
  doc.body.appendChild(host)

  return {
    host,
    probe,
    maxSingleLineHeightPx: resolveLineHeightPx(referenceFlowElement) * 1.2,
  }
}

function findLargestFittingOffset(
  text: string,
  probe: ReturnType<typeof createBodyLineMeasurementProbe>
) {
  let low = 1
  let high = text.length
  let best = 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)

    if (fitsSingleRenderedLine(text.slice(0, mid), probe)) {
      best = mid
      low = mid + 1
      continue
    }

    high = mid - 1
  }

  return best
}

function fitsSingleRenderedLine(
  text: string,
  probe: ReturnType<typeof createBodyLineMeasurementProbe>
) {
  probe.probe.innerHTML = renderInlineBracketUnderlineHtml(text.trimEnd())

  return probe.probe.getBoundingClientRect().height <= probe.maxSingleLineHeightPx
}

function snapOffsetToWordBoundary(text: string, offset: number) {
  const newlineOffset = text.lastIndexOf('\n', offset - 1)

  if (newlineOffset >= 0) {
    return newlineOffset + 1
  }

  if (offset >= text.length) {
    return text.length
  }

  for (let index = offset; index > 0; index -= 1) {
    if (/\s/u.test(text[index - 1])) {
      return index
    }
  }

  return offset
}

function measureUsableColumnHeight(page: HTMLElement, column: HTMLElement) {
  const pageRect = page.getBoundingClientRect()
  const columnRect = column.getBoundingClientRect()
  const pageStyle = page.ownerDocument.defaultView?.getComputedStyle(page)
  const paddingBottom = Number.parseFloat(pageStyle?.paddingBottom ?? '0') || 0

  return Math.max(0, pageRect.bottom - paddingBottom - columnRect.top)
}

function measureOuterHeight(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const marginTop = Number.parseFloat(style?.marginTop ?? '0') || 0
  const marginBottom = Number.parseFloat(style?.marginBottom ?? '0') || 0

  return rect.height + marginTop + marginBottom
}

function parseCssPixelValue(value: string | undefined) {
  const parsed = Number.parseFloat(value ?? '0')
  return Number.isFinite(parsed) ? parsed : 0
}

function isSupplementalBodyPart(part: TwoColumnBodyPart) {
  return part.sectionKey === 'forward' || part.sectionKey === 'backward'
}

function resolveLineHeightPx(element: HTMLElement) {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  const resolvedLineHeight = Number.parseFloat(style?.lineHeight ?? '')

  if (Number.isFinite(resolvedLineHeight) && resolvedLineHeight > 0) {
    return resolvedLineHeight
  }

  const fontSizePx = Number.parseFloat(style?.fontSize ?? '0') || 0
  return fontSizePx > 0 ? fontSizePx * 1.6 : 0
}

function parseOptionalNumber(value: string | undefined) {
  if (typeof value !== 'string' || !value) {
    return undefined
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalizeChunkKind(kind: string | undefined): HtmlPaginationChunk['kind'] {
  if (kind === 'header' || kind === 'body' || kind === 'choice' || kind === 'answer' || kind === 'explanation') {
    return kind
  }

  return 'body'
}

function decodeExactBodyRawText(value: string | undefined) {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }

  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
