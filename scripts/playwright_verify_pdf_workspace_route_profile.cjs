const { chromium } = require('playwright')
const { spawn, execSync } = require('child_process')
const { writeFileSync } = require('fs')
const { resolve } = require('path')

const REMOTE_DEBUGGING_PORTS = [9226, 9224, 9222]
const DEFAULT_TARGET_URL = 'http://127.0.0.1:4000/english/library/exam-papers/9a554084-ec01-4780-933e-39f4bc9dfa02'
const COMBOS = [
  { modeKey: 'exam-only', modeLabel: '시험지', layoutKey: 'single', layoutLabel: '1단' },
  { modeKey: 'exam-only', modeLabel: '시험지', layoutKey: 'double', layoutLabel: '2단' },
  { modeKey: 'answer-only', modeLabel: '답안', layoutKey: 'single', layoutLabel: '1단' },
  { modeKey: 'answer-only', modeLabel: '답안', layoutKey: 'double', layoutLabel: '2단' },
  { modeKey: 'exam-with-answers', modeLabel: '시험지+답안', layoutKey: 'single', layoutLabel: '1단' },
  { modeKey: 'exam-with-answers', modeLabel: '시험지+답안', layoutKey: 'double', layoutLabel: '2단' },
]

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
        // keep trying
      }
    }
    await wait(500)
  }

  throw new Error(
    `Remote debugging Chrome endpoint did not become ready in time. Tried ports: ${REMOTE_DEBUGGING_PORTS.join(', ')}`
  )
}

function detectChromeDebugEndpointsFromProcessList() {
  try {
    const output = execSync('ps -Ao pid,command', { encoding: 'utf8' })
    const ports = [...output.matchAll(/--remote-debugging-port=(\d+)/g)]
      .map((match) => Number(match[1]))
      .filter((port) => Number.isInteger(port) && port > 0)

    return [...new Set(ports)].map((port) => `http://127.0.0.1:${port}`)
  } catch {
    return []
  }
}

async function clickButtonByText(page, label, rootSelector = 'button') {
  await page.evaluate(({ labelText, selector }) => {
    const button = Array.from(document.querySelectorAll(selector))
      .find((entry) => entry.textContent?.trim() === labelText)

    if (!button) {
      throw new Error(`Button not found: ${labelText}`)
    }

    button.click()
  }, { labelText: label, selector: rootSelector })
}

async function ensureWorkspaceOpen(page) {
  const dialogCount = await page.locator('[role="dialog"]').count()
  if (dialogCount > 0) {
    return
  }

  await clickButtonByText(page, '📄 PDF로 저장')
  await page.waitForTimeout(1200)
}

