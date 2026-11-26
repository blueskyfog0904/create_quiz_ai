import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

import {
  MAIN_AD_DEFAULT_DURATION_SECONDS,
  MAIN_AD_IMAGES_BUCKET,
  MAIN_AD_MAX_FILE_SIZE_BYTES,
  buildMainAdStoragePath,
  getActiveMainAdCarouselItems,
  getDefaultMainAdCarouselConfig,
  getMainAdCarouselSubjectConfig,
  getMainAdImageExtension,
  isAllowedMainAdHref,
  normalizeMainAdCarouselConfig,
  replaceMainAdCarouselSubjectConfig,
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

// 22번 예약 칸: 예약 칸이 없는 옛 항목은 startsAt·endsAt 이 null 로 읽힌다(판은 그대로).
const withSchedule = (item) => ({ ...item, startsAt: null, endsAt: null })

test('main ad defaults keep the carousel disabled until a valid active item is saved', () => {
  assert.equal(MAIN_AD_IMAGES_BUCKET, 'main-ad-images')
  assert.equal(MAIN_AD_DEFAULT_DURATION_SECONDS, 5)
  assert.deepEqual(getDefaultMainAdCarouselConfig(), {
    version: 2,
    items: { english: [], korean: [] },
  })
})

test('legacy shared ads migrate to english and subject slices remain isolated', () => {
  const legacy = { version: 1, items: [createValidItem()] }
  const normalized = normalizeMainAdCarouselConfig(legacy)
  assert.deepEqual(normalized.items.english, legacy.items.map(withSchedule))
  assert.deepEqual(normalized.items.korean, [])

  const koreanItem = {
    ...createValidItem(),
    id: '18847a16-f0a8-4ccf-a3a1-d50e5e6e9d20',
    pcImagePath: 'carousel/18847a16-f0a8-4ccf-a3a1-d50e5e6e9d20/pc/76757991-f555-4a8a-a6cb-e0031f9f5945.webp',
  }
  const replaced = replaceMainAdCarouselSubjectConfig(normalized, 'korean', {
    version: 1,
    items: [koreanItem],
  })
  assert.deepEqual(getMainAdCarouselSubjectConfig(replaced, 'english').items, legacy.items.map(withSchedule))
  assert.deepEqual(getActiveMainAdCarouselItems(replaced, 'korean'), [withSchedule(koreanItem)])
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
    version: 2,
    items: { english: [createValidItem()], korean: [] },
  }

  assert.deepEqual(validateMainAdCarouselConfig(validConfig), {
    ...validConfig,
    items: { english: validConfig.items.english.map(withSchedule), korean: [] },
  })

  assert.throws(() => validateMainAdCarouselConfig({
    ...validConfig,
    items: { ...validConfig.items, english: [{ ...createValidItem(), durationSeconds: 0 }] },
  }))
  assert.throws(() => validateMainAdCarouselConfig({
    ...validConfig,
    items: { ...validConfig.items, english: [{ ...createValidItem() }, { ...createValidItem() }] },
  }))
  assert.throws(() => validateMainAdCarouselConfig({
    ...validConfig,
    items: { ...validConfig.items, english: [{ ...createValidItem(), pcImagePath: `carousel/${itemId}/mobile/${assetId}.webp` }] },
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

test('stored config normalizes missing duration to 5 seconds and trims href', () => {
  const normalized = normalizeMainAdCarouselConfig({
    version: 1,
    items: [{
      ...createValidItem(),
      durationSeconds: undefined,
      href: '  /pricing  ',
    }],
  })

  assert.equal(normalized.items.english[0].durationSeconds, MAIN_AD_DEFAULT_DURATION_SECONDS)
  assert.equal(normalized.items.english[0].href, '/pricing')
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

// 22번(계획 Q6·3-3·3-5, 의도적 변경): 이 시험은 22번 전부터 실패하던 옛 단언(getPublicMainAdCarouselItems 직접 호출·빈 틀 항상 그림·
// page 안 고정 섹션)을 22번 구조로 바꿨다. 배너는 캐시(getCachedMainAdItems)에서 받아 캐시 밖에서 요청마다 기간으로 거르고,
// 보일 배너가 0개면 영역을 그리지 않으며, 아래 섹션은 저장한 순서대로 MarketHomeSections 가 그린다(배너 수를 넘겨 빈 홈 링크 판정).
test('preview page filters banners outside the cache, hides an empty banner area and renders the saved home sections', () => {
  const page = readFileSync(previewPagePath, 'utf8')

  assert.match(page, /getCachedMainAdItems\(subject\)/)
  assert.doesNotMatch(page, /getPublicMainAdCarouselItems/)
  assert.match(page, /const mainAdItems = filterVisibleMainAdItems\(cachedAdItems, new Date\(\)\)/)
  assert.equal((page.match(/<MainAdCarousel\b/g) ?? []).length, 1)
  assert.match(page, /hero=\{mainAdItems\.length > 0 \? <MainAdCarousel subject=\{subject\} items=\{mainAdItems\} \/> : null\}/)
  assert.match(page, /<MarketHomeSections subject=\{subject\} homeData=\{homeData\} visibleBannerCount=\{mainAdItems\.length\} \/>/)
  assert.doesNotMatch(page, /CampaignHero|QuickAccessGrid|TextbookExplorer/)
})

test('main ad carousel follows the verified responsive and timer interaction contract', () => {
  assert.ok(existsSync(carouselPath), 'main ad carousel component should exist')
  const carousel = readFileSync(carouselPath, 'utf8')

  assert.match(carousel, /performance\.now\(\)/)
  assert.match(carousel, /requestAnimationFrame/)
  assert.match(carousel, /durationSeconds\s*\*\s*1000/)
  assert.match(carousel, /progressLayerRefs/)
  assert.match(carousel, /data-slot="main-ad-progress"/)
  assert.match(carousel, /progressCompleteTimeoutRef/)
  assert.match(carousel, /clearProgressScheduling/)
  assert.match(carousel, /scaleX\(/)
  assert.doesNotMatch(
    carousel,
    /className="absolute inset-0 scale-x-0 bg-\[var\(--studio-control-border\)\] opacity-40"/
  )
  assert.match(
    carousel,
    /className="absolute inset-0 bg-\[var\(--studio-control-border\)\] opacity-40"[\s\S]*transform:\s*'scaleX\(0\)'/
  )
  assert.doesNotMatch(carousel, /bg-\[var\(--studio-border\)\][^"]*opacity-70/)
  assert.doesNotMatch(carousel, /last:border-b-0/)
  assert.match(carousel, /transform \${remainingMs}ms linear/)
  assert.match(carousel, /transformOrigin:\s*'left center'/)
  assert.match(
    carousel,
    /if\s*\(isTransitioning\)[\s\S]*syncProgressLayers\(1\)/
  )
  assert.doesNotMatch(
    carousel,
    /if\s*\([^)]*isTransitioning[^)]*\)[\s\S]{0,180}syncProgressLayers\(0\)/
  )
  assert.match(carousel, /const SLIDE_DURATION_MS = 450/)
  assert.match(carousel, /translateX\(-100%\)/)
  assert.match(carousel, /translateX\(100%\)/)
  assert.match(carousel, /onTransitionEnd=\{/)
  assert.match(carousel, /event\.propertyName\s*!==\s*'transform'/)
  assert.match(carousel, /event\.target\s*!==\s*event\.currentTarget/)
  assert.match(carousel, /setTimeout\(\(\)\s*=>\s*\{\s*finishTransition/)
  assert.match(carousel, /transitionTimingFunction:\s*'ease-out'/)
  assert.match(carousel, /scrollIntoView/)
  assert.match(carousel, /<picture/)
  assert.match(carousel, /max-width:\s*640px/)
  assert.match(carousel, /min-\[1080px\]/)
  assert.match(carousel, /min-\[1200px\]/)
  assert.match(carousel, /h-\[360px\]/)
  assert.match(carousel, /aria-current/)
  assert.match(carousel, /aria-\[current=true\]:hover:bg-transparent/)
  assert.match(carousel, /pointer-events-none/)
  assert.match(carousel, /tabIndex=\{isTransitioning\s*\?\s*-1\s*:\s*undefined\}/)
  assert.match(carousel, /disabled=\{isInteractionLocked\}/)
  assert.match(carousel, /itemsSignature/)
  assert.match(carousel, /renderedItemsSignature/)
  assert.match(carousel, /previousItemsSignatureRef/)
  assert.match(carousel, /itemsHaveChanged/)
  assert.match(carousel, /useLayoutEffect\(\(\) => \{[\s\S]*previousItemsSignatureRef/)
  assert.match(
    carousel,
    /useEffect\(\(\) => \{[\s\S]*clockRef\.current\.durationMs[\s\S]*\[[\s\S]*itemsSignature[\s\S]*\]\)/
  )
  assert.match(carousel, /transitionTokenRef\.current \+= 1/)
  assert.match(
    carousel,
    /if\s*\(itemsHaveChanged\)[\s\S]*setActiveIndex\(0\)[\s\S]*setTransitionState\(null\)/
  )
  assert.match(carousel, /index === resolvedActiveIndex/)
  assert.match(carousel, /\{resolvedActiveIndex \+ 1\} \/ \{activeItems\.length\}/)
  assert.doesNotMatch(carousel, /\{activeIndex \+ 1\} \/ \{activeItems\.length\}/)
  assert.doesNotMatch(carousel, /timerKey/)
  assert.doesNotMatch(carousel, /setActiveProgress/)
  assert.doesNotMatch(
    carousel,
    /selected\s*\?[\s\S]*bg-\[var\(--studio-background\)\][\s\S]*hover:bg-\[var\(--studio-background\)\]/
  )
  assert.doesNotMatch(carousel, /isPointerInside/)
  assert.doesNotMatch(carousel, /onMouseEnter/)
  assert.doesNotMatch(carousel, /onMouseLeave/)
  assert.match(carousel, /const isCyclePaused = isDocumentHidden/)
  assert.doesNotMatch(carousel, /useState\(false\)/)
  assert.doesNotMatch(carousel, /isFocusWithin/)
  assert.doesNotMatch(carousel, /onFocusCapture/)
  assert.doesNotMatch(carousel, /onBlurCapture/)
  assert.match(carousel, /visibilitychange/)
  assert.match(carousel, /prefers-reduced-motion/)
  assert.match(carousel, /isDocumentHidden/)
  assert.match(carousel, /prefersReducedMotion/)
  assert.match(carousel, /activeItems\.length\s*>\s*1/)
  assert.match(carousel, /activeItems\.length\s*<=\s*1/)
  // 22번(계획 Q6·3-5, 의도적 변경): 보일 배너가 0개면 page 가 부품을 그리지 않고, 부품도 빈 틀 없이 아무것도 그리지 않는다.
  // 훅을 모두 부른 뒤에만 null 을 돌려준다(return 문 바로 앞).
  assert.match(carousel, /if \(!activeItem\) return null\n\n  return \(/)
  assert.match(carousel, /data-slot="main-ad-carousel"/)
  assert.match(carousel, /data-state=\{carouselState\}/)
  assert.match(carousel, /const carouselState = activeItems\.length === 1 \? 'single' : 'multiple'/)
  assert.match(carousel, /subject:\s*WorkspaceSubject/)
  assert.doesNotMatch(carousel, /광고가 없습니다|문제마켓 보기|'empty'/)
  assert.match(carousel, /hasMultipleItems\s*\?\s*\([\s\S]*progressLayerRefs/)
  assert.match(carousel, /hasMultipleItems\s*\?\s*\([\s\S]*aria-label="이전 광고"[\s\S]*aria-label="다음 광고"/)
  assert.doesNotMatch(carousel, /empty[\s\S]{0,240}aria-current/)
  assert.doesNotMatch(carousel, /empty[\s\S]{0,240}MainAdLink/)
  assert.match(carousel, /if\s*\(nextIndex === resolvedActiveIndex\)/)
  assert.match(carousel, /min-h-\[60px\]/)
  assert.match(carousel, /h-11 w-11/)
  assert.match(carousel, /focus-visible:ring-2/)
  assert.doesNotMatch(carousel, /className="[^"]*\bhidden\b[^"]*h-11 w-11/)
  assert.doesNotMatch(carousel, /min-\[1200px\]:inline-flex/)
  assert.match(
    carousel,
    /type="button"[\s\S]*aria-label="이전 광고"[\s\S]*onClick=\{\(\) => move\('previous'\)\}/
  )
  assert.match(
    carousel,
    /type="button"[\s\S]*aria-label="다음 광고"[\s\S]*onClick=\{\(\) => move\('next'\)\}/
  )
  assert.match(
    carousel,
    /<MainAdLink[\s\S]*href=\{activeItem\.href\}[\s\S]*<picture[\s\S]*<\/picture>[\s\S]*<\/MainAdLink>/
  )
  assert.doesNotMatch(carousel, /target="_blank"/)
  assert.doesNotMatch(carousel, /onTouch|swipe/i)
})
