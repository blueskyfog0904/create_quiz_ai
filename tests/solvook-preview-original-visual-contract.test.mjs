import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('preview keeps the original chrome and section visual grammar', async () => {
  const [layout, header, carousel, sections, cover] = await Promise.all([
    read('src/app/preview/solvook-concept/layout.tsx'),
    read('src/app/preview/solvook-concept/_components/preview-header.tsx'),
    read('src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx'),
    read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx'),
    read('src/app/preview/solvook-concept/_components/home/material-cover.tsx'),
  ])

  assert.match(layout, /<PreviewHeader \/>[\s\S]*<main className="flex-1">[\s\S]*<PreviewFooter \/>/)
  assert.match(layout, /<Suspense fallback=\{null\}>/)
  assert.match(header, /lg:hidden/)
  assert.match(header, /hidden lg:block/)
  assert.match(carousel, /data-slot="main-ad-carousel"/)
  assert.match(carousel, /h-\[220px\].*sm:h-\[300px\].*min-\[641px\]:h-\[360px\]/)
  assert.match(carousel, /min-\[1080px\]:w-\[200px\].*min-\[1200px\]:w-60/)
  assert.doesNotMatch(carousel, /min-h-\[420px\]|min-h-\[442px\]/)
  assert.match(cover, /aspect-\[4\/5\]/)
  assert.match(sections, /min-h-\[180px\].*bg-gradient-to-br/)
  assert.match(sections, /min-h-\[112px\]/)
  assert.match(sections, /bg-\[var\(--studio-ink\)\].*px-6 py-9/)
})

test('preview injects real subject market data without sample home imports', async () => {
  const page = await read('src/app/preview/solvook-concept/page.tsx')

  assert.match(page, /getMarketHomeData\(subject\)/)
  assert.match(page, /getPublicMainAdCarouselItems\(subject\)/)
  assert.doesNotMatch(page, /_data\/sample-data/)
  assert.ok(page.indexOf('<PopularDownloadsSlider') < page.indexOf('<RecentMaterials'))
  assert.ok(page.indexOf('<RecentMaterials') < page.indexOf('<TextbookExplorer'))
  assert.ok(page.indexOf('<TextbookExplorer') < page.indexOf('<HomeFinalCta'))
  assert.doesNotMatch(page, /QuickAccessGrid/)
})