async function collectComboMetrics(page, combo) {
  await ensureWorkspaceOpen(page)
  await clickButtonByText(page, combo.modeLabel, '[role="dialog"] button')
  await clickButtonByText(page, combo.layoutLabel, '[role="dialog"] button')
  await page.waitForTimeout(1800)

  return await page.evaluate(async ({ comboValue }) => {
    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms))
    }

    const iframe = document.querySelector('iframe[title="문제지 출력 미리보기"]')
    const doc = iframe?.contentDocument

    if (!doc) {
      return { ...comboValue, error: 'no iframe document' }
    }

    await sleep(100)

    const isDouble = comboValue.layoutKey === 'double'
    const pages = [...doc.querySelectorAll('.preview-page')]
    const results = pages.map((pageEl, pageIndex) => {
      const pageRect = pageEl.getBoundingClientRect()
      const selector = isDouble ? '[data-section-id]' : '[data-block-id]'
      const sectionNodes = [...pageEl.querySelectorAll(selector)]
      const sections = sectionNodes.map((node) => {
        const rect = node.getBoundingClientRect()
        return {
          id: node.getAttribute('data-section-id') || node.getAttribute('data-block-id') || null,
          overflowPx: Number(Math.max(0, rect.bottom - pageRect.bottom).toFixed(2)),
          bottom: Number((rect.bottom - pageRect.top).toFixed(2)),
        }
      })

      const maxOverflowPx = sections.length ? Math.max(...sections.map((section) => section.overflowPx)) : 0
      const maxBottom = sections.length ? Math.max(...sections.map((section) => section.bottom)) : 0
      const bottomRemainingPx = Number((pageRect.height - maxBottom).toFixed(2))

      const columns = isDouble
        ? [...pageEl.querySelectorAll('.two-column-column')].map((columnEl, columnIndex) => {
            const columnRect = columnEl.getBoundingClientRect()
            const columnSections = [...columnEl.querySelectorAll('[data-section-id]')]
            const lastSection = columnSections.at(-1)
            const lastRect = lastSection?.getBoundingClientRect()

            return {
              column: columnIndex + 1,
              sectionCount: columnSections.length,
              lastId: lastSection?.getAttribute('data-section-id') || null,
              bottomRemainingPx: lastRect
                ? Number((columnRect.bottom - lastRect.bottom).toFixed(2))
                : Number(columnRect.height.toFixed(2)),
              empty: columnSections.length === 0,
              hasOverflow: columnSections.some((section) => section.getBoundingClientRect().bottom > pageRect.bottom),
            }
          })
        : []

      const flags = []
      if (maxOverflowPx > 0) flags.push('overflow')
      if (bottomRemainingPx > 160) flags.push('underfill')
      if (sections.length === 0) flags.push('empty-page')
      if (columns.some((column) => column.empty)) flags.push('empty-column')

      return {
        page: pageIndex + 1,
        sectionCount: sections.length,
        maxOverflowPx,
        bottomRemainingPx,
        flags,
        columns,
      }
    })

    return {
      ...comboValue,
      title: doc.title,
      pageCount: results.length,
      pages: results,
    }
  }, { comboValue: combo })
}

async function captureAnomalyScreenshots(page, combo, comboResult) {
  const iframeHandle = await page.locator('iframe[title="문제지 출력 미리보기"]').elementHandle()
  if (!iframeHandle) {
    return []
  }

  const frame = await iframeHandle.contentFrame()
  if (!frame) {
    return []
  }

  const outputs = []
  for (const pageEntry of comboResult.pages.filter((entry) => entry.flags.length > 0)) {
    const outputPath = resolve(
      process.cwd(),
      `output_route_verify_${combo.modeKey}_${combo.layoutKey}_page${pageEntry.page}.png`
    )
    try {
      const pageLocator = frame.locator('.preview-page').nth(pageEntry.page - 1)
      await pageLocator.screenshot({ path: outputPath, timeout: 5000 })
      outputs.push({
        page: pageEntry.page,
        outputPath,
        flags: pageEntry.flags,
      })
    } catch (error) {
      outputs.push({
        page: pageEntry.page,
        outputPath: null,
        flags: [...pageEntry.flags, 'screenshot-failed'],
        screenshotError: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return outputs
}

async function main() {
  const targetUrl = process.argv[2] || DEFAULT_TARGET_URL

  let cdpEndpoint
  try {
    const processEndpoints = detectChromeDebugEndpointsFromProcessList()

    for (const endpoint of processEndpoints) {
      try {
        const response = await fetch(`${endpoint}/json/version`)
        if (response.ok) {
          cdpEndpoint = endpoint
          break
        }
      } catch {
        // keep trying
      }
    }

    if (!cdpEndpoint) {
      cdpEndpoint = await resolveChromeEndpoint(2000)
    }
  } catch {
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
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })

  if (page.url().includes('/login')) {
    throw new Error(`Redirected to login instead of exam paper page: ${page.url()}`)
  }

  const comboResults = []
  for (const combo of COMBOS) {
    const metrics = await collectComboMetrics(page, combo)
    const screenshots = await captureAnomalyScreenshots(page, combo, metrics)
    comboResults.push({
      ...metrics,
      screenshots,
    })
  }

  const output = {
    targetUrl,
    pageUrl: page.url(),
    cdpEndpoint,
    combos: comboResults,
  }

  writeFileSync(
    resolve(process.cwd(), 'output_route_verify_summary.json'),
    JSON.stringify(output, null, 2)
  )

  console.log(JSON.stringify(output, null, 2))

  await browser.close()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
