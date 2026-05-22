export interface GeneratedMarketSamplePage {
  pageNumber: number
  fileName: string
  mimeType: 'image/jpeg'
  fileSizeBytes: number
  widthPx: number
  heightPx: number
  buffer: Buffer
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

export async function generateMarketPdfSamplePages(
  pdfBuffer: Buffer,
  sourceFileName: string,
  maxPages = 3
): Promise<GeneratedMarketSamplePage[]> {
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
    const renderedPages = await page.evaluate(async ({ pdfBase64, pdfModuleSource, pdfWorkerSource, maxPages }) => {
      const moduleUrl = URL.createObjectURL(new Blob([pdfModuleSource], { type: 'text/javascript' }))
      const workerUrl = URL.createObjectURL(new Blob([pdfWorkerSource], { type: 'text/javascript' }))
      try {
        const pdfjsLib = await import(moduleUrl)
        pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
        const binary = atob(pdfBase64)
        const data = new Uint8Array(binary.length)
        for (let index = 0; index < binary.length; index += 1) {
          data[index] = binary.charCodeAt(index)
        }

        const pdf = await pdfjsLib.getDocument({ data }).promise
        const pageCount = Math.min(Math.max(maxPages, 0), pdf.numPages)
        const pages = []
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
          const pdfPage = await pdf.getPage(pageNumber)
          const viewport = pdfPage.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          const context = canvas.getContext('2d', { alpha: false })
          if (!context) {
            throw new Error('샘플 JPG canvas를 생성하지 못했습니다.')
          }

          context.fillStyle = '#fff'
          context.fillRect(0, 0, canvas.width, canvas.height)
          await pdfPage.render({ canvasContext: context, viewport }).promise
          pages.push({
            pageNumber,
            widthPx: canvas.width,
            heightPx: canvas.height,
            dataUrl: canvas.toDataURL('image/jpeg', 0.9),
          })
        }

        return pages
      } finally {
        URL.revokeObjectURL(moduleUrl)
        URL.revokeObjectURL(workerUrl)
      }
    }, {
      pdfBase64: pdfBuffer.toString('base64'),
      pdfModuleSource,
      pdfWorkerSource,
      maxPages,
    })

    return renderedPages.map((page) => {
      const buffer = dataUrlToBuffer(page.dataUrl)
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
    await browser.close()
  }
}
