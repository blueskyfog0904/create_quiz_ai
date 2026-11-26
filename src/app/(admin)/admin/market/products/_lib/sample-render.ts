import {
  MAX_GENERATED_SAMPLE_PAGE_BYTES,
  MAX_GENERATED_SAMPLE_TOTAL_BYTES,
  MAX_SAMPLE_PAGE_DIMENSION_PX,
  MAX_SAMPLE_PAGE_PIXELS,
  SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS,
  SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS,
  buildMarketSamplePageFileName,
  parseMarketSamplePageSelection,
} from '@/lib/market-pdf-sample-generator'
import type { RenderedSamplePage } from './types'

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('샘플 JPG 데이터를 생성하지 못했습니다.'))
        return
      }

      resolve(blob)
    }, 'image/jpeg', quality)
  })
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs)
    }),
  ])
}

async function renderSamplePdfPages(file: File, samplePageSelection: string): Promise<RenderedSamplePage[]> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await withTimeout(
    pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise,
    SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS,
    '샘플 PDF 문서 로드 시간이 초과되었습니다.'
  )
  const renderedPages: RenderedSamplePage[] = []
  let totalGeneratedBytes = 0

  try {
    const pageNumbers = parseMarketSamplePageSelection(samplePageSelection, pdf.numPages)
    for (const pageNumber of pageNumbers) {
      const pdfPage = await pdf.getPage(pageNumber)
      const baseViewport = pdfPage.getViewport({ scale: 1.5 })
      const dimensionScale = Math.min(1, MAX_SAMPLE_PAGE_DIMENSION_PX / Math.max(baseViewport.width, baseViewport.height))
      const pixelScale = Math.min(1, Math.sqrt(MAX_SAMPLE_PAGE_PIXELS / Math.max(baseViewport.width * baseViewport.height, 1)))
      const safeScale = Math.max(0.1, Math.min(dimensionScale, pixelScale))
      const viewport = safeScale < 1 ? pdfPage.getViewport({ scale: 1.5 * safeScale }) : baseViewport

      if (viewport.width * viewport.height > MAX_SAMPLE_PAGE_PIXELS || Math.max(viewport.width, viewport.height) > MAX_SAMPLE_PAGE_DIMENSION_PX) {
        throw new Error('샘플 PDF 페이지 크기가 허용 범위를 초과했습니다.')
      }

      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) {
        throw new Error('샘플 JPG canvas를 생성하지 못했습니다.')
      }

      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await withTimeout(
        pdfPage.render({ canvas, canvasContext: context, viewport }).promise,
        SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS,
        '샘플 PDF 페이지 렌더링 시간이 초과되었습니다.'
      )

      const blob = await canvasToJpegBlob(canvas, 0.9)
      totalGeneratedBytes += blob.size
      if (blob.size > MAX_GENERATED_SAMPLE_PAGE_BYTES) {
        throw new Error('샘플 JPG 페이지 용량이 허용 범위를 초과했습니다.')
      }
      if (totalGeneratedBytes > MAX_GENERATED_SAMPLE_TOTAL_BYTES) {
        throw new Error('샘플 JPG 전체 용량이 허용 범위를 초과했습니다.')
      }

      renderedPages.push({
        pageNumber,
        originalFileName: file.name,
        storageFileName: buildMarketSamplePageFileName(file.name, pageNumber),
        mimeType: 'image/jpeg',
        blob,
        fileSizeBytes: blob.size,
        widthPx: canvas.width,
        heightPx: canvas.height,
      })
    }

    return renderedPages
  } finally {
    await pdf.destroy()
  }
}

export { canvasToJpegBlob, withTimeout, renderSamplePdfPages }
