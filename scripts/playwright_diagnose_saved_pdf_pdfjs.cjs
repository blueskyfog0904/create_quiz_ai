const { chromium } = require('playwright')
const { spawn } = require('child_process')
const { readFileSync, writeFileSync } = require('fs')
const { resolve } = require('path')

const REMOTE_DEBUGGING_PORTS = [9226, 9224, 9222]
const EXAM_PAPER_DEBUG_STORAGE_KEY = 'exam-paper-pdf-debug'
const DEFAULT_TARGET_URL = 'http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02'
const DEFAULT_MODE_LABEL = '시험지+답안'
const DEFAULT_LAYOUT_LABEL = '2단'
const DEFAULT_PAGE_NUMBERS = [1, 3, 6]

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parsePageNumbers(argument) {
  if (!argument) {
    return DEFAULT_PAGE_NUMBERS
  }

  return argument
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0)
}

async function resolveChromeEndpoint(timeoutMs = 30000) {
  const explicitCdpUrl = process.env.PDF_DIAG_CDP_URL
  if (explicitCdpUrl) {
    return explicitCdpUrl
  }

  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    for (const port of REMOTE_DEBUGGING_PORTS) {
      try {
        const endpoint = `http://127.0.0.1:${port}`
        const response = await fetch(`${endpoint}/json/version`)
        if (response.ok) {
          return endpoint
        }
      } catch {
        // try next port
      }
    }

    await wait(500)
  }

  throw new Error(
    `Remote debugging Chrome endpoint did not become ready in time. ` +
    `Tried ports: ${REMOTE_DEBUGGING_PORTS.join(', ')}. ` +
    `You can also set PDF_DIAG_CDP_URL=http://127.0.0.1:<port> to attach to an existing Chrome session.`
  )
}

async function clickDialogButtonByText(page, label) {
  await page.evaluate((labelText) => {
    const buttons = Array.from(document.querySelectorAll('[role="dialog"] button'))
    const button = buttons.find((entry) => entry.textContent?.trim() === labelText)

    if (!button) {
      throw new Error(`Dialog button not found: ${labelText}`)
    }

    button.click()
  }, label)
}

async function openPdfWorkspace(page, { modeLabel, layoutLabel }) {
  await page.getByRole('button', { name: /PDF로 저장/ }).first().click()
  await page.getByText('PDF 저장 설정').waitFor({ state: 'visible', timeout: 15000 })

  await clickDialogButtonByText(page, modeLabel)
  await clickDialogButtonByText(page, layoutLabel)
  await page.waitForTimeout(2000)
}

async function waitForBlobTab(context, previousPages, timeoutMs = 15000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const pages = context.pages()
    const nextBlobPage = pages.find((entry) => !previousPages.includes(entry) && entry.url().startsWith('blob:'))

    if (nextBlobPage) {
      return nextBlobPage
    }

    await wait(250)
  }

  throw new Error('Blob PDF tab did not appear in time')
}

async function fetchBlobBytes(page) {
  const pdfBytes = await page.evaluate(async () => {
    const response = await fetch(location.href)
    const buffer = await response.arrayBuffer()
    return Array.from(new Uint8Array(buffer))
  })

  return Uint8Array.from(pdfBytes)
}

async function renderPdfWithPdfJs(page, { pdfBytes, pageNumbers }) {
  const pdfModuleSource = readFileSync(require.resolve('pdfjs-dist/build/pdf.mjs'), 'utf8')
  const pdfWorkerSource = readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8')

  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>', {
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

    const results = []
    const root = document.getElementById('root')

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

      results.push({
        pageNumber,
        width: canvas.width,
        height: canvas.height,
        textItemCount: textContent.items.length,
        pngDataUrl: canvas.toDataURL('image/png'),
      })
    }

    return {
      numPages: pdf.numPages,
      pages: results,
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
      `output_saved_pdf_pdfjs_page${pageResult.pageNumber}.png`
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
  const targetUrl = process.argv[2] || DEFAULT_TARGET_URL
  const modeLabel = process.argv[3] || DEFAULT_MODE_LABEL
  const layoutLabel = process.argv[4] || DEFAULT_LAYOUT_LABEL
  const pageNumbers = parsePageNumbers(process.argv[5])

  let cdpEndpoint

  try {
    cdpEndpoint = await resolveChromeEndpoint(2000)
  } catch {
    if (process.env.PDF_DIAG_SKIP_LAUNCH === '1') {
      throw new Error(
        'No existing Chrome remote debugging endpoint found and PDF_DIAG_SKIP_LAUNCH=1 prevented launching one.'
      )
    }

    const chromeProcess = spawn('open', [
      '-na',
      'Google Chrome',
      '--args',
      `--remote-debugging-port=${REMOTE_DEBUGGING_PORTS[0]}`,
      '--profile-directory=Default',
      '--new-window',
      targetUrl,
    ], {
      stdio: 'ignore',
      detached: true,
    })

    chromeProcess.unref()
    cdpEndpoint = await resolveChromeEndpoint()
  }

  const browser = await chromium.connectOverCDP(cdpEndpoint)
  const context = browser.contexts()[0]
  const page = context.pages().find((entry) => entry.url().includes('/exam-papers/')) ||
    context.pages()[0] ||
    await context.newPage()

  await page.bringToFront()
  await page.waitForLoadState('networkidle', { timeout: 30000 })

  if (page.url().includes('/login')) {
    throw new Error(`Redirected to login instead of exam paper page: ${page.url()}`)
  }

  await page.evaluate((storageKey) => {
    localStorage.setItem(storageKey, '1')
    window.__EXAM_PAPER_PDF_DEBUG__ = true
  }, EXAM_PAPER_DEBUG_STORAGE_KEY)

  await openPdfWorkspace(page, { modeLabel, layoutLabel })

  const previousPages = context.pages().slice()
  await clickDialogButtonByText(page, '새 탭에서 열기')
  const blobPage = await waitForBlobTab(context, previousPages)

  await blobPage.bringToFront()
  await blobPage.waitForLoadState('domcontentloaded', { timeout: 30000 })
  await blobPage.waitForTimeout(1500)

  const pdfBytes = await fetchBlobBytes(blobPage)

  const renderPage = await context.newPage()
  const renderResult = await renderPdfWithPdfJs(renderPage, {
    pdfBytes,
    pageNumbers,
  })
  const outputs = writeRenderedPages(renderResult)

  console.log(JSON.stringify({
    targetUrl,
    pageUrl: page.url(),
    cdpEndpoint,
    blobUrl: blobPage.url(),
    modeLabel,
    layoutLabel,
    pageNumbers,
    renderedPdfPageCount: renderResult.numPages,
    outputs,
  }, null, 2))

  await renderPage.close()
  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
