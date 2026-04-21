const { chromium } = require('playwright')
const { spawn } = require('child_process')
const { readdirSync, statSync } = require('fs')
const { join } = require('path')
const { homedir } = require('os')
const { pathToFileURL } = require('url')

const REMOTE_DEBUGGING_PORT = 9224
const DOWNLOADS_DIR = join(homedir(), 'Downloads')
const WINDOW_WIDTH = 1728
const WINDOW_HEIGHT = 1117

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForChromeEndpoint(timeoutMs = 30000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}/json/version`)
      if (response.ok) {
        return
      }
    } catch (error) {
      // retry until timeout
    }

    await wait(500)
  }

  throw new Error('Remote debugging Chrome endpoint did not become ready in time')
}

function listPdfCandidates() {
  return readdirSync(DOWNLOADS_DIR)
    .filter((name) => name.endsWith('.pdf') && name.includes('테스트'))
    .map((name) => {
      const absolutePath = join(DOWNLOADS_DIR, name)
      return {
        name,
        absolutePath,
        modifiedMs: statSync(absolutePath).mtimeMs,
      }
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
}

async function waitForLatestPdf(afterMs, timeoutMs = 20000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const latest = listPdfCandidates().find((entry) => entry.modifiedMs >= afterMs)
    if (latest) {
      return latest
    }

    await wait(500)
  }

  throw new Error('No new PDF file appeared in Downloads in time')
}

async function openPdfWorkspace(page) {
  const pdfButton = page.getByRole('button', { name: /PDF로 저장/ })
  await pdfButton.waitFor({ state: 'visible', timeout: 15000 })
  await pdfButton.click()

  await page.getByText('PDF 저장 설정').waitFor({ state: 'visible', timeout: 15000 })

  const examWithAnswersButton = page.getByRole('button', { name: '시험지+답안' })
  if (await examWithAnswersButton.isVisible()) {
    await examWithAnswersButton.click()
  }

  const doubleColumnButton = page.getByRole('button', { name: '2단' })
  await doubleColumnButton.waitFor({ state: 'visible', timeout: 15000 })
  await doubleColumnButton.click()

  await page.waitForTimeout(1500)
}

async function capturePdfPages(context, pdfPath, pages) {
  const pdfPage = await context.newPage()
  await pdfPage.setViewportSize({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT })

  const screenshots = []

  for (const pageNumber of pages) {
    const pdfUrl = `${pathToFileURL(pdfPath).href}#page=${pageNumber}`
    await pdfPage.goto(pdfUrl, { waitUntil: 'load', timeout: 30000 })
    await pdfPage.waitForTimeout(1500)
    const outputPath = `output_saved_pdf_page${pageNumber}.png`
    await pdfPage.screenshot({ path: outputPath, fullPage: true })
    screenshots.push({ pageNumber, outputPath, pdfUrl })
  }

  await pdfPage.close()
  return screenshots
}

async function main() {
  const targetUrl = process.argv[2] || 'http://127.0.0.1:4000/english/library/exam-papers/5a154084-ec01-4780-933e-394fbc9dfd02'

  const chromeProcess = spawn('open', [
    '-na',
    'Google Chrome',
    '--args',
    `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
    '--profile-directory=Default',
    '--new-window',
    '--start-maximized',
    `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
    targetUrl,
  ], {
    stdio: 'ignore',
    detached: true,
  })

  chromeProcess.unref()

  await waitForChromeEndpoint()

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUGGING_PORT}`)
  const context = browser.contexts()[0]
  const page = context.pages().find((entry) => entry.url().includes('/exam-papers/')) || context.pages()[0] || await context.newPage()

  await page.bringToFront()
  await page.setViewportSize({ width: WINDOW_WIDTH, height: WINDOW_HEIGHT })
  await page.waitForLoadState('networkidle', { timeout: 30000 })

  if (page.url().includes('/login')) {
    throw new Error(`Redirected to login instead of exam paper page: ${page.url()}`)
  }

  await openPdfWorkspace(page)
  await page.screenshot({ path: 'output_gui_pdf_workspace_maximized.png', fullPage: true })

  const saveButton = page.getByRole('button', { name: 'PDF 저장' })
  await saveButton.waitFor({ state: 'visible', timeout: 15000 })

  const startedAt = Date.now()
  await saveButton.click()
  await page.waitForTimeout(2500)

  const latestPdf = await waitForLatestPdf(startedAt)
  const screenshots = await capturePdfPages(context, latestPdf.absolutePath, [1, 3, 6])

  console.log(JSON.stringify({
    targetUrl,
    pageUrl: page.url(),
    latestPdf,
    screenshots,
  }, null, 2))

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
