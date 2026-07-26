import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { config } from 'dotenv'
import { chromium } from 'playwright'

const BASE_URL = process.env.STUDIO_BROWSER_BASE_URL || 'http://localhost:4000'
const EVIDENCE_DIR = resolve(
  process.env.STUDIO_FIXTURE_EVIDENCE_DIR || '.omx/evidence/studio-design-system'
)
const FIXTURE_SCRIPT = resolve('scripts/studio-browser-fixture.mjs')
const NEXT_CLI = resolve('node_modules/next/dist/bin/next')
const LEASE_PATH = join(EVIDENCE_DIR, 'fixture.lease.json')
const LEDGER_PATH = join(EVIDENCE_DIR, 'fixture.json')
const HEARTBEAT_INTERVAL_MS = 10_000
const require = createRequire(import.meta.url)
const PLAYWRIGHT_VERSION = require('playwright/package.json').version
const VIEWPORTS = [
  { name: 'mobile-320', width: 320, height: 900 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 1000 },
]
const INTERACTION_VIEWPORTS = new Set(['mobile-320', 'desktop-1440'])
const PREVIEW_ROUTES = [
  '/preview/design-system',
  '/preview/solvook-concept',
  '/preview/solvook-concept/boards/ebs-literature',
  '/preview/solvook-concept/boards/ebs-literature/posts/jingsori-2027',
]
const MARKET_ROUTES = [
  '/english/market/studio-en-fixture',
  '/korean/market/studio-ko-fixture',
  '/english/market/studio-en-fixture/board-preview',
  '/korean/market/studio-ko-fixture/board-preview',
]

function fixtureEnvironment() {
  return {
    ...process.env,
    STUDIO_FIXTURE_EVIDENCE_DIR: EVIDENCE_DIR,
    STUDIO_FIXTURE_OWNER_PID: String(process.pid),
  }
}

function assertLocalBrowserBaseUrl() {
  const parsed = new URL(BASE_URL)
  const hostname = parsed.hostname.toLowerCase()
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error('Browser verification is restricted to localhost or 127.0.0.1')
  }
}

function runFixture(args, { allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [FIXTURE_SCRIPT, ...args], {
    cwd: process.cwd(),
    env: fixtureEnvironment(),
    encoding: 'utf8',
    timeout: 60_000,
  })
  if (!allowFailure && result.status !== 0) {
    throw new Error(
      `Fixture command failed (${args.join(' ')}):\n${result.stdout ?? ''}\n${result.stderr ?? ''}`
    )
  }
  return result
}

async function isDevServerReady() {
  try {
    const response = await fetch(BASE_URL, { redirect: 'manual', signal: AbortSignal.timeout(2_000) })
    return response.status > 0 && response.status < 500
  } catch {
    return false
  }
}

