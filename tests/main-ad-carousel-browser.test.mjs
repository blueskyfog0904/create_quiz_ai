import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

const fixtureMode = process.env.MAIN_AD_BROWSER_FIXTURE_MODE
const viewports = [320, 390, 640, 768, 1079, 1200, 1280]
const subjects = ['english', 'korean']
const settingKey = 'main_ad_carousel'
const bucket = 'main-ad-images'
const fixtureItems = [
  {
    id: '1045d1cc-e063-49d1-a917-38f23ba2dc42',
    assetId: '8b08a149-1a32-4b6c-9b06-d84088738a22',
  },
  {
    id: '44c5235c-8ace-46c2-9364-363d3b09ad09',
    assetId: 'f0d92096-b2db-4979-984a-d772c66134f9',
  },
  {
    id: '64dfa82f-d6e3-44b6-9dd0-5a00db1da705',
    assetId: '2bcab39d-415b-4477-a39f-3a4f1b22c013',
  },
  {
    id: '20a813cc-0f20-421d-b73a-74bb4bf79050',
    assetId: 'f507034f-c7f4-4a12-9f5f-a1ee8dac817d',
  },
]

function assertLocalSupabaseUrl(value) {
  assert.ok(value, 'NEXT_PUBLIC_SUPABASE_URL is required in local fixture mode')
  const hostname = new URL(value).hostname
  assert.ok(
    hostname === '127.0.0.1' || hostname === 'localhost',
    `refusing to write carousel fixtures to non-local Supabase hostname: ${hostname}`
  )
}

function assertLocalAppUrl(value) {
  assert.ok(value, 'MARKET_HOME_BASE_URL is required in local fixture mode')
  const hostname = new URL(value).hostname
  assert.ok(
    hostname === '127.0.0.1' || hostname === 'localhost',
    `refusing to run local carousel fixtures against non-local app hostname: ${hostname}`
  )
}

function createFixtureItem(subject, index) {
  const fixture = fixtureItems[index + (subject === 'korean' ? 2 : 0)]
  return {
    id: fixture.id,
    title: `${subject} fixture ad ${index + 1}`,
    pcImagePath: `carousel/${fixture.id}/pc/${fixture.assetId}.png`,
    mobileImagePath: null,
    alt: `${subject} fixture ad ${index + 1}`,
    href: `/${subject}/market/entexam`,
    durationSeconds: 1,
    isActive: true,
  }
}

function fixtureConfig(englishCount, koreanCount) {
  return {
    version: 2,
    items: {
      english: fixtureItems.slice(0, englishCount).map((_, index) => createFixtureItem('english', index)),
      korean: fixtureItems.slice(2, 2 + koreanCount).map((_, index) => createFixtureItem('korean', index)),
    },
  }
}

function rectFields(rect) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    bottom: rect.bottom,
  }
}

function assertRectNear(actual, expected, message, fields = Object.keys(expected)) {
  for (const field of fields) {
    assert.ok(
      Math.abs(actual[field] - expected[field]) <= 1,
      `${message}: ${field} differs (${actual[field]} vs ${expected[field]})`
    )
  }
}

async function inspectCarousel(browser, baseUrl, subject, width, javaScriptEnabled, expectedState) {
  const hydrationErrors = []
  const context = await browser.newContext({
    javaScriptEnabled,
    viewport: { width, height: 1000 },
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydration|did not match|server rendered html/i.test(message.text())) {
      hydrationErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    if (/hydration|did not match|server rendered html/i.test(error.message)) {
      hydrationErrors.push(error.message)
    }
  })

  try {
    await page.goto(
      `${baseUrl}/preview/solvook-concept?subject=${subject}`,
      { waitUntil: javaScriptEnabled ? 'networkidle' : 'domcontentloaded' }
    )
    const slot = page.locator('[data-slot="main-ad-carousel"]')
    await slot.waitFor({ state: 'visible' })
    assert.equal(await slot.getAttribute('data-state'), expectedState)
    assert.equal(await slot.count(), 1)

    const rect = await slot.boundingBox()
    assert.ok(rect, `${subject} ${expectedState} carousel rect should exist at ${width}px`)
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    assert.ok(
      overflow.scrollWidth <= overflow.clientWidth,
      `${subject} ${expectedState} overflows horizontally at ${width}px`
    )

    if (expectedState === 'empty') {
      assert.equal(await slot.locator('[aria-label="이전 광고"], [aria-label="다음 광고"]').count(), 0)
      assert.equal(await slot.locator('[aria-current="true"]').count(), 0)
      assert.equal(await slot.locator('[data-slot="main-ad-progress"]').count(), 0)
      assert.equal(await slot.locator('a[aria-label$="바로가기"]').count(), 0)
    } else if (expectedState === 'single') {
      assert.equal(await slot.locator('[aria-label="이전 광고"], [aria-label="다음 광고"]').count(), 0)
      assert.equal(await slot.locator('[data-slot="main-ad-progress"]').count(), 0)
      assert.equal(await slot.locator('a[aria-label$="바로가기"]').count(), 1)
    } else {
      assert.equal(await slot.locator('[aria-label="이전 광고"]').count(), 1)
      assert.equal(await slot.locator('[aria-label="다음 광고"]').count(), 1)
      assert.ok(await slot.locator('[data-slot="main-ad-progress"]').count() >= 1)
      if (javaScriptEnabled) {
        const previous = slot.locator('[aria-label="이전 광고"]')
        const next = slot.locator('[aria-label="다음 광고"]')
        for (const control of [previous, next]) {
          const controlRect = await control.boundingBox()
          assert.ok(controlRect && controlRect.width >= 44 && controlRect.height >= 44)
        }
      }
    }

    assert.deepEqual(hydrationErrors, [])
    return rectFields(rect)
  } finally {
    await context.close()
  }
}

