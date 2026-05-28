export const MAX_SAMPLE_PAGE_PIXELS = 12_000_000
export const MAX_SAMPLE_PAGE_DIMENSION_PX = 5_000
export const MAX_GENERATED_SAMPLE_PAGE_BYTES = 3 * 1024 * 1024
export const MAX_GENERATED_SAMPLE_TOTAL_BYTES = 9 * 1024 * 1024
export const SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS = 10_000
export const SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS = 10_000

export interface GeneratedMarketSamplePage {
  pageNumber: number
  fileName: string
  mimeType: 'image/jpeg'
  fileSizeBytes: number
  widthPx: number
  heightPx: number
  buffer: Buffer
}

type MarketPdfSampleBrowserGlobal = typeof globalThis & {
  __marketPdfSamplePdfjsLib?: {
    GlobalWorkerOptions: {
      workerSrc: string
    }
    getDocument: (options: { data: Uint8Array }) => {
      promise: Promise<{
        numPages: number
        getPage: (pageNumber: number) => Promise<{
          getViewport: (options: { scale: number }) => { width: number; height: number }
          render: (options: {
            canvasContext: CanvasRenderingContext2D
            viewport: { width: number; height: number }
          }) => { promise: Promise<void> }
        }>
      }>
    }
  }
  __marketPdfSamplePdfjsReady?: Promise<void>
  __marketPdfSamplePdfjsResolve?: () => void
  __marketPdfSamplePdfjsReject?: (error: Error) => void
  __marketPdfSamplePdfjsErrorHandler?: (event: ErrorEvent) => void
}

function buildSampleFileName(sourceFileName: string, pageNumber: number) {
  const baseName = sourceFileName.replace(/\.[^.]+$/, '') || 'sample'
  return `${baseName}-sample-page-${String(pageNumber).padStart(3, '0')}.jpg`
}

function dataUrlToBuffer(dataUrl: string) {
  const base64 = dataUrl.split(',')[1]
  if (!base64) {
    throw new Error('샘플 JPG 데이터를 생성하지 못했습니다.')
  }

  return Buffer.from(base64, 'base64')
}

export function parseMarketSamplePageSelection(input: string, maxPageCount?: number): number[] {
  const pageNumbers = input
    .split(',')
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value))
  const dedupedPageNumbers = Array.from(new Set(pageNumbers))

  if (dedupedPageNumbers.length === 0) {
    throw new Error('샘플로 생성할 페이지 번호를 입력해주세요.')
  }

  for (const pageNumber of dedupedPageNumbers) {
    if (pageNumber < 1) {
      throw new Error('샘플 페이지 번호는 1 이상의 정수여야 합니다.')
    }

    if (maxPageCount !== undefined && pageNumber > maxPageCount) {
      throw new Error('샘플 페이지 번호가 PDF 전체 페이지 수를 초과했습니다.')
    }
  }

  return dedupedPageNumbers
}

function buildDefaultSamplePageNumbers(maxPages: number) {
  return Array.from({ length: Math.max(maxPages, 0) }, (_, index) => index + 1)
}

