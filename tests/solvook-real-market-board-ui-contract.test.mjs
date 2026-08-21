import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const pageUrl = new URL(
  '../src/app/preview/solvook-concept/boards/[slug]/page.tsx',
  import.meta.url
)
const realBoardUrl = new URL(
  '../src/app/preview/solvook-concept/_components/board/real-market-board.tsx',
  import.meta.url
)
const sidebarUrl = new URL(
  '../src/app/preview/solvook-concept/_components/board/board-category-sidebar.tsx',
  import.meta.url
)
const commonMenuUrl = new URL(
  '../src/app/preview/solvook-concept/_components/ProblemMarketMenu.tsx',
  import.meta.url
)
const resultsUrl = new URL(
  '../src/app/preview/solvook-concept/_components/board/real-market-board-results.tsx',
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

test('preview board page resolves subject and applies only search and year filters', () => {
  const source = readSource(pageUrl)

  assert.match(source, /getMarketBoardData/)
  assert.match(source, /resolveSubject/)
  assert.match(source, /const subject = resolveSubject/)
  assert.match(source, /status === 'not_found'/)
  assert.match(source, /status === 'error'/)
  assert.match(source, /<RealMarketBoard\b/)
  assert.match(source, /examYear: parsePositiveInteger\(filters\.year\)/)
  assert.match(source, /parseSort\(firstValue\(resolvedSearchParams\.sort\)\) \?\? 'views'/)
  assert.doesNotMatch(source, /resolvedSearchParams\.(month|grade|sourceType|source[1-4])/)
  assert.doesNotMatch(source, /examMonth|gradeLevel|sourceType|source[1-4]|pageSize/)
  assert.doesNotMatch(source, /value === 'questions'/)
  assert.doesNotMatch(source, /normalizeReadyFilters/)
  assert.doesNotMatch(source, /sample-data|BoardListController/)
})

test('real market board uses one GET filter form with title search and year only', () => {
  const source = readSource(realBoardUrl)

  assert.match(source, /StudioContainer/)
  assert.match(source, /StudioFilterPanel/)
  assert.match(source, /studio-reference-gutter/)
  assert.match(source, /data-slot="market-board-layout"/)
  assert.match(source, /data-slot="market-board-content"/)
  assert.match(source, /<header>/)
  assert.doesNotMatch(source, /StudioPageHeader/)
  assert.doesNotMatch(source, /aria-label="Breadcrumb"/)
  assert.doesNotMatch(source, /문제마켓 프리뷰/)
  assert.doesNotMatch(source, /공개 자료 \{data\.total/)
  assert.doesNotMatch(source, /현재 페이지 \{data\.rows\.length/)
  assert.doesNotMatch(source, /같은 분류의 카테고리/)
  assert.doesNotMatch(source, /const currentGroup =/)
  assert.doesNotMatch(source, /function buildBoardHref/)
  assert.match(source, /<form[\s\S]*method="get"/)
  assert.equal(source.match(/<form\b/g)?.length ?? 0, 1, 'board must keep one filter form')
  assert.match(source, /name="subject"/)
  assert.match(source, /name="search"/)
  assert.match(source, /name="sort"/)
  assert.match(source, /className="min-h-11 pl-9"/)
  assert.match(source, /name="year"/)
  assert.doesNotMatch(source, /name="pageSize"/)
  assert.doesNotMatch(source, /name="month"/)
  assert.doesNotMatch(source, /name="grade"/)
  assert.doesNotMatch(source, /name="sourceType"/)
  assert.doesNotMatch(source, /activeSourceConfig|source[1-4]/)
  assert.match(source, /\{subjectLabel\} \/ \{data\.category\.title\}/)
  assert.match(source, /text-sm font-medium text-\[var\(--studio-muted\)\]/)
  assert.doesNotMatch(source, /MARKET BOARD/)
  assert.doesNotMatch(source, /data\.category\.description/)
  assert.doesNotMatch(source, /공개 자료를 실제 카테고리 기준으로 탐색/)
  assert.match(source, /<StudioContainer className="relative space-y-6">/)
  assert.match(source, /data-slot="market-board-layout"[\s\S]*className="grid gap-6"/)
  assert.doesNotMatch(source, /md:grid-cols-\[200px_minmax\(0,1fr\)\]/)
  assert.doesNotMatch(source, /lg:grid-cols-\[240px_minmax\(0,1fr\)\]/)
})

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
  const source = readSource(resultsUrl)
  const rows = readSource(materialListUrl)

  assert.match(source, /'use client'/)
  assert.match(source, /StudioBoardShell/)
  assert.match(source, /StudioPagination/)
  assert.match(source, /navigationText=\{\{/)
  assert.match(source, /first: '<<'/)
  assert.match(source, /previous: '<'/)
  assert.match(source, /next: '>'/)
  assert.match(source, /last: '>>'/)
  assert.match(source, /<MarketMaterialList/)
  assert.match(rows, /MarketSamplePreviewDialog/)
  assert.match(rows, /from '@\/app\/\(dashboard\)\/market\/\[slug\]\/items\/\[itemId\]\/market-sample-preview-dialog'/)
  assert.equal(
    rows.match(/<MarketSamplePreviewDialog\b/g)?.length ?? 0,
    1,
    'rows must share one market sample preview dialog instance'
  )
  assert.match(rows, /useRef<HTMLButtonElement \| null>\(null\)/)
  assert.match(rows, /samplePreviewItemId/)
  assert.match(rows, /setSamplePreviewItemId\(itemId\)/)
  assert.match(rows, /sampleTriggerRef\.current = event\.currentTarget/)
  assert.match(source, /<Select\b/)
  assert.match(source, /<SelectTrigger[\s\S]*aria-label="자료 정렬"/)
  assert.match(source, /<StudioSelectContent/)
  assert.match(source, /<SelectItem value="views">인기순<\/SelectItem>/)
  assert.match(source, /<SelectItem value="latest">최신순<\/SelectItem>/)
  assert.match(source, /router\.push\(buildBoardHref/)
  assert.doesNotMatch(source, /조회순|문항순|PAGE_SIZE_OPTIONS|개씩|pageSize/)
  assert.match(rows, /<ul\b/)
  assert.match(rows, /role="list"/)
  assert.match(rows, /md:grid-cols-\[56px_minmax\(0,1fr\)_auto\]/)
  assert.equal(
    rows.match(/h-\[79px\] w-\[56px\]/g)?.length ?? 0,
    2,
    'real and fallback thumbnails must share the compact Solvook dimensions'
  )
  assert.doesNotMatch(rows, /md:h-\[132px\]/)
  assert.match(source, /row\.startingPriceCredits/)
  assert.match(
    rows,
    /`\$\{item\.startingPriceCredits\.toLocaleString\('ko-KR'\)\} 크레딧`/
  )
  assert.doesNotMatch(rows, /크레딧부터/)
  assert.doesNotMatch(source, /row\.sellerName/)
  assert.match(source, /row\.ratingAverage/)
  assert.match(source, /row\.ratingCount/)
  assert.match(rows, /item\.ratingAverage === null[\s\S]*\? '0\.0'/)
  assert.doesNotMatch(rows, /평점 없음/)
  assert.match(rows, /Star/)
  assert.match(source, /set\('search', search\)/)
  assert.match(source, /set\('year', year\)/)
  assert.doesNotMatch(source, /set\('(month|grade|sourceType|source[1-4])'/)
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
  assert.match(
    source,
    /`\/preview\/solvook-concept\/boards\/\$\{categorySlug\}\/items\/\$\{row\.id\}\?subject=\$\{subject\}`/
  )
  assert.doesNotMatch(
    source,
    /ebs-literature\/posts\/jingsori-2027/
  )
  assert.doesNotMatch(source, /\/api\/market\//)
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
