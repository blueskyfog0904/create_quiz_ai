const { chromium } = require('playwright')
const { spawn } = require('child_process')

const REMOTE_DEBUGGING_PORT = 9222

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

async function main() {
  const targetUrl = process.argv[2] || 'http://127.0.0.1:4000/english/library/exam-papers/374660a7-1b24-4e71-8fe6-54c89e507a67'

  const chromeProcess = spawn('open', [
    '-na',
    'Google Chrome',
    '--args',
    `--remote-debugging-port=${REMOTE_DEBUGGING_PORT}`,
    '--profile-directory=Default',
    '--new-window',
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
  await page.waitForLoadState('networkidle', { timeout: 30000 })

  if (page.url().includes('/login')) {
    throw new Error(`Redirected to login instead of exam paper page: ${page.url()}`)
  }

  await openPdfWorkspace(page)

  console.log(JSON.stringify({ title: await page.title(), url: page.url() }, null, 2))
  await page.screenshot({ path: 'output_playwright_workspace_profile.png', fullPage: true })

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
