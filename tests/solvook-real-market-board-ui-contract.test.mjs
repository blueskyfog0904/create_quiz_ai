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
const resultsUrl = new URL(
  '../src/app/preview/solvook-concept/_components/board/real-market-board-results.tsx',
  import.meta.url
)

function readSource(url) {
  assert.equal(existsSync(url), true, `${url.pathname.split('/').at(-1)} must exist`)
  return readFileSync(url, 'utf8')
}

test('preview board page resolves subject first and delegates ready states to the real market board', () => {
  const source = readSource(pageUrl)

  assert.match(source, /getMarketBoardData/)
  assert.match(source, /resolveSubject/)
  assert.match(source, /const subject = resolveSubject/)
  assert.match(source, /status === 'not_found'/)
  assert.match(source, /status === 'error'/)
  assert.match(source, /<RealMarketBoard\b/)
  assert.match(source, /normalizeReadyFilters/)
  assert.match(source, /pageSize: data\.pagination\.pageSize/)
  assert.match(source, /sourceType: sourceConfig \? filters\.sourceType : ''/)
  assert.match(source, /sourceConfig\?\.fields\.find/)
  assert.match(source, /field\.options\.includes\(value\)/)
  assert.doesNotMatch(source, /sample-data|BoardListController/)
})

test('real market board uses the Studio shell, one GET filter form, and source-type-aware fields', () => {
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
  assert.match(source, /className="min-h-11 pl-9"/)
  assert.match(source, /name="year"/)
  assert.match(source, /name="month"/)
  assert.match(source, /name="grade"/)
  assert.match(source, /name="sourceType"/)
  for (const key of ['source1', 'source2', 'source3', 'source4']) {
    assert.match(source, new RegExp(`\\b${key}\\b`))
  }
  assert.match(source, /activeSourceConfig/)
  assert.match(source, /sourceType === activeSourceConfig\.typeName/)
  assert.match(source, /md:grid-cols-\[200px_minmax\(0,1fr\)\]/)
  assert.match(source, /lg:grid-cols-\[240px_minmax\(0,1fr\)\]/)
  assert.match(source, /lg:gap-x-12/)
  assert.match(source, /md:gap-x-6/)
})

test('board category sidebar renders one mobile accordion navigation and accessible group toggles', () => {
  const source = readSource(sidebarUrl)

  assert.match(source, /'use client'/)
  assert.match(source, /aria-expanded=/)
  assert.match(source, /aria-controls=/)
  assert.match(source, /aria-current=\{isCurrent \? 'page' : undefined\}/)
  assert.match(source, /board-category-\$\{surface\}-group-/)
  assert.match(source, /subject=/)
  assert.match(source, /set\('subject', subject\)/)
  assert.match(source, /<nav aria-label="카테고리 탐색"/)
  assert.match(source, /md:hidden/)
  assert.match(source, /hidden md:block/)
  assert.match(source, /SUBJECT_LABELS\[subject\]/)
  assert.match(source, /surface === 'desktop'/)
  assert.doesNotMatch(source, /group\.isUngrouped \? '기타'/)
  assert.doesNotMatch(source, /entry\.itemCount/)
})

test('board results keep one semantic list and one shared market sample preview dialog', () => {
  const source = readSource(resultsUrl)

  assert.match(source, /'use client'/)
  assert.match(source, /StudioBoardShell/)
  assert.match(source, /StudioPagination/)
  assert.match(source, /navigationText=\{\{/)
  assert.match(source, /first: '<<'/)
  assert.match(source, /previous: '<'/)
  assert.match(source, /next: '>'/)
  assert.match(source, /last: '>>'/)
  assert.match(source, /MarketSamplePreviewDialog/)
  assert.match(source, /from '@\/app\/\(dashboard\)\/market\/\[slug\]\/items\/\[itemId\]\/market-sample-preview-dialog'/)
  assert.equal(
    source.match(/<MarketSamplePreviewDialog\b/g)?.length ?? 0,
    1,
    'rows must share one market sample preview dialog instance'
  )
  assert.match(source, /useRef<HTMLButtonElement \| null>\(null\)/)
  assert.match(source, /samplePreviewItemId/)
  assert.match(source, /setSamplePreviewItemId\(itemId\)/)
  assert.match(source, /sampleTriggerRef\.current = event\.currentTarget/)
  assert.match(source, /aria-current=\{sort === option\.value \? 'page' : undefined\}/)
  assert.match(source, /aria-current=\{pageSize === option \? 'page' : undefined\}/)
  assert.match(source, /<ul\b/)
  assert.match(source, /role="list"/)
  assert.match(source, /md:grid-cols-\[96px_minmax\(0,1fr\)_auto\]/)
  assert.equal(
    source.match(/md:h-\[132px\] md:w-\[94px\] md:self-center/g)?.length ?? 0,
    2,
    'real and fallback thumbnails must share the enlarged centered desktop dimensions'
  )
  assert.match(source, /text-sm font-semibold leading-5/)
  assert.match(source, /col-start-2 justify-self-end md:col-start-3 md:row-start-1 md:self-center/)
  assert.equal(
    source.match(/샘플보기/g)?.length ?? 0,
    1,
    'each row renderer must own one responsive sample action'
  )
  assert.doesNotMatch(source, /FileSearch/)
  assert.doesNotMatch(source, /샘플 보기/)
  assert.doesNotMatch(source, /상세 보기/)
  assert.doesNotMatch(source, /ChevronRight/)
  assert.match(source, /`\/\$\{subject\}\/market\/\$\{categorySlug\}\/items\/\$\{row\.id\}`/)
  assert.doesNotMatch(source, /\/api\/market\//)
})