async function ensureDevServerReady(onOwnedChild = () => {}) {
  if (await isDevServerReady()) return null

  const child = spawn(process.execPath, [NEXT_CLI, 'dev', '-p', '4000'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  onOwnedChild(child)
  let startupOutput = ''
  child.stdout.on('data', (chunk) => { startupOutput += chunk.toString() })
  child.stderr.on('data', (chunk) => { startupOutput += chunk.toString() })

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Development server exited before readiness:\n${startupOutput}`)
    }
    if (await isDevServerReady()) return child
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }

  throw new Error(`Development server was not ready within 60 seconds:\n${startupOutput}`)
}

function readCredentials(runId) {
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  if (ledger.runId !== runId || !ledger.credentials?.email || !ledger.credentials?.password) {
    throw new Error('Fixture credentials are missing or belong to another run')
  }
  return ledger.credentials
}

function ledgerBelongsToRun(runId) {
  if (!existsSync(LEDGER_PATH)) return false
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')).runId === runId
  } catch {
    return false
  }
}

function safeRouteName(route) {
  return route.replace(/^\//, '').replaceAll('/', '--') || 'root'
}

function recordAssertion(evidenceRows, route, viewport, assertion, status, detail = '') {
  evidenceRows.push({ route, viewport, assertion, status, detail })
}

function recordLifecycle(evidenceRows, assertion, status, detail = '') {
  recordAssertion(evidenceRows, 'lifecycle', 'n/a', assertion, status, detail)
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function mergeError(primaryError, nextError, message) {
  if (!primaryError) return nextError
  return new AggregateError([primaryError, nextError], message)
}

async function checkAssertion(evidenceRows, route, viewport, assertion, verify) {
  try {
    await verify()
    recordAssertion(evidenceRows, route, viewport, assertion, 'PASS')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    recordAssertion(evidenceRows, route, viewport, assertion, 'FAIL', detail)
    throw error
  }
}

async function assertMinimumTarget(locator, label) {
  const box = await locator.boundingBox()
  if (!box || box.width < 44 || box.height < 44) {
    throw new Error(`${label} must have a 44px minimum bounding box`)
  }
}

async function readStudioVisuals(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element)
    const rootStyle = getComputedStyle(document.documentElement)
    const tokenValues = {
      surface: rootStyle.getPropertyValue('--studio-surface').trim(),
      text: rootStyle.getPropertyValue('--studio-text').trim(),
      border: rootStyle.getPropertyValue('--studio-border').trim(),
      focusRing: rootStyle.getPropertyValue('--studio-focus-ring').trim(),
      primarySoft: rootStyle.getPropertyValue('--studio-primary-soft').trim(),
      primary: rootStyle.getPropertyValue('--studio-primary').trim(),
    }
    const resolveToken = (value) => {
      const probe = document.createElement('span')
      probe.style.color = value
      document.body.appendChild(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return resolved
    }
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      boxShadow: style.boxShadow,
      outlineColor: style.outlineColor,
      expected: {
        surface: resolveToken(tokenValues.surface),
        text: resolveToken(tokenValues.text),
        border: resolveToken(tokenValues.border),
        focusRing: resolveToken(tokenValues.focusRing),
        primarySoft: resolveToken(tokenValues.primarySoft),
        primary: resolveToken(tokenValues.primary),
      },
    }
  })
}

async function assertStudioSurface(locator, label, { accent = false } = {}) {
  const visuals = await readStudioVisuals(locator)
  const { expected } = visuals
  const expectedBackground = accent ? expected.primarySoft : expected.surface
  if (visuals.backgroundColor !== expectedBackground) {
    throw new Error(`${label} background does not resolve to its Studio token`)
  }
  if (!accent && visuals.color !== expected.text) {
    throw new Error(`${label} text does not resolve to --studio-text`)
  }
  if (accent && visuals.color !== expected.primary) {
    throw new Error(`${label} text does not resolve to --studio-primary`)
  }
  if (!accent && visuals.borderColor !== expected.border) {
    throw new Error(`${label} border does not resolve to --studio-border`)
  }
  return visuals
}

async function assertStudioFocus(locator, label) {
  const visuals = await readStudioVisuals(locator)
  const expectedFocus = visuals.expected.focusRing
  if (
    !visuals.boxShadow.includes(expectedFocus)
    && visuals.outlineColor !== expectedFocus
  ) {
    throw new Error(`${label} does not resolve its focus ring to --studio-focus-ring`)
  }
  return visuals
}

async function waitForLocatorCount(locator, expectedCount) {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (await locator.count() === expectedCount) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error(`Expected ${expectedCount} rows but found ${await locator.count()}`)
}

async function assertRoute(page, route, viewport, evidenceRows) {
  await checkAssertion(evidenceRows, route, viewport.name, 'route status and canonical shell', async () => {
    const response = await page.goto(`${BASE_URL}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    })
    if (!response || response.status() >= 400) {
      throw new Error(`${route} returned ${response?.status() ?? 'no response'}`)
    }
    const finalPathname = new URL(page.url()).pathname
    if (finalPathname !== route) {
      throw new Error(`${route} redirected to unexpected pathname ${finalPathname}`)
    }
    await page.locator('body').waitFor({ state: 'visible' })
    await page.locator('.studio-theme').first().waitFor({ state: 'visible' })
  })

  await checkAssertion(evidenceRows, route, viewport.name, 'content and overflow', async () => {
    const layout = await page.evaluate(() => ({
      textLength: document.body.innerText.trim().length,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }))
    if (layout.textLength === 0) throw new Error(`${route} rendered no visible text`)
    if (layout.bodyWidth > layout.viewportWidth + 1) {
      throw new Error(`${route} has horizontal overflow at ${viewport.width}px`)
    }
  })

  const screenshotDir = join(EVIDENCE_DIR, 'final', safeRouteName(route))
  mkdirSync(screenshotDir, { recursive: true })
  const screenshotPath = join(screenshotDir, `${viewport.name}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  recordAssertion(evidenceRows, route, viewport.name, 'screenshot', 'PASS', screenshotPath)
}

async function assertMarketInteractions(
  page,
  subject,
  slug,
  { preview = false, evidenceRows, viewport }
) {
  const route = `/${subject}/market/${slug}${preview ? '/board-preview' : ''}`
  await checkAssertion(evidenceRows, route, viewport, 'market route and filter controls', async () => {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' })
    if (new URL(page.url()).pathname !== route) throw new Error(`${route} redirected unexpectedly`)
    await page.locator('.studio-theme').first().waitFor({ state: 'visible' })
    await assertMinimumTarget(page.locator('#year'), 'market year filter')
    await assertMinimumTarget(page.locator('#month'), 'market month filter')
    await assertMinimumTarget(page.locator('#grade'), 'market grade filter')
    await assertMinimumTarget(page.locator('#title'), 'market title search')
    await assertMinimumTarget(page.getByRole('button', { name: '검색', exact: true }), 'market search')
    await assertMinimumTarget(page.getByRole('link', { name: '초기화' }), 'market reset')
    await page.locator('#title').focus()
    await page.keyboard.press('Tab')
    const searchFocused = await page.getByRole('button', { name: '검색', exact: true }).evaluate(
      (element) => document.activeElement === element
    )
    if (!searchFocused) throw new Error(`${route} keyboard Tab did not focus the search action`)
    await assertStudioFocus(
      page.getByRole('button', { name: '검색', exact: true }),
      'market search keyboard focus-visible'
    )
  })

  await checkAssertion(evidenceRows, route, viewport, 'single shared result actual DOM', async () => {
    const sharedResults = page.locator('[data-slot="studio-board-results"]')
    if (await sharedResults.count() !== 1) {
      throw new Error(`${route} must render one shared responsive result tree`)
    }
    if (await page.locator('[data-slot="studio-board-desktop-results"], [data-slot="studio-board-mobile-results"]').count() !== 0) {
      throw new Error(`${route} unexpectedly duplicates mobile and desktop result DOM`)
    }
    if (await sharedResults.locator('table').count() !== 1) {
      throw new Error(`${route} shared result tree must contain exactly one table`)
    }
    const headers = await sharedResults.locator('thead th').allTextContents()
    if (headers.map((header) => header.trim()).join('|') !== '번호|자료명|샘플|조회|날짜') {
      throw new Error(`${route} shared result information columns are incomplete`)
    }
    const firstRowCellCount = await sharedResults.locator('tbody tr').first().locator('td').count()
    if (firstRowCellCount !== headers.length) {
      throw new Error(`${route} row information is not equivalent to its shared headers`)
    }
  })

  await checkAssertion(evidenceRows, route, viewport, 'search and reset', async () => {
    await page.locator('#title').fill('material 1')
    await page.getByRole('button', { name: '검색', exact: true }).click()
    await page.waitForURL((url) => url.searchParams.get('title') === 'material 1')
    await page.getByRole('link', { name: '초기화' }).click()
    await page.waitForURL((url) => url.pathname === route && !url.searchParams.has('title'))
  })

  if (subject === 'korean') {
    await checkAssertion(evidenceRows, route, viewport, 'long Korean content and empty state', async () => {
      const longKoreanQuery = '존재하지 않는 매우 긴 국어 학습 자료 검색어가 화면 너비를 넘어가도 안전하게 표시되는지 확인합니다'
      await page.locator('#title').fill(longKoreanQuery)
      await page.getByRole('button', { name: '검색', exact: true }).click()
      await page.waitForURL((url) => url.searchParams.get('title') === longKoreanQuery)
      await page.getByText('검색 조건에 맞는 자료가 없습니다.', { exact: true }).waitFor()
      const emptyAction = page.getByRole('link', { name: '검색 조건 초기화', exact: true })
      await assertMinimumTarget(emptyAction, 'market empty-state reset')
      const layout = await page.evaluate(() => ({
        bodyWidth: document.body.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }))
      if (layout.bodyWidth > layout.viewportWidth + 1) {
        throw new Error(`${route} long Korean empty state causes horizontal overflow`)
      }
      if (await page.locator('#title').inputValue() !== longKoreanQuery) {
        throw new Error(`${route} did not preserve the long Korean query in the actual DOM`)
      }
      await emptyAction.click()
      await page.waitForURL((url) => url.pathname === route && !url.searchParams.has('title'))
    })
  }

  await checkAssertion(evidenceRows, route, viewport, 'pagination boundaries row identity and 10 to 20 count', async () => {
    const firstPage = page.getByRole('button', { name: '첫 페이지' })
    const lastPage = page.getByRole('button', { name: '마지막 페이지' })
    const rows = page.locator('[data-slot="studio-board-results"] tbody tr')
    await assertMinimumTarget(firstPage, 'first page control')
    await assertMinimumTarget(lastPage, 'last page control')
    await assertMinimumTarget(page.getByRole('button', { name: '2페이지' }), 'page 2 control')
    if (!await firstPage.isDisabled()) throw new Error(`${route} first-page boundary is not disabled`)
    await waitForLocatorCount(rows, 10)
    const pageOneRowIdentity = (await rows.first().innerText()).trim()
    await page.getByRole('button', { name: '2페이지' }).click()
    await waitForLocatorCount(rows, 1)
    const pageTwoRowIdentity = (await rows.first().innerText()).trim()
    if (pageOneRowIdentity === pageTwoRowIdentity) {
      throw new Error(`${route} pagination did not change row identity`)
    }
    if (!await lastPage.isDisabled()) throw new Error(`${route} last-page boundary is not disabled`)
    await firstPage.click()
    await waitForLocatorCount(rows, 10)
    await assertMinimumTarget(page.locator('#market-rows-per-page'), 'rows-per-page select')
    await page.locator('#market-rows-per-page').selectOption('20')
    await waitForLocatorCount(rows, 11)
    await page.locator('#market-rows-per-page').selectOption('10')
    await waitForLocatorCount(rows, 10)
  })

  await checkAssertion(evidenceRows, route, viewport, 'sample prefetch dialog 44px and sample trigger focus restoration', async () => {
    const sampleResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/api/market/items/') && response.url().includes('/sample-pages')
    )
    const sampleButton = page.getByRole('button', { name: /샘플보기/ }).first()
    await assertMinimumTarget(sampleButton, 'sample preview button')
    await sampleButton.hover()
    const sampleResponse = await sampleResponsePromise
    if (!sampleResponse.ok()) throw new Error(`${route} sample prefetch returned ${sampleResponse.status()}`)
    const samplePayload = await sampleResponse.json()
    if (!samplePayload.success || !Array.isArray(samplePayload.pages) || samplePayload.pages.length === 0) {
      throw new Error(`${route} sample prefetch did not return fixture pages`)
    }
    await sampleButton.focus()
    await sampleButton.click()
    await page.getByRole('heading', { name: '샘플 미리보기' }).waitFor()
    const dialog = page.locator('[data-slot="dialog-content"]')
    const sampleImage = dialog.locator('img').first()
    await sampleImage.waitFor({ state: 'visible' })
    await sampleImage.evaluate((image) => {
      if (image.complete) return
      return new Promise((resolvePromise, rejectPromise) => {
        image.addEventListener('load', resolvePromise, { once: true })
        image.addEventListener('error', () => rejectPromise(new Error('fixture image load failed')), {
          once: true,
        })
      })
    })
    const imageMetrics = await sampleImage.evaluate((image) => ({
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
    }))
    const imageBox = await sampleImage.boundingBox()
    if (
      !imageMetrics.complete
      || imageMetrics.naturalWidth <= 0
      || imageMetrics.naturalHeight <= 0
      || !imageBox
      || imageBox.width <= 0
      || imageBox.height <= 0
    ) {
      throw new Error(`${route} fixture sample page image was not visibly rendered`)
    }
    const dialogClose = page.locator('[data-slot="dialog-close"]')
    await assertMinimumTarget(dialogClose, 'sample dialog close')
    await page.getByRole('button', { name: '닫기', exact: true }).click()
    await page.getByRole('heading', { name: '샘플 미리보기' }).waitFor({ state: 'hidden' })
    const focusRestored = await sampleButton.evaluate(
      (element) => document.activeElement === element
    )
    if (!focusRestored) throw new Error(`${route} failed exact sample trigger focus restoration`)
  })

  await checkAssertion(evidenceRows, route, viewport, 'detail navigation and enabled purchase CTA', async () => {
    const detailLink = page.getByRole('link', { name: /Studio .* material 11/ }).first()
    await detailLink.click()
    await page.waitForLoadState('domcontentloaded')
    if (!new URL(page.url()).pathname.includes('/items/')) throw new Error(`${route} detail navigation failed`)
    const purchaseCta = page.getByRole('button', { name: 'PDF 구매하기', exact: true })
    await purchaseCta.waitFor({ state: 'visible' })
    await assertMinimumTarget(purchaseCta, 'market PDF purchase CTA')
    if (!await purchaseCta.isEnabled()) throw new Error(`${route} detail purchase CTA is disabled`)
  })
}

async function assertSolvookHomeInteractions(page, viewport, evidenceRows) {
  const route = '/preview/solvook-concept'
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook centered responsive shell', async () => {
    const containers = page.locator('div[class*="studio-content-width"]:visible')
    const expectedWidth = Math.min(viewport.width, 1200)
    const expectedLeft = (viewport.width - expectedWidth) / 2
    const expectedPadding = viewport.width < 744 ? 20 : viewport.width < 1200 ? 32 : 0

    if (await containers.count() === 0) {
      throw new Error('Solvook home must render visible StudioContainer shells')
    }

    for (const container of await containers.all()) {
      const layout = await container.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          width: rect.width,
          paddingLeft: Number.parseFloat(getComputedStyle(element).paddingLeft),
          paddingRight: Number.parseFloat(getComputedStyle(element).paddingRight),
          maxWidth: getComputedStyle(element).maxWidth,
        }
      })

      if (
        Math.abs(layout.width - expectedWidth) > 1
        || Math.abs(layout.left - expectedLeft) > 1
        || layout.paddingLeft !== expectedPadding
        || layout.paddingRight !== expectedPadding
        || layout.maxWidth !== '1200px'
      ) {
        throw new Error(
          `Solvook centered shell mismatch at ${viewport.width}px: ${JSON.stringify(layout)}`
        )
      }
    }
  })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook home quick menus and sections', async () => {
    const quickAccess = page.locator('[aria-labelledby="quick-access-title"]')
    const quickLinks = quickAccess.getByRole('link')
    if (await quickLinks.count() !== 8) {
      throw new Error('Solvook home must render eight quick-access links')
    }
    for (const quickLink of await quickLinks.all()) {
      await assertMinimumTarget(quickLink, 'Solvook home quick-access link')
    }
    for (const heading of [
      '선생님들이 먼저 살펴보는 자료',
      '교재와 출처로 골라보기',
      '최근 등록된 수업 자료',
      '필요한 작품부터 찾아 수업 자료를 완성하세요',
    ]) {
      await page.getByRole('heading', { name: heading, exact: true }).waitFor({ state: 'visible' })
    }
  })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook home keyboard search navigation', async () => {
    const search = page.locator('#preview-home-search')
    const submit = page.getByRole('button', { name: '검색', exact: true })
    await assertMinimumTarget(search, 'Solvook home search input')
    await assertMinimumTarget(submit, 'Solvook home search submit')
    await search.fill('징소리')
    await search.focus()
    await page.keyboard.press('Tab')
    if (!await submit.evaluate((element) => document.activeElement === element)) {
      throw new Error('Solvook home search submit did not receive keyboard focus')
    }
    await assertStudioFocus(submit, 'Solvook home search submit')
    await page.keyboard.press('Enter')
    await page.waitForURL((url) =>
      url.pathname === '/preview/solvook-concept/boards/ebs-literature'
      && url.searchParams.get('q') === '징소리'
    )
  })
}

async function assertSolvookBoardInteractions(page, viewport, evidenceRows) {
  const route = '/preview/solvook-concept/boards/ebs-literature'
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' })
  const desktopResults = page.locator('[data-slot="studio-board-desktop-results"]')
  const mobileResults = page.locator('[data-slot="studio-board-mobile-results"]')
  const desktopLayout = viewport.width >= 768

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook board filters and 44px controls', async () => {
    await assertMinimumTarget(page.locator('#board-title-search'), 'Solvook board title search')
    await assertMinimumTarget(
      page.getByRole('button', { name: '제목 검색 적용', exact: true }),
      'Solvook board search submit'
    )
    for (const label of [
      '연도 필터',
      '교재 필터',
      '작품 유형 필터',
      '학년 필터',
      '자료 정렬',
      '페이지당 자료 수',
    ]) {
      await assertMinimumTarget(
        page.getByRole('combobox', { name: label, exact: true }),
        `Solvook ${label}`
      )
    }
  })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook board responsive information parity', async () => {
    const desktopVisible = await desktopResults.isVisible()
    const mobileVisible = await mobileResults.isVisible()
    if (desktopVisible !== desktopLayout || mobileVisible === desktopLayout) {
      throw new Error(`${route} responsive table/card visibility is incorrect at ${viewport.width}px`)
    }

    const desktopEntries = await desktopResults.locator('table tbody tr').evaluateAll((rows) =>
      rows.map((row) => {
        const cells = [...row.querySelectorAll('td')]
        const link = cells[1]?.querySelector('a')
        const titleParts = [...(link?.querySelectorAll('span') ?? [])]
        const sourceParts = [...(cells[2]?.querySelectorAll('span') ?? [])]
        const composition = cells[4]?.textContent ?? ''
        return {
          href: link?.getAttribute('href') ?? '',
          title: titleParts[0]?.textContent?.trim() ?? '',
          authorLabel: titleParts[1]?.textContent?.trim() ?? '',
          workType: cells[0]?.textContent?.trim() ?? '',
          textbook: sourceParts[0]?.textContent?.trim() ?? '',
          year: sourceParts[1]?.textContent?.trim() ?? '',
          grade: cells[3]?.textContent?.trim() ?? '',
          passageCount: composition.match(/지문\s*(\d+)/)?.[1] ?? '',
          questionCount: composition.match(/문항\s*(\d+)/)?.[1] ?? '',
          viewCount: (cells[6]?.textContent ?? '').replace(/\D/g, ''),
          publishedAt: (cells[7]?.textContent ?? '').replace(/\s/g, ''),
        }
      })
    )
    const mobileEntries = await mobileResults.locator('article').evaluateAll((articles) =>
      articles.map((article) => {
        const link = article.querySelector('a[href*="/posts/"]')
        const badges = [...article.querySelectorAll('[data-slot="badge"]')]
        const paragraphs = [...(link?.querySelectorAll('p') ?? [])]
        const source = paragraphs[1]?.textContent ?? ''
        const [textbook = '', year = ''] = source.split('·').map((value) => value.trim())
        const metrics = [...article.querySelectorAll(':scope > div:last-child span.inline-flex')]
        const composition = metrics[0]?.textContent ?? ''
        const views = metrics[1]?.textContent ?? ''
        const date = article.querySelector(':scope > div:first-child > span')?.textContent ?? ''
        return {
          href: link?.getAttribute('href') ?? '',
          title: link?.querySelector('h2')?.textContent?.trim() ?? '',
          authorLabel: paragraphs[0]?.textContent?.trim() ?? '',
          workType: badges[0]?.textContent?.trim() ?? '',
          textbook,
          year,
          grade: badges[1]?.textContent?.trim() ?? '',
          passageCount: composition.match(/지문\s*(\d+)/)?.[1] ?? '',
          questionCount: composition.match(/문항\s*(\d+)/)?.[1] ?? '',
          viewCount: views.replace(/\D/g, ''),
          publishedAt: date.replace(/\s/g, ''),
        }
      })
    )
    if (desktopEntries.length !== 5 || mobileEntries.length !== 5) {
      throw new Error(`${route} must render five matching entries on the first page`)
    }
    if (JSON.stringify(desktopEntries) !== JSON.stringify(mobileEntries)) {
      throw new Error(`${route} desktop table and mobile card information parity failed`)
    }
  })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook board pagination identity and boundaries', async () => {
    const activeResults = desktopLayout ? desktopResults : mobileResults
    const resultLinks = activeResults.locator('a[href*="/posts/"]')
    const firstPage = page.getByRole('button', { name: '첫 페이지' })
    const lastPage = page.getByRole('button', { name: '마지막 페이지' })
    const secondPage = page.getByRole('button', { name: '2페이지' })
    await assertMinimumTarget(firstPage, 'Solvook first page control')
    await assertMinimumTarget(lastPage, 'Solvook last page control')
    await assertMinimumTarget(secondPage, 'Solvook second page control')
    if (!await firstPage.isDisabled()) throw new Error('Solvook first page boundary must be disabled')
    const pageOneIdentity = await resultLinks.first().getAttribute('href')
    if (!pageOneIdentity?.endsWith('/jingsori-2027')) {
      throw new Error('Solvook page one must start with 징소리')
    }
    await secondPage.click()
    await page.waitForURL((url) => url.searchParams.get('page') === '2')
    await activeResults.locator('a[href$="/teacher-desk-essay"]').waitFor({ state: 'visible' })
    const pageTwoIdentity = await resultLinks.first().getAttribute('href')
    if (!pageTwoIdentity || pageOneIdentity === pageTwoIdentity) {
      throw new Error('Solvook page one and page two row identity did not change')
    }
    if (!pageTwoIdentity.endsWith('/teacher-desk-essay')) {
      throw new Error('Solvook page two must start with 오래된 책상')
    }
    await lastPage.click()
    await page.waitForURL((url) => url.searchParams.get('page') === '3')
    await activeResults.locator('a[href$="/wooden-bird-tale"]').waitFor({ state: 'visible' })
    const pageThreeIdentity = await resultLinks.first().getAttribute('href')
    if (!pageThreeIdentity?.endsWith('/wooden-bird-tale')) {
      throw new Error('Solvook page three must start with 나무 새의 약속')
    }
    if (!await lastPage.isDisabled()) throw new Error('Solvook last page boundary must be disabled')
    await firstPage.click()
    await page.waitForURL((url) => !url.searchParams.has('page'))
  })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook board filter result change and empty state', async () => {
    const activeResults = desktopLayout ? desktopResults : mobileResults
    const search = page.locator('#board-title-search')
    const submit = page.getByRole('button', { name: '제목 검색 적용', exact: true })
    await search.fill('징소리')
    await submit.click()
    await page.waitForURL((url) => url.searchParams.get('q') === '징소리')
    await activeResults.getByRole('link', { name: /징소리/ }).waitFor({ state: 'visible' })

    const emptyQuery = '존재하지 않는 매우 긴 국어 자료 검색 결과 확인'
    await search.fill(emptyQuery)
    await submit.click()
    await page.waitForURL((url) => url.searchParams.get('q') === emptyQuery)
    await activeResults.getByText('조건에 맞는 자료가 없습니다', { exact: true }).waitFor({
      state: 'visible',
    })
    const reset = activeResults.getByRole('button', { name: '전체 조건 초기화', exact: true })
    await assertMinimumTarget(reset, 'Solvook empty-state reset')
    await reset.click()
    await page.waitForURL((url) => !url.searchParams.has('q'))

    const selectFilter = async (label, option, parameter) => {
      await page.getByRole('combobox', { name: label, exact: true }).click()
      await page.getByRole('option', { name: option, exact: true }).click()
      await page.waitForURL((url) => url.searchParams.get(parameter) === option)
    }
    await selectFilter('연도 필터', '2027', 'year')
    await selectFilter('교재 필터', 'EBS 수능특강', 'textbook')
    await selectFilter('작품 유형 필터', '현대 소설', 'workType')
    await selectFilter('학년 필터', '고3', 'grade')
    await activeResults.getByRole('link', { name: /징소리/ }).waitFor({ state: 'visible' })
    const positiveLinks = await activeResults.locator('a[href*="/posts/"]').count()
    if (positiveLinks !== 1) throw new Error('Solvook positive multi-filter must return 징소리 only')

    const clearPositive = page.getByRole('button', { name: '전체 초기화', exact: true })
    await assertMinimumTarget(clearPositive, 'Solvook active filter reset')
    await clearPositive.click()
    await page.waitForURL((url) =>
      !['year', 'textbook', 'workType', 'grade'].some((key) => url.searchParams.has(key))
    )

    await selectFilter('연도 필터', '2026', 'year')
    await selectFilter('교재 필터', 'EBS 수능특강', 'textbook')
    await selectFilter('작품 유형 필터', '고전 시가', 'workType')
    await selectFilter('학년 필터', '고1', 'grade')
    await activeResults.getByText('조건에 맞는 자료가 없습니다', { exact: true }).waitFor({
      state: 'visible',
    })
    const clearZero = activeResults.getByRole('button', {
      name: '전체 조건 초기화',
      exact: true,
    })
    await clearZero.click()
    await page.waitForURL((url) =>
      !['year', 'textbook', 'workType', 'grade'].some((key) => url.searchParams.has(key))
    )
  })
}

async function assertSolvookDetailInteractions(page, viewport, evidenceRows) {
  const route = '/preview/solvook-concept/boards/ebs-literature/posts/jingsori-2027'
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook detail tabs keyboard and content', async () => {
    const tabs = [
      page.getByRole('tab', { name: '자료 정보', exact: true }),
      page.getByRole('tab', { name: '지문 구조', exact: true }),
      page.getByRole('tab', { name: /포함 문항/ }),
      page.getByRole('tab', { name: '샘플 보기', exact: true }),
      page.getByRole('tab', { name: '이용 안내', exact: true }),
    ]
    for (const tab of tabs) await assertMinimumTarget(tab, 'Solvook detail tab')
    let activeContent = page.locator('[data-slot="tabs-content"][data-state="active"]')
    await activeContent.getByRole('heading', { name: '수업 흐름이 보이는 자료' }).waitFor({
      state: 'visible',
    })
    await tabs[0].focus()
    await page.keyboard.press('ArrowRight')
    if (!await tabs[1].evaluate((element) => document.activeElement === element)) {
      throw new Error('Solvook detail tabs did not move keyboard focus')
    }
    if (await tabs[1].getAttribute('aria-selected') !== 'true') {
      throw new Error('Solvook passage tab was not selected by keyboard')
    }
    activeContent = page.locator('[data-slot="tabs-content"][data-state="active"]')
    await activeContent.getByRole('heading', { name: '밤길에서 되살아나는 기억' }).waitFor({
      state: 'visible',
    })
    await tabs[2].click()
    activeContent = page.locator('[data-slot="tabs-content"][data-state="active"]')
    await activeContent.getByRole('heading', { name: '포함 문항 7개' }).waitFor({ state: 'visible' })
    await tabs[3].click()
    activeContent = page.locator('[data-slot="tabs-content"][data-state="active"]')
    await activeContent.getByRole('heading', { name: '문서 구성 미리보기' }).waitFor({
      state: 'visible',
    })
    await tabs[4].click()
    activeContent = page.locator('[data-slot="tabs-content"][data-state="active"]')
    await activeContent.getByRole('heading', { name: '시안 이용 안내' }).waitFor({
      state: 'visible',
    })
  })

  await checkAssertion(evidenceRows, route, viewport.name, 'Solvook detail responsive action behavior 44px and focus', async () => {
    const desktopAction = page.locator('aside').filter({ hasText: 'TEACHER ACTION' }).first()
    const mobileAction = page.locator('[data-slot="studio-detail-mobile-actions"]')
    const desktopLayout = viewport.width >= 1024
    if (await desktopAction.isVisible() !== desktopLayout || await mobileAction.isVisible() === desktopLayout) {
      throw new Error(`${route} responsive action visibility is incorrect at ${viewport.width}px`)
    }
    const action = desktopLayout ? desktopAction : mobileAction
    const library = action.getByRole('button', { name: '라이브러리에 담기', exact: true })
    const sample = action.getByRole('button', { name: '샘플 보기', exact: true })
    const generate = action.getByRole('button', { name: '이 자료로 문제 생성', exact: true })
    for (const control of [library, sample, generate]) {
      await assertMinimumTarget(control, 'Solvook detail action')
    }
    const position = await (desktopLayout ? action.locator('.sticky') : action).evaluate(
      (element) => getComputedStyle(element).position
    )
    if (position !== (desktopLayout ? 'sticky' : 'fixed')) {
      throw new Error(`Solvook action surface expected ${desktopLayout ? 'sticky' : 'fixed'} positioning`)
    }

    await library.click()
    await action.locator('p:not(.sr-only)').filter({
      hasText: '라이브러리에 담는 흐름을 확인했습니다',
    }).last().waitFor({ state: 'visible' })
    await page.keyboard.press('Tab')
    if (!await sample.evaluate((element) => document.activeElement === element)) {
      throw new Error('Solvook detail sample action did not receive keyboard focus')
    }
    await sample.click()
    const dialog = page.locator('[data-slot="dialog-content"]')
    await dialog.waitFor({ state: 'visible' })
    const dialogClose = dialog.getByRole('button', { name: 'Close', exact: true })
    await assertMinimumTarget(dialogClose, 'Solvook detail dialog close')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    if (!await sample.evaluate((element) => document.activeElement === element)) {
      throw new Error('Solvook detail dialog did not restore exact action focus')
    }
    await generate.click()
    await action.locator('p:not(.sr-only)').filter({
      hasText: '7문항 구성을 확인했습니다',
    }).last().waitFor({ state: 'visible' })
  })
}

async function assertShowcaseInteractions(page, viewport, evidenceRows) {
  const route = '/preview/design-system'
  await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' })

  await checkAssertion(evidenceRows, route, viewport, 'Dialog keyboard focus and portal styles', async () => {
    const trigger = page.getByRole('button', { name: 'Dialog 열기' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.locator('[data-slot="dialog-content"]')
    await dialog.waitFor({ state: 'visible' })
    await assertStudioSurface(dialog, 'showcase Dialog')
    const close = page.locator('[data-slot="dialog-close"]')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (await close.evaluate((element) => document.activeElement === element)) break
      await page.keyboard.press('Tab')
    }
    if (!await close.evaluate((element) => document.activeElement === element)) {
      throw new Error('showcase Dialog close was not reachable by keyboard Tab')
    }
    await assertMinimumTarget(close, 'showcase Dialog close')
    await assertStudioFocus(close, 'showcase Dialog focused close')
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'hidden' })
    if (!await trigger.evaluate((element) => document.activeElement === element)) {
      throw new Error('showcase Dialog did not restore exact trigger focus')
    }
  })

  await checkAssertion(evidenceRows, route, viewport, 'Select keyboard focus and portal styles', async () => {
    const trigger = page.locator('#showcase-level')
    await trigger.focus()
    await page.keyboard.press('Enter')
    const content = page.locator('[data-slot="select-content"]')
    await content.waitFor({ state: 'visible' })
    await assertStudioSurface(content, 'showcase Select')
    const firstItem = page.locator('[data-slot="select-item"]').first()
    await assertMinimumTarget(firstItem, 'showcase Select item')
    await page.keyboard.press('ArrowDown')
    const focusedInPortal = await page.evaluate(() =>
      Boolean(document.activeElement?.closest('[data-slot="select-content"]'))
    )
    if (!focusedInPortal) throw new Error('showcase Select did not retain keyboard focus in its portal')
    const highlightedItem = page.locator('[data-slot="select-item"][data-highlighted]').first()
    await highlightedItem.waitFor({ state: 'visible' })
    await assertStudioSurface(highlightedItem, 'showcase Select highlighted item', { accent: true })
    await page.keyboard.press('Escape')
    if (!await trigger.evaluate((element) => document.activeElement === element)) {
      throw new Error('showcase Select did not restore exact trigger focus')
    }
  })
}

function currentCommitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  return result.status === 0 ? result.stdout.trim() : 'unavailable'
}

function fixtureManifestMetadata(runId) {
  if (!ledgerBelongsToRun(runId)) return { fixtureIds: [], storagePaths: [] }
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  return {
    fixtureIds: [...new Set(ledger.resources.flatMap((resource) =>
      resource.id ? [resource.id] : []
    ))],
    storagePaths: [...new Set(ledger.resources.flatMap((resource) =>
      resource.path ? [resource.path] : []
    ))],
  }
}

function supabaseHostnameForManifest() {
  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!configuredUrl) return 'unavailable'
  try {
    const hostname = new URL(configuredUrl).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1'
      ? hostname
      : 'non-local-refused'
  } catch {
    return 'invalid-refused'
  }
}

function markdownCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

function writeBrowserManifest(runId, evidenceRows, runtimeMetadata, overallStatus) {
  const manifestPath = join(EVIDENCE_DIR, 'final', 'manifest.md')
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`
  const commitSha = currentCommitSha()
  const { fixtureIds, storagePaths } = fixtureManifestMetadata(runId)
  mkdirSync(join(EVIDENCE_DIR, 'final'), { recursive: true })
  const lines = [
    '# Studio browser verification manifest',
    '',
    `- Overall status: ${overallStatus}`,
    `- Commit SHA: ${commitSha}`,
    `- Fixture run ID: ${runId}`,
    '- Auth mode: ephemeral local email fixture',
    `- Base URL: ${BASE_URL}`,
    `- Supabase hostname: ${supabaseHostnameForManifest()}`,
    `- Playwright version: ${PLAYWRIGHT_VERSION}`,
    `- Browser version: ${runtimeMetadata.browserVersion}`,
    `- Fixture IDs: ${fixtureIds.length > 0 ? fixtureIds.join(', ') : 'unavailable'}`,
    `- Storage paths: ${storagePaths.length > 0 ? storagePaths.join(', ') : 'unavailable'}`,
    `- Completed: ${new Date().toISOString()}`,
    '',
    '| Route | Viewport | Assertion | Status | Detail / Screenshot |',
    '| --- | --- | --- | --- | --- |',
    ...evidenceRows.map((row) =>
      `| ${markdownCell(row.route)} | ${markdownCell(row.viewport)} | ${markdownCell(row.assertion)} | ${row.status} | ${markdownCell(row.detail)} |`
    ),
    '',
  ]
  writeFileSync(temporaryPath, lines.join('\n'), { mode: 0o600 })
  renameSync(temporaryPath, manifestPath)
}

