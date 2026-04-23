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
    const commands = output
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^\d+\s+/, ''))
      .filter((command) => command.includes('--remote-debugging-port='))
      .filter((command) => !command.includes('/Library/Caches/ms-playwright/mcp-chrome'))

    const ports = commands
      .flatMap((command) => [...command.matchAll(/--remote-debugging-port=(\d+)/g)])
      .map((match) => Number(match[1]))
      .filter((port) => Number.isInteger(port) && port > 0)

    return [...new Set(ports)].map((port) => `http://127.0.0.1:${port}`)
  } catch {
    return []
  }
}

async function clickButtonByText(page, label, rootSelector = 'button') {
  const button = page.locator(rootSelector).filter({ hasText: label }).first()
  await button.waitFor({ state: 'visible', timeout: 5000 })
  await button.click({ timeout: 5000 })
}

async function clickFirstAvailableButton(page, labels, rootSelector = 'button') {
  let lastError = null

  for (const label of labels) {
    try {
      await clickButtonByText(page, label, rootSelector)
      return label
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error(`Buttons not found: ${labels.join(', ')}`)
}

async function ensureWorkspaceOpen(page) {
  const dialogOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')))
  if (dialogOpen) {
    console.log('[workspace] dialog already open')
    return
  }

  console.log('[workspace] opening dialog')
  const openLabel = await clickFirstAvailableButton(page, ['📄 PDF로 저장', 'PDF로 저장', 'PDF 저장', 'PDF 저장 설정'])
  console.log(`[workspace] clicked opener=${openLabel}`)
  await page.waitForTimeout(1200)
  console.log('[workspace] dialog open wait complete')
}

function buildExpectedTitle(combo) {
  const modeSuffix = combo.modeKey === 'answer-only'
    ? ' - 답안'
    : combo.modeKey === 'exam-only'
      ? ' - 시험지'
      : ''
  const layoutSuffix = combo.layoutKey === 'double' ? ' (2단)' : ''
  return `테스트${modeSuffix}${layoutSuffix}`
}

async function capturePreviewState(page, combo) {
  const expectedTitle = buildExpectedTitle(combo)
  const selector = combo.layoutKey === 'double' ? '[data-section-id]' : '[data-block-id]'

  return page.evaluate(({ expectedTitleText, expectedLayoutLabel, selectorText }) => {
    const dialog = document.querySelector('[role="dialog"]')
    const overlayVisible = dialog?.textContent?.includes('PDF 미리보기를 갱신하고 있습니다') ?? false
    const headerTitle = Array.from(dialog?.querySelectorAll('span') || [])
      .find((entry) => entry.textContent?.trim() === expectedTitleText)
      ?.textContent
      ?.trim() || ''
    const layoutChip = Array.from(dialog?.querySelectorAll('span') || [])
      .find((entry) => entry.textContent?.trim() === expectedLayoutLabel)
      ?.textContent
      ?.trim() || ''

    const iframe = document.querySelector('iframe[title="문제지 출력 미리보기"]')
    const doc = iframe?.contentDocument
    const frameTitle = doc?.querySelector('.preview-page h1')?.textContent?.trim() || ''
    const docTitle = doc?.title?.trim() || ''
    const nodeCount = doc?.querySelectorAll(selectorText).length || 0
    const pageCount = doc?.querySelectorAll('.preview-page').length || 0

    const missing = []
    if (!dialog) missing.push('no-dialog')
    if (overlayVisible) missing.push('overlay-visible')
    if (headerTitle !== expectedTitleText) missing.push(`header-title:${headerTitle || '∅'}`)
    if (layoutChip !== expectedLayoutLabel) missing.push(`layout-chip:${layoutChip || '∅'}`)
    if (!doc) missing.push('no-iframe-doc')
    if (frameTitle !== expectedTitleText) missing.push(`frame-title:${frameTitle || '∅'}`)
    if (docTitle !== expectedTitleText) missing.push(`doc-title:${docTitle || '∅'}`)
    if (nodeCount <= 0) missing.push(`node-count:${nodeCount}`)
    if (pageCount <= 0) missing.push(`page-count:${pageCount}`)

    return {
      ready: missing.length === 0,
      expectedTitle: expectedTitleText,
      expectedLayoutLabel,
      selector: selectorText,
      overlayVisible,
      headerTitle,
      layoutChip,
      frameTitle,
      docTitle,
      nodeCount,
      pageCount,
      missing,
    }
  }, {
    expectedTitleText: expectedTitle,
    expectedLayoutLabel: combo.layoutLabel,
    selectorText: selector,
  })
}

async function waitForWorkspacePreview(page, combo) {
  const comboId = `${combo.modeKey}/${combo.layoutKey}`
  const expectedSelector = combo.layoutKey === 'double' ? '[data-section-id]' : '[data-block-id]'
  console.log(`[preview] start combo=${comboId}`)

  const startedAt = Date.now()
  let state = await capturePreviewState(page, combo)

  while (!state.ready && Date.now() - startedAt < 15000) {
    console.log(`[preview][wait][${comboId}]`, JSON.stringify(state))
    await page.waitForTimeout(300)
    state = await capturePreviewState(page, combo)
  }

  if (!state.ready) {
    console.error(`[preview][timeout][${comboId}]`, JSON.stringify(state, null, 2))
    throw new Error(`preview never ready for ${comboId}`)
  }

  let stableCount = 0
  let previousSignature = null
  let loop = 0
  const maxLoop = 120

  while (stableCount < 3 && loop < maxLoop) {
    loop += 1
    const signature = await page.evaluate(({ selector }) => {
      const iframe = document.querySelector('iframe[title="문제지 출력 미리보기"]')
      const doc = iframe?.contentDocument

      if (!doc) {
        return null
      }

      const frameTitle = doc.querySelector('.preview-page h1')?.textContent?.trim() || ''
      const docTitle = doc.title?.trim() || ''
      const pageCount = doc.querySelectorAll('.preview-page').length
      const nodes = [...doc.querySelectorAll(selector)]
      const nodeCount = nodes.length
      const firstId = nodes[0]?.getAttribute('data-section-id') || nodes[0]?.getAttribute('data-block-id') || ''
      const lastId = nodes.at(-1)?.getAttribute('data-section-id') || nodes.at(-1)?.getAttribute('data-block-id') || ''
      return `${docTitle}::${frameTitle}::${pageCount}::${nodeCount}::${firstId}::${lastId}`
    }, { selector: expectedSelector })

    if (signature && signature === previousSignature) {
      stableCount += 1
    } else {
      console.log(`[preview][stabilize][${comboId}] loop=${loop}`, JSON.stringify({ previousSignature, signature }))
      previousSignature = signature
      stableCount = 1
    }

    await page.waitForTimeout(250)
  }

  if (loop >= maxLoop) {
    throw new Error(`preview did not stabilize for ${comboId}`)
  }
}

async function collectComboMetrics(page, combo) {
  console.log(`[combo] ensure workspace ${combo.modeKey}/${combo.layoutKey}`)
  await ensureWorkspaceOpen(page)
  console.log(`[combo] click mode ${combo.modeKey}/${combo.layoutKey} -> ${combo.modeLabel}`)
  await clickButtonByText(page, combo.modeLabel, '[role="dialog"] button')
  console.log(`[combo] click layout ${combo.modeKey}/${combo.layoutKey} -> ${combo.layoutLabel}`)
  await clickButtonByText(page, combo.layoutLabel, '[role="dialog"] button')
  console.log(`[combo] wait preview ${combo.modeKey}/${combo.layoutKey}`)
  await waitForWorkspacePreview(page, combo)

  return await page.evaluate(async ({ comboValue }) => {
    const iframe = document.querySelector('iframe[title="문제지 출력 미리보기"]')
    const doc = iframe?.contentDocument

    if (!doc) {
      return { ...comboValue, error: 'no iframe document' }
    }

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
      const hasUnderfill = isDouble
        ? columns.some((column) => !column.empty && column.bottomRemainingPx > 160)
        : bottomRemainingPx > 160

      if (maxOverflowPx > 0) flags.push('overflow')
      if (hasUnderfill) flags.push('underfill')
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
  let browser
  let context
  let page
  let connectionMode = 'launch'

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
    try {
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
    } catch {
      cdpEndpoint = null
    }
  }

  if (cdpEndpoint) {
    try {
      browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 30000 })
      context = browser.contexts()[0]
      page = await context.newPage()
      connectionMode = 'cdp'
    } catch (error) {
      console.warn(`[route] CDP attach failed, falling back to isolated browser: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (!page) {
    browser = await chromium.launch({ headless: true })
    context = await browser.newContext()
    page = await context.newPage()
    connectionMode = 'launch'
  }

  console.log(`[route] opened fresh page for ${targetUrl} via ${connectionMode}`)
  await page.bringToFront()
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })

  if (page.url().includes('/login')) {
    throw new Error(`Redirected to login instead of exam paper page: ${page.url()}`)
  }

  const comboResults = []
  for (const combo of COMBOS) {
    console.log(`[combo] begin ${combo.modeKey}/${combo.layoutKey}`)
    const metrics = await collectComboMetrics(page, combo)
    console.log(`[combo] collected ${combo.modeKey}/${combo.layoutKey} pages=${metrics.pageCount} title=${metrics.title}`)
    const screenshots = await captureAnomalyScreenshots(page, combo, metrics)
    console.log(`[combo] screenshots ${combo.modeKey}/${combo.layoutKey} count=${screenshots.length}`)
    comboResults.push({
      ...metrics,
      screenshots,
    })
  }

  const output = {
    targetUrl,
    pageUrl: page.url(),
    cdpEndpoint,
    connectionMode,
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