test('local fixtures keep empty, single and multiple subject ad shells structurally equal', {
  skip: fixtureMode !== 'local',
}, async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const baseUrl = process.env.MARKET_HOME_BASE_URL
  assertLocalSupabaseUrl(supabaseUrl)
  assertLocalAppUrl(baseUrl)
  assert.ok(serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY is required in local fixture mode')

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: originalSetting, error: originalSettingError } = await supabase
    .from('system_settings')
    .select('key, value, description, updated_at')
    .eq('key', settingKey)
    .maybeSingle()
  assert.ifError(originalSettingError)

  const image = await readFile(new URL('../public/icons/file-types/pdf-icon.png', import.meta.url))
  const fixturePaths = fixtureItems.map(
    ({ id, assetId }) => `carousel/${id}/pc/${assetId}.png`
  )
  const browser = await chromium.launch()
  const createdPaths = []

  try {
    for (const path of fixturePaths) {
      const directory = path.slice(0, path.lastIndexOf('/'))
      const fileName = path.slice(path.lastIndexOf('/') + 1)
      const { data: existingFiles, error: listError } = await supabase.storage
        .from(bucket)
        .list(directory)
      assert.ifError(listError)
      assert.equal(
        (existingFiles ?? []).some((file) => file.name === fileName),
        false,
        `fixture path already exists and will not be overwritten: ${path}`
      )
      const { error } = await supabase.storage.from(bucket).upload(path, image, {
        contentType: 'image/png',
        upsert: false,
      })
      assert.ifError(error)
      createdPaths.push(path)
    }

    const combinations = [
      { englishCount: 0, koreanCount: 0, englishState: 'empty', koreanState: 'empty' },
      { englishCount: 1, koreanCount: 1, englishState: 'single', koreanState: 'single' },
      { englishCount: 2, koreanCount: 2, englishState: 'multiple', koreanState: 'multiple' },
      { englishCount: 2, koreanCount: 0, englishState: 'multiple', koreanState: 'empty' },
    ]

    for (const combination of combinations) {
      const { error } = await supabase.from('system_settings').upsert({
        key: settingKey,
        value: fixtureConfig(combination.englishCount, combination.koreanCount),
        description: 'Local main ad carousel browser fixture',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' })
      assert.ifError(error)

      for (const width of viewports) {
        const rects = {}
        for (const subject of subjects) {
          const expectedState = combination[`${subject}State`]
          rects[`${subject}Ssr`] = await inspectCarousel(
            browser, baseUrl, subject, width, false, expectedState
          )
          rects[`${subject}Hydrated`] = await inspectCarousel(
            browser, baseUrl, subject, width, true, expectedState
          )
          assertRectNear(
            rects[`${subject}Hydrated`],
            rects[`${subject}Ssr`],
            `${subject} ${expectedState} SSR/hydration rect at ${width}px`
          )
        }

        if (combination.englishState === combination.koreanState) {
          assertRectNear(
            rects.englishHydrated,
            rects.koreanHydrated,
            `${combination.englishState} subject parity at ${width}px`
          )
        } else {
          assertRectNear(
            rects.englishHydrated,
            rects.koreanHydrated,
            `multiple/empty shell parity at ${width}px`,
            ['width', 'height']
          )
        }
      }
    }
  } finally {
    await browser.close()

    if (originalSetting) {
      const { error } = await supabase
        .from('system_settings')
        .upsert(originalSetting, { onConflict: 'key' })
      assert.ifError(error)
    } else {
      const { error } = await supabase
        .from('system_settings')
        .delete()
        .eq('key', settingKey)
      assert.ifError(error)
    }

    if (createdPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage.from(bucket).remove(createdPaths)
      assert.ifError(cleanupError)
    }

    const { data: restoredSetting, error: restoredSettingError } = await supabase
      .from('system_settings')
      .select('key, value, description, updated_at')
      .eq('key', settingKey)
      .maybeSingle()
    assert.ifError(restoredSettingError)
    assert.deepEqual(restoredSetting, originalSetting)
  }
})
