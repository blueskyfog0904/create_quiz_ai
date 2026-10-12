import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const sidebarUrl = new URL(
  '../src/app/preview/solvook-concept/_components/board/board-category-sidebar.tsx',
  import.meta.url
)
const commonMenuUrl = new URL(
  '../src/app/preview/solvook-concept/_components/ProblemMarketMenu.tsx',
  import.meta.url
)
const materialListUrl = new URL(
  '../src/app/preview/solvook-concept/_components/market-material-list.tsx',
  import.meta.url
)
const previewLayoutUrl = new URL(
  '../src/app/preview/solvook-concept/layout.tsx',
  import.meta.url
)
const studioTokensUrl = new URL(
  '../src/styles/studio-tokens.css',
  import.meta.url
)

function readSource(url) {
  assert.equal(existsSync(url), true, `${url.pathname.split('/').at(-1)} must exist`)
  return readFileSync(url, 'utf8')
}

test('board category sidebar delegates the same transparent menu used by the home page', () => {
  const source = readSource(sidebarUrl)
  const commonMenu = readSource(commonMenuUrl)

  assert.match(source, /import \{ ProblemMarketMenu \} from '\.\.\/ProblemMarketMenu'/)
  assert.match(source, /<ProblemMarketMenu/)
  assert.match(source, /groups\.flatMap/)
  assert.match(source, /isCurrent: entry\.slug === categorySlug/)
  assert.match(source, /subject=/)
  assert.match(source, /set\('subject', subject\)/)
  assert.match(source, /set\('search', search\)/)
  assert.match(source, /set\('year', year\)/)
  assert.doesNotMatch(source, /pageSize/)
  assert.doesNotMatch(source, /set\('(month|grade|sourceType|source[1-4])'/)
  assert.match(source, /min-\[1720px\]:absolute/)
  assert.match(source, /min-\[1720px\]:left-6/)
  assert.match(source, /min-\[1720px\]:top-0/)
  assert.match(source, /min-\[1720px\]:-translate-x-full/)
  assert.match(source, /min-\[1720px\]:w-56/)
  assert.doesNotMatch(source, /bg-\[var\(--studio-surface\)\]/)
  assert.doesNotMatch(source, /useState|aria-expanded|board-mobile-navigation/)
  assert.doesNotMatch(source, /entry\.itemCount/)

  assert.match(commonMenu, /data-slot="problem-market-menu"/)
  assert.match(commonMenu, /aria-current=\{entry\.isCurrent \? 'page' : undefined\}/)
  assert.doesNotMatch(commonMenu, /bg-\[var\(--studio-surface\)\]/)
})

test('board results keep one semantic list and one shared market sample preview dialog', () => {
  const rows = readSource(materialListUrl)

  assert.match(rows, /MarketSamplePreviewDialog/)
  assert.match(rows, /from '@\/components\/market\/market-sample-preview-dialog'/)
  assert.equal(
    rows.match(/<MarketSamplePreviewDialog\b/g)?.length ?? 0,
    1,
    'rows must share one market sample preview dialog instance'
  )
  assert.match(rows, /useRef<HTMLButtonElement \| null>\(null\)/)
  assert.match(rows, /samplePreviewItemId/)
  assert.match(rows, /setSamplePreviewItemId\(itemId\)/)
  assert.match(rows, /sampleTriggerRef\.current = event\.currentTarget/)
  assert.match(rows, /<ul\b/)
  assert.match(rows, /role="list"/)
  assert.match(rows, /md:grid-cols-\[56px_minmax\(0,1fr\)_auto\]/)
  assert.equal(
    rows.match(/h-\[79px\] w-\[56px\]/g)?.length ?? 0,
    2,
    'real and fallback thumbnails must share the compact Solvook dimensions'
  )
  assert.doesNotMatch(rows, /md:h-\[132px\]/)
  assert.match(
    rows,
    /`\$\{item\.startingPriceCredits\.toLocaleString\('ko-KR'\)\} 크레딧`/
  )
  assert.doesNotMatch(rows, /크레딧부터/)
  assert.match(rows, /item\.ratingAverage === null[\s\S]*\? '0\.0'/)
  assert.doesNotMatch(rows, /평점 없음/)
  assert.match(rows, /Star/)
  assert.match(
    rows,
    /className="flex min-h-11 items-center break-keep text-lg font-semibold leading-7 text-\[var\(--studio-text\)\]/
  )
  assert.match(rows, /md:col-start-3 md:row-start-1/)
  assert.equal(
    rows.match(/샘플보기/g)?.length ?? 0,
    1,
    'each row renderer must own one responsive sample action'
  )
  assert.doesNotMatch(rows, /FileSearch/)
  assert.doesNotMatch(rows, /샘플 보기/)
  assert.doesNotMatch(rows, /상세 보기/)
  assert.doesNotMatch(rows, /ChevronRight/)
  assert.doesNotMatch(rows, /fileTypeLabels/)
  assert.doesNotMatch(rows, /<Badge/)
})

test('board prices use the same Pretendard subtitle typography as Solvook', () => {
  const results = readSource(materialListUrl)
  const layout = readSource(previewLayoutUrl)
  const tokens = readSource(studioTokensUrl)

  assert.match(
    layout,
    /href="https:\/\/cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard\/dist\/web\/static\/pretendard\.css"/
  )
  assert.match(tokens, /--studio-font-price:\s*"Pretendard",\s*var\(--studio-font-sans\);/)
  assert.match(
    results,
    /className="\[font-family:var\(--studio-font-price\)\] text-base font-semibold leading-6 text-\[var\(--studio-ink\)\]"/
  )
})