async function runBrowserMatrix(runId, evidenceRows, runtimeMetadata) {
  const credentials = readCredentials(runId)
  let browser = null

  try {
    browser = await chromium.launch({ headless: true })
    runtimeMetadata.browserVersion = browser.version()
    for (const viewport of VIEWPORTS) {
      const anonymousContext = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      })
      const anonymousPage = await anonymousContext.newPage()
      try {
        for (const route of PREVIEW_ROUTES) {
          await assertRoute(anonymousPage, route, viewport, evidenceRows)
        }
        await assertShowcaseInteractions(anonymousPage, viewport.name, evidenceRows)
        await assertSolvookHomeInteractions(anonymousPage, viewport, evidenceRows)
        await assertSolvookBoardInteractions(anonymousPage, viewport, evidenceRows)
        await assertSolvookDetailInteractions(anonymousPage, viewport, evidenceRows)
      } finally {
        await anonymousContext.close()
      }

      const marketContext = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
      })
      const marketPage = await marketContext.newPage()
      try {
        await checkAssertion(evidenceRows, '/login', viewport.name, 'ephemeral fixture authentication', async () => {
          await marketPage.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })
          await marketPage.locator('#email').fill(credentials.email)
          await marketPage.locator('#password').fill(credentials.password)
          await marketPage.getByRole('button', { name: '로그인', exact: true }).click()
          await marketPage.waitForURL((url) => url.pathname !== '/login', { timeout: 20_000 })
        })

        for (const route of MARKET_ROUTES) {
          await assertRoute(marketPage, route, viewport, evidenceRows)
        }
        if (INTERACTION_VIEWPORTS.has(viewport.name)) {
          for (const [subject, slug] of [
            ['english', 'studio-en-fixture'],
            ['korean', 'studio-ko-fixture'],
          ]) {
            await assertMarketInteractions(marketPage, subject, slug, {
              evidenceRows,
              viewport: viewport.name,
            })
            await assertMarketInteractions(marketPage, subject, slug, {
              preview: true,
              evidenceRows,
              viewport: viewport.name,
            })
          }
        }
      } finally {
        await marketContext.close()
      }
    }
  } catch (error) {
    if (!evidenceRows.some((row) => row.status === 'FAIL')) {
      recordAssertion(
        evidenceRows,
        'browser-lifecycle',
        'n/a',
        'browser launch or lifecycle',
        'FAIL',
        errorMessage(error)
      )
    }
    throw error
  } finally {
    if (browser) {
      try {
        await browser.close()
        recordLifecycle(evidenceRows, 'browser close', 'PASS', runtimeMetadata.browserVersion)
      } catch (error) {
        recordLifecycle(evidenceRows, 'browser close', 'FAIL', errorMessage(error))
        throw error
      }
    }
  }
}

