import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

import {
  MAIN_AD_DEFAULT_DURATION_SECONDS,
  MAIN_AD_IMAGES_BUCKET,
  MAIN_AD_MAX_FILE_SIZE_BYTES,
  buildMainAdStoragePath,
  getDefaultMainAdCarouselConfig,
  getMainAdImageExtension,
  isAllowedMainAdHref,
  normalizeMainAdCarouselConfig,
  resolveMainAdCarouselConfigForUpdate,
  validateMainAdCarouselConfig,
  validateMainAdCarouselDraftConfig,
  validateMainAdStoragePath,
} from '../src/lib/main-ad-carousel.ts'

const itemId = '5f5bdada-e30a-48ca-88e9-51f994f6f6ec'
const assetId = '76757991-f555-4a8a-a6cb-e0031f9f5945'
const pcImagePath = `carousel/${itemId}/pc/${assetId}.webp`
const carouselPath = new URL(
  '../src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx',
  import.meta.url
)
const previewPagePath = new URL(
  '../src/app/preview/solvook-concept/page.tsx',
  import.meta.url
)

function createValidItem() {
  return {
    id: itemId,
    title: '어법·어휘 특강팩 35% 할인',
    pcImagePath,
    mobileImagePath: null,
    alt: '어법·어휘 특강팩 할인 안내',
    href: '/pricing',
    durationSeconds: MAIN_AD_DEFAULT_DURATION_SECONDS,
    isActive: true,
  }
}

test('main ad defaults keep the carousel disabled until a valid active item is saved', () => {
  assert.equal(MAIN_AD_IMAGES_BUCKET, 'main-ad-images')
  assert.equal(MAIN_AD_DEFAULT_DURATION_SECONDS, 6)
  assert.deepEqual(getDefaultMainAdCarouselConfig(), { version: 1, items: [] })
})

test('main ad href accepts only safe internal paths and external https URLs', () => {
  assert.equal(isAllowedMainAdHref('/pricing'), true)
  assert.equal(isAllowedMainAdHref('/korean/market/mock-exams?sort=latest'), true)
  assert.equal(isAllowedMainAdHref('https://solvook.com/'), true)

  for (const href of [
    'http://solvook.com/',
    '//solvook.com/',
    'javascript:alert(1)',
    'data:text/html,hello',
    '/safe\\unsafe',
    '/safe/../admin',
    '/%2e%2e/admin',
    '/%2F%2Fsolvook.com',
    '/%0aunsafe',
  ]) {
    assert.equal(isAllowedMainAdHref(href), false, `${href} should be rejected`)
  }
})

test('main ad config validates UUIDs, duplicate ids, duration and storage paths', () => {
  const validConfig = {
    version: 1,
    items: [createValidItem()],
  }

  assert.deepEqual(validateMainAdCarouselConfig(validConfig), validConfig)

  assert.throws(() => validateMainAdCarouselConfig({
    ...validConfig,
    items: [{ ...createValidItem(), durationSeconds: 0 }],
  }))
  assert.throws(() => validateMainAdCarouselConfig({
    ...validConfig,
    items: [{ ...createValidItem() }, { ...createValidItem() }],
  }))
  assert.throws(() => validateMainAdCarouselConfig({
    ...validConfig,
    items: [{ ...createValidItem(), pcImagePath: `carousel/${itemId}/mobile/${assetId}.webp` }],
  }))
})

test('draft validation permits a new item without a stored pc path before multipart files are applied', () => {
  const draft = validateMainAdCarouselDraftConfig({
    version: 1,
    items: [{ ...createValidItem(), pcImagePath: '' }],
  })

  assert.equal(draft.items[0].pcImagePath, '')
  assert.throws(() => validateMainAdCarouselConfig(draft))
})

test('storage paths are item and role scoped and reject traversal or foreign paths', () => {
  const path = buildMainAdStoragePath(itemId, 'pc', assetId, 'webp')

  assert.equal(path, pcImagePath)
  assert.equal(validateMainAdStoragePath(path, itemId, 'pc'), path)
  assert.throws(() => validateMainAdStoragePath(path, itemId, 'mobile'))
  assert.throws(() => validateMainAdStoragePath(`carousel/${itemId}/pc/../asset.webp`, itemId, 'pc'))
  assert.throws(() => validateMainAdStoragePath('https://example.com/asset.webp', itemId, 'pc'))
})

