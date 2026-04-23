const { chromium } = require('playwright')
const { readFileSync, writeFileSync, existsSync } = require('fs')
const { resolve } = require('path')

const DEFAULT_PAGE_NUMBERS = [1, 3, 6]

function parsePageNumbers(argument) {
  if (!argument) {
    return DEFAULT_PAGE_NUMBERS
  }

  return argument
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
}

async function renderPdfFileWithPdfJs(page, { pdfFilePath, pageNumbers }) {
  const pdfModuleSource = readFileSync(require.resolve('pdfjs-dist/build/pdf.mjs'), 'utf8')
  const pdfWorkerSource = readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8')
  const pdfBytes = readFileSync(pdfFilePath)

  await page.setContent('<!doctype html><html><body><div id=\"root\"></div></body></html>', {
    waitUntil: 'domcontentloaded',
  })

  return await page.evaluate(async ({
    pdfBytesArray,
    renderPageNumbers,
    moduleSource,
    workerSource,
  }) => {
    const moduleUrl = URL.createObjectURL(new Blob([moduleSource], { type: 'text/javascript' }))
    const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    const pdfjsLib = await import(moduleUrl)

    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(pdfBytesArray),
      useWorkerFetch: false,
      isEvalSupported: false,
    }).promise

    const root = document.getElementById('root')
    const pages = []

    for (const pageNumber of renderPageNumbers) {
      const pdfPage = await pdf.getPage(pageNumber)
      const viewport = pdfPage.getViewport({ scale: 1 })
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { alpha: false })

      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      root.appendChild(canvas)

      await pdfPage.render({
        canvasContext: context,
        viewport,
      }).promise

      const textContent = await pdfPage.getTextContent()

      pages.push({
        pageNumber,
        width: canvas.width,
        height: canvas.height,
        textItemCount: textContent.items.length,
        pngDataUrl: canvas.toDataURL('image/png'),
      })
    }

    return {
      numPages: pdf.numPages,
      pages,
    }
  }, {
    pdfBytesArray: Array.from(pdfBytes),
    renderPageNumbers: pageNumbers,
    moduleSource: pdfModuleSource,
    workerSource: pdfWorkerSource,
  })
}

function writeRenderedPages(renderResult) {
  const outputs = []

  renderResult.pages.forEach((pageResult) => {
    const outputPath = resolve(
      process.cwd(),
      `output_saved_pdf_file_page${pageResult.pageNumber}.png`
    )
    const pngBase64 = pageResult.pngDataUrl.replace(/^data:image\/png;base64,/, '')

    writeFileSync(outputPath, Buffer.from(pngBase64, 'base64'))

    outputs.push({
      pageNumber: pageResult.pageNumber,
      outputPath,
      width: pageResult.width,
      height: pageResult.height,
      textItemCount: pageResult.textItemCount,
    })
  })

  return outputs
}

async function main() {
  const pdfFilePath = process.argv[2]
  const pageNumbers = parsePageNumbers(process.argv[3])

  if (!pdfFilePath) {
    throw new Error('Usage: node scripts/render_pdf_file_with_pdfjs.cjs <pdf-file-path> [pageNumbersCsv]')
  }

  const absolutePdfFilePath = resolve(process.cwd(), pdfFilePath)

  if (!existsSync(absolutePdfFilePath)) {
    throw new Error(`PDF file does not exist: ${absolutePdfFilePath}`)
  }

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const renderResult = await renderPdfFileWithPdfJs(page, {
    pdfFilePath: absolutePdfFilePath,
    pageNumbers,
  })
  const outputs = writeRenderedPages(renderResult)

  console.log(JSON.stringify({
    pdfFilePath: absolutePdfFilePath,
    pageNumbers,
    renderedPdfPageCount: renderResult.numPages,
    outputs,
  }, null, 2))

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