export async function generateMarketPdfSamplePages(
  pdfBuffer: Buffer,
  sourceFileName: string,
  pageSelection: number | number[] = 3
): Promise<GeneratedMarketSamplePage[]> {
  const pageNumbers = Array.isArray(pageSelection) ? pageSelection : buildDefaultSamplePageNumbers(pageSelection)
  const [{ chromium }, { readFile }, { createRequire }] = await Promise.all([
    import('playwright'),
    import('node:fs/promises'),
    import('node:module'),
  ])
  const require = createRequire(import.meta.url)
  const [pdfModuleSource, pdfWorkerSource] = await Promise.all([
    readFile(require.resolve('pdfjs-dist/build/pdf.mjs'), 'utf8'),
    readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8'),
  ])

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const moduleHandles = await page.evaluate(({ pdfModuleSource, pdfWorkerSource }) => {
      const moduleUrl = URL.createObjectURL(new Blob([pdfModuleSource], { type: 'text/javascript' }))
      const workerUrl = URL.createObjectURL(new Blob([pdfWorkerSource], { type: 'text/javascript' }))
      const browserGlobal = globalThis as MarketPdfSampleBrowserGlobal
      browserGlobal.__marketPdfSamplePdfjsReady = new Promise((resolve, reject) => {
        browserGlobal.__marketPdfSamplePdfjsResolve = resolve
        browserGlobal.__marketPdfSamplePdfjsReject = reject
      })
      browserGlobal.__marketPdfSamplePdfjsErrorHandler = (event) => {
        browserGlobal.__marketPdfSamplePdfjsReject?.(
          new Error(event.message || 'PDF.js 모듈을 로드하지 못했습니다.')
        )
      }
      window.addEventListener('error', browserGlobal.__marketPdfSamplePdfjsErrorHandler)

      return { moduleUrl, workerUrl }
    }, {
      pdfModuleSource,
      pdfWorkerSource,
    })

    try {
      await page.addScriptTag({
        type: 'module',
        content: [
          `import * as pdfjsLib from ${JSON.stringify(moduleHandles.moduleUrl)}`,
          'globalThis.__marketPdfSamplePdfjsLib = pdfjsLib',
          'globalThis.removeEventListener(\'error\', globalThis.__marketPdfSamplePdfjsErrorHandler)',
          'globalThis.__marketPdfSamplePdfjsResolve()',
        ].join('\n'),
      })

      await page.evaluate(async () => {
        const browserGlobal = globalThis as MarketPdfSampleBrowserGlobal
        const ready = browserGlobal.__marketPdfSamplePdfjsReady
        if (!ready) {
          throw new Error('PDF.js 모듈 로드 상태를 확인하지 못했습니다.')
        }

        await Promise.race([
          ready,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('PDF.js 모듈 로드 시간이 초과되었습니다.')), 10000)
          }),
        ])
      })

      const renderedPages = await page.evaluate(async ({ pdfBase64, workerUrl, pageNumbers, limits }) => {
        const browserGlobal = globalThis as MarketPdfSampleBrowserGlobal
        const pdfjsLib = browserGlobal.__marketPdfSamplePdfjsLib
        if (!pdfjsLib) {
          throw new Error('PDF.js 모듈을 로드하지 못했습니다.')
        }

        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
        const binary = atob(pdfBase64)
        const data = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          data[index] = binary.charCodeAt(index)
        }

        const pdf = await Promise.race([
          pdfjsLib.getDocument({ data }).promise,
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('샘플 PDF 문서 로드 시간이 초과되었습니다.')), limits.documentLoadTimeoutMs)),
        ])
        const pages = []
        for (const pageNumber of pageNumbers) {
          if (pageNumber < 1 || pageNumber > pdf.numPages) {
            throw new Error('샘플 페이지 번호가 PDF 전체 페이지 수를 초과했습니다.')
          }

          const pdfPage = await pdf.getPage(pageNumber)
          const baseViewport = pdfPage.getViewport({ scale: 1.5 })
          const dimensionScale = Math.min(1, limits.maxDimensionPx / Math.max(baseViewport.width, baseViewport.height))
          const pixelScale = Math.min(1, Math.sqrt(limits.maxPagePixels / Math.max(baseViewport.width * baseViewport.height, 1)))
          const safeScale = Math.max(0.1, Math.min(dimensionScale, pixelScale))
          const viewport = safeScale < 1 ? pdfPage.getViewport({ scale: 1.5 * safeScale }) : baseViewport
          if (viewport.width * viewport.height > limits.maxPagePixels || Math.max(viewport.width, viewport.height) > limits.maxDimensionPx) {
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
          await Promise.race([
            pdfPage.render({ canvasContext: context, viewport }).promise,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('샘플 PDF 페이지 렌더링 시간이 초과되었습니다.')), limits.pageRenderTimeoutMs)),
          ])
          pages.push({
            pageNumber,
            widthPx: canvas.width,
            heightPx: canvas.height,
            dataUrl: canvas.toDataURL('image/jpeg', 0.9),
          })
        }

        return pages
      }, {
        pdfBase64: pdfBuffer.toString('base64'),
        workerUrl: moduleHandles.workerUrl,
        pageNumbers: pageNumbers,
        limits: {
          maxPagePixels: MAX_SAMPLE_PAGE_PIXELS,
          maxDimensionPx: MAX_SAMPLE_PAGE_DIMENSION_PX,
          documentLoadTimeoutMs: SAMPLE_PDF_DOCUMENT_LOAD_TIMEOUT_MS,
          pageRenderTimeoutMs: SAMPLE_PDF_PAGE_RENDER_TIMEOUT_MS,
        },
      })

      let totalGeneratedBytes = 0
      return renderedPages.map((page) => {
        const buffer = dataUrlToBuffer(page.dataUrl)
        totalGeneratedBytes += buffer.byteLength
        if (buffer.byteLength > MAX_GENERATED_SAMPLE_PAGE_BYTES) {
          throw new Error('샘플 JPG 페이지 용량이 허용 범위를 초과했습니다.')
        }
        if (totalGeneratedBytes > MAX_GENERATED_SAMPLE_TOTAL_BYTES) {
          throw new Error('샘플 JPG 전체 용량이 허용 범위를 초과했습니다.')
        }
        return {
          pageNumber: page.pageNumber,
          fileName: buildSampleFileName(sourceFileName, page.pageNumber),
          mimeType: 'image/jpeg',
          fileSizeBytes: buffer.byteLength,
          widthPx: page.widthPx,
          heightPx: page.heightPx,
          buffer,
        }
      })
    } finally {
      await page.evaluate(({ moduleUrl, workerUrl }) => {
        const browserGlobal = globalThis as MarketPdfSampleBrowserGlobal
        if (browserGlobal.__marketPdfSamplePdfjsErrorHandler) {
          window.removeEventListener('error', browserGlobal.__marketPdfSamplePdfjsErrorHandler)
        }
        URL.revokeObjectURL(moduleUrl)
        URL.revokeObjectURL(workerUrl)
        delete browserGlobal.__marketPdfSamplePdfjsLib
        delete browserGlobal.__marketPdfSamplePdfjsReady
        delete browserGlobal.__marketPdfSamplePdfjsResolve
        delete browserGlobal.__marketPdfSamplePdfjsReject
        delete browserGlobal.__marketPdfSamplePdfjsErrorHandler
      }, moduleHandles).catch(() => undefined)
    }
  } finally {
    await browser.close()
  }
}