test('image validation allows jpeg, png and webp up to 10MB', () => {
  assert.equal(MAIN_AD_MAX_FILE_SIZE_BYTES, 10 * 1024 * 1024)
  assert.equal(getMainAdImageExtension({
    name: 'banner.jpeg',
    size: MAIN_AD_MAX_FILE_SIZE_BYTES,
    type: 'image/jpeg',
  }), 'jpg')
  assert.equal(getMainAdImageExtension({ name: 'banner.png', size: 1, type: 'image/png' }), 'png')
  assert.equal(getMainAdImageExtension({ name: 'banner.webp', size: 1, type: 'image/webp' }), 'webp')
  assert.throws(() => getMainAdImageExtension({ name: 'banner.gif', size: 1, type: 'image/gif' }))
  assert.throws(() => getMainAdImageExtension({
    name: 'banner.webp',
    size: MAIN_AD_MAX_FILE_SIZE_BYTES + 1,
    type: 'image/webp',
  }))
})

test('invalid stored config normalizes to the disabled fallback contract', () => {
  assert.deepEqual(normalizeMainAdCarouselConfig(null), getDefaultMainAdCarouselConfig())
  assert.deepEqual(
    normalizeMainAdCarouselConfig({ version: 1, items: [{ ...createValidItem(), href: 'javascript:alert(1)' }] }),
    getDefaultMainAdCarouselConfig()
  )
})

test('stored config normalizes missing duration to 6 seconds and trims href', () => {
  const normalized = normalizeMainAdCarouselConfig({
    version: 1,
    items: [{
      ...createValidItem(),
      durationSeconds: undefined,
      href: '  /pricing  ',
    }],
  })

  assert.equal(normalized.items[0].durationSeconds, MAIN_AD_DEFAULT_DURATION_SECONDS)
  assert.equal(normalized.items[0].href, '/pricing')
})

test('strict update resolution distinguishes a missing row from an invalid stored JSON value', () => {
  assert.deepEqual(
    resolveMainAdCarouselConfigForUpdate(undefined, false),
    getDefaultMainAdCarouselConfig()
  )

  for (const invalidValue of [false, 0, '', null]) {
    assert.throws(
      () => resolveMainAdCarouselConfigForUpdate(invalidValue, true),
      `stored ${String(invalidValue)} should stop an update`
    )
  }
})

test('preview page preserves the existing hero fallback and all lower sections', () => {
  const page = readFileSync(previewPagePath, 'utf8')

  assert.match(page, /getPublicMainAdCarouselItems/)
  assert.match(page, /MainAdCarousel/)
  assert.match(page, /CampaignHero/)
  assert.match(page, /QuickAccessGrid/)
  assert.match(page, /RecommendedMaterials/)
  assert.match(page, /TextbookExplorer/)
  assert.match(page, /RecentMaterials/)
  assert.match(page, /HomeFinalCta/)
})

test('main ad carousel follows the verified responsive and timer interaction contract', () => {
  assert.ok(existsSync(carouselPath), 'main ad carousel component should exist')
  const carousel = readFileSync(carouselPath, 'utf8')

  assert.match(carousel, /setTimeout/)
  assert.match(carousel, /durationSeconds\s*\*\s*1000/)
  assert.match(carousel, /scrollIntoView/)
  assert.match(carousel, /<picture/)
  assert.match(carousel, /max-width:\s*640px/)
  assert.match(carousel, /min-\[1080px\]/)
  assert.match(carousel, /min-\[1200px\]/)
  assert.match(carousel, /h-\[360px\]/)
  assert.match(carousel, /aria-current/)
  assert.match(carousel, /activeItems\.length\s*>\s*1/)
  assert.doesNotMatch(carousel, /target="_blank"/)
  assert.doesNotMatch(carousel, /onTouch|swipe/i)
})
