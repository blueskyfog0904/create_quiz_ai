import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('popular downloads reuse the same responsive list rows as the board', async () => {
  const [popular, shared] = await Promise.all([
    read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx'),
    read('src/app/preview/solvook-concept/_components/market-material-list.tsx'),
  ])

  assert.match(popular, /<MarketMaterialList/)
  assert.match(shared, /grid-cols-\[56px_minmax\(0,1fr\)\]/)
  assert.match(shared, /md:grid-cols-\[56px_minmax\(0,1fr\)_auto\]/)
  assert.doesNotMatch(popular, /grid-cols-2|lg:grid-cols-4|setInterval|pageSize/)
})

test('subject-aware preview links stay inside the selected Solvook preview', async () => {
  const [header, popular, sections] = await Promise.all([
    read('src/app/preview/solvook-concept/_components/preview-header.tsx'),
    read('src/app/preview/solvook-concept/_components/home/popular-downloads-slider.tsx'),
    read('src/app/preview/solvook-concept/_components/home/home-material-sections.tsx'),
  ])

  assert.match(header, /\?subject=english/)
  assert.match(header, /\?subject=korean/)
  assert.match(header, /aria-current=/)
  assert.match(popular, /\/preview\/solvook-concept\/boards\/\$\{item\.categorySlug\}\/items\/\$\{item\.id\}/)
  assert.match(sections, /\/preview\/solvook-concept\/boards\/\$\{item\.categorySlug\}\/items\/\$\{item\.id\}/)
})

test('preview renders database category board navigation beside the ad carousel', async () => {
  const [page, carousel, menu] = await Promise.all([
    read('src/app/preview/solvook-concept/page.tsx'),
    read('src/app/preview/solvook-concept/_components/home/main-ad-carousel.tsx'),
    read('src/app/preview/solvook-concept/_components/ProblemMarketMenu.tsx'),
  ])

  assert.match(page, /categories=\{homeData\.categories\}/)
  assert.doesNotMatch(page, /<MarketCategoryMenu/)
  assert.match(carousel, /categories:\s*MarketHomeMenuEntry\[\]/)
  assert.match(carousel, /import \{ ProblemMarketMenu \} from '\.\.\/ProblemMarketMenu'/)
  assert.match(carousel, /<ProblemMarketMenu/)
  assert.match(carousel, /entries=\{categories\.map\(\(category\)/)
  assert.doesNotMatch(carousel, /data-slot="problem-market-menu"/)
  assert.match(carousel, /min-\[1720px\]:absolute/)
  assert.match(carousel, /min-\[1720px\]:inset-y-0/)
  assert.match(carousel, /min-\[1720px\]:left-6/)
  assert.match(carousel, /min-\[1720px\]:-translate-x-full/)
  assert.match(carousel, /min-\[1720px\]:w-56/)
  assert.doesNotMatch(carousel, /min-\[1720px\]:min-h-\[360px\]/)
  assert.doesNotMatch(carousel, /bg-\[var\(--studio-surface\)\] p-5/)

  assert.match(menu, /data-slot="problem-market-menu"/)
  assert.match(menu, /<h2[\s\S]*\{subjectLabel\}[\s\S]*<\/h2>/)
  assert.match(menu, /<details open className="group">/)
  assert.match(menu, /group-open:rotate-180/)
  assert.match(menu, /\{subjectLabel\} 문제마켓/)
  assert.match(menu, /entries\.map\(\(entry\)/)
  assert.match(menu, /aria-current=\{entry\.isCurrent \? 'page' : undefined\}/)
  assert.match(menu, /aria-label=\{`\$\{subjectLabel\} 문제마켓 카테고리`\}/)
  assert.match(menu, /pl-4/)
  assert.doesNotMatch(menu, /bg-\[var\(--studio-surface\)\]/)
})

test('preview section switches preserve the single carousel shell without dead fallback anchors', async () => {
  const page = await read('src/app/preview/solvook-concept/page.tsx')

  assert.equal((page.match(/<MainAdCarousel\b/g) ?? []).length, 1)
  assert.match(page, /subject=\{subject\}/)
  assert.doesNotMatch(page, /CampaignHero/)
  assert.match(page, /homeData\.config\.popular\.isActive\s*&&\s*\([\s\S]*<PopularDownloadsSlider/)
  assert.match(page, /homeData\.config\.sourceExplorer\.isActive\s*&&\s*\([\s\S]*<TextbookExplorer/)
  assert.match(page, /homeData\.config\.recent\.isActive\s*&&\s*\([\s\S]*<RecentMaterials/)
  assert.doesNotMatch(page, /QuickAccessGrid/)
})