function releaseOwnedLease(runId) {
  if (!existsSync(LEASE_PATH)) return
  const lease = JSON.parse(readFileSync(LEASE_PATH, 'utf8'))
  if (lease.runId !== runId || lease.pid !== process.pid) {
    throw new Error('Refusing to release a fixture.lease.json owned by another run or PID')
  }
  unlinkSync(LEASE_PATH)
}

function leaseBelongsToRun(runId) {
  if (!existsSync(LEASE_PATH)) return false
  try {
    const lease = JSON.parse(readFileSync(LEASE_PATH, 'utf8'))
    return lease.runId === runId && lease.pid === process.pid
  } catch {
    return false
  }
}

function recoverPreviousStaleFixture() {
  if (!existsSync(LEASE_PATH)) {
    if (existsSync(LEDGER_PATH)) {
      const previousLedger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
      const hasRemainingResources = previousLedger.resources?.some(
        (resource) => resource.state !== 'removed'
      )
      if (hasRemainingResources) {
        throw new Error('Fixture ledger has resources but no lease; refusing to overwrite recovery evidence')
      }
    }
    return
  }

  const previousLease = JSON.parse(readFileSync(LEASE_PATH, 'utf8'))
  runFixture(['recover', '--run-id', previousLease.runId])
}

function cleanupOwnedFixture(runId, evidenceRows) {
  const failures = []
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const cleanup = runFixture(['cleanup', '--run-id', runId], { allowFailure: true })
    if (cleanup.status !== 0) {
      const detail = `cleanup attempt ${attempt}: ${cleanup.stderr || cleanup.stdout}`
      failures.push(detail)
      recordLifecycle(evidenceRows, `fixture cleanup attempt ${attempt}`, 'FAIL', detail)
      continue
    }
    recordLifecycle(evidenceRows, `fixture cleanup attempt ${attempt}`, 'PASS')

    const absent = runFixture(['verify', '--run-id', runId, '--absent'], { allowFailure: true })
    if (absent.status === 0) {
      recordLifecycle(evidenceRows, 'fixture verify absent', 'PASS')
      recordLifecycle(evidenceRows, 'fixture cleanup', 'PASS')
      return null
    }
    const detail = `verify absent attempt ${attempt}: ${absent.stderr || absent.stdout}`
    failures.push(detail)
    recordLifecycle(evidenceRows, `fixture verify absent attempt ${attempt}`, 'FAIL', detail)
  }
  const error = new Error(
    `Owned fixture cleanup did not converge for runId ${runId}: ${failures.join('\n')}`
  )
  recordLifecycle(evidenceRows, 'fixture cleanup', 'FAIL', error.message)
  return error
}

function ownedProcessGroupPresent(child) {
  if (!child?.pid || process.platform === 'win32') {
    return Boolean(child && child.exitCode === null && child.signalCode === null)
  }
  try {
    process.kill(-child.pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

async function waitForOwnedProcessGroupExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!ownedProcessGroupPresent(child)) return true
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  return !ownedProcessGroupPresent(child)
}

async function waitForDevLockRelease() {
  const lockPath = resolve('.next/dev/lock')
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (!existsSync(lockPath)) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
  }
  throw new Error(`Owned Next process group exited but ${lockPath} still exists`)
}

async function stopDevServer(child) {
  if (!child) return { mode: 'external', detail: 'No owned dev server process group' }
  if (!child.pid) throw new Error('Owned Next child has no PID')

  let forced = false
  try {
    if (process.platform === 'win32') child.kill('SIGTERM')
    else process.kill(-child.pid, 'SIGTERM')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }

  if (!await waitForOwnedProcessGroupExit(child, 5_000)) {
    forced = true
    try {
      if (process.platform === 'win32') child.kill('SIGKILL')
      else process.kill(-child.pid, 'SIGKILL')
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    if (!await waitForOwnedProcessGroupExit(child, 5_000)) {
      throw new Error(`Owned Next process group ${child.pid} did not exit after SIGKILL`)
    }
  }

  await waitForDevLockRelease()
  return {
    mode: 'owned',
    detail: `Owned Next child process exit confirmed for group ${child.pid}; forced=${forced}`,
  }
}

async function main() {
  config({ path: resolve('.env.local'), quiet: true })
  assertLocalBrowserBaseUrl()
  mkdirSync(EVIDENCE_DIR, { recursive: true })
  const runId = `studio-${Date.now()}-${randomUUID()}`
  const evidenceRows = []
  const runtimeMetadata = { browserVersion: 'unavailable' }
  let heartbeatTimer = null
  let heartbeatFailure = null
  let devServer = null
  let seeded = false
  let cleanupPassed = false
  let primaryError = null

  try {
    try {
      recoverPreviousStaleFixture()
      recordLifecycle(evidenceRows, 'stale fixture recovery check', 'PASS')
    } catch (error) {
      recordLifecycle(evidenceRows, 'stale fixture recovery check', 'FAIL', errorMessage(error))
      throw error
    }

    try {
      runFixture(['seed', '--run-id', runId])
      recordLifecycle(evidenceRows, 'fixture seed', 'PASS')
    } catch (error) {
      recordLifecycle(evidenceRows, 'fixture seed', 'FAIL', errorMessage(error))
      throw error
    }
    seeded = true
    try {
      runFixture(['verify', '--run-id', runId])
      recordLifecycle(evidenceRows, 'fixture verify present', 'PASS')
    } catch (error) {
      recordLifecycle(evidenceRows, 'fixture verify present', 'FAIL', errorMessage(error))
      throw error
    }
    heartbeatTimer = setInterval(() => {
      const result = runFixture(['heartbeat', '--run-id', runId], { allowFailure: true })
      if (result.status !== 0 && !heartbeatFailure) {
        heartbeatFailure = new Error(`Fixture heartbeat failed: ${result.stderr || result.stdout}`)
      }
    }, HEARTBEAT_INTERVAL_MS)
    recordLifecycle(evidenceRows, 'fixture heartbeat start', 'PASS')

    try {
      devServer = await ensureDevServerReady((ownedChild) => {
        devServer = ownedChild
      })
      recordLifecycle(
        evidenceRows,
        'dev server ready',
        'PASS',
        devServer ? `Owned Next process group ${devServer.pid}` : 'Existing localhost server'
      )
    } catch (error) {
      recordLifecycle(evidenceRows, 'dev server ready', 'FAIL', errorMessage(error))
      throw error
    }
    await runBrowserMatrix(runId, evidenceRows, runtimeMetadata)
    if (heartbeatFailure) throw heartbeatFailure
  } catch (error) {
    primaryError = error
    seeded = seeded || ledgerBelongsToRun(runId)
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      recordLifecycle(evidenceRows, 'fixture heartbeat stop', 'PASS')
    } else {
      recordLifecycle(evidenceRows, 'fixture heartbeat stop', 'PASS', 'Heartbeat was not started')
    }

    if (seeded && existsSync(LEDGER_PATH)) {
      const cleanupError = cleanupOwnedFixture(runId, evidenceRows)
      cleanupPassed = cleanupError === null
      if (cleanupError) {
        primaryError = mergeError(
          primaryError,
          cleanupError,
          `Studio browser lifecycle failed for runId ${runId}; lease retained for stale recovery`
        )
      }
    } else {
      cleanupPassed = true
      recordLifecycle(evidenceRows, 'fixture cleanup', 'PASS', 'No fixture resources were recorded')
      recordLifecycle(evidenceRows, 'fixture verify absent', 'PASS', 'No fixture resources were recorded')
    }

    if (cleanupPassed) {
      try {
        if (leaseBelongsToRun(runId)) releaseOwnedLease(runId)
        recordLifecycle(evidenceRows, 'lease release', 'PASS')
      } catch (error) {
        recordLifecycle(evidenceRows, 'lease release', 'FAIL', errorMessage(error))
        primaryError = mergeError(
          primaryError,
          error,
          `Studio browser lease release failed for runId ${runId}`
        )
      }
    } else {
      recordLifecycle(
        evidenceRows,
        'lease release',
        'FAIL',
        'Lease retained because fixture cleanup did not converge'
      )
    }

    try {
      const stopResult = await stopDevServer(devServer)
      recordLifecycle(evidenceRows, 'dev server stop', 'PASS', stopResult.detail)
    } catch (error) {
      recordLifecycle(evidenceRows, 'dev server stop', 'FAIL', errorMessage(error))
      primaryError = mergeError(
        primaryError,
        error,
        `Studio browser dev server stop failed for runId ${runId}`
      )
    }

    writeBrowserManifest(
      runId,
      evidenceRows,
      runtimeMetadata,
      primaryError ? 'FAIL' : 'PASS'
    )
  }

  if (primaryError) throw primaryError
  console.log(JSON.stringify({ ok: true, runId, evidenceDir: EVIDENCE_DIR }))
}

main().catch((error) => {
  console.error(errorMessage(error))
  process.exitCode = 1
})
