import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// docs/market-category-tree-plan.md 6.4·8.3(S1): 상품 상세 주소를 게시판과 무관한 /items/[itemId]로 독립시킨다.
const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path) => readFileSync(join(root, path), 'utf8')

function listSourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return listSourceFiles(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

test('src 어디에서도 예전 상세 주소(게시판 slug가 들어간 주소)를 조립하지 않는다', () => {
  // 게시판 목록 링크(boards/${slug}?…)는 S4까지 남으므로 상세(…/items/) 조립만 검사한다.
  const patterns = [/solvook-concept\/boards\/\$\{[^}]+\}\/items\//, /\/market\/\$\{[^}]+\}\/items\//]
  const offenders = listSourceFiles(join(root, 'src')).flatMap((path) => {
    const source = readFileSync(path, 'utf8')
    return patterns.filter((pattern) => pattern.test(source)).map((pattern) => `${relative(root, path)}: ${pattern}`)
  })
  assert.deepEqual(offenders, [])
})

test('예전 상세 주소 3종은 next.config에서 /items/[itemId]로 307 redirect한다', () => {
  const config = read('next.config.ts')
  const rules = [
    ['/preview/solvook-concept/boards/:slug/items/:itemId', '/items/:itemId'],
    ['/:subject(english|korean)/market/:slug/items/:itemId', '/items/:itemId?subject=:subject'],
    ['/market/:slug/items/:itemId', '/items/:itemId'],
  ]
  for (const [source, destination] of rules) {
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    assert.match(
      config,
      new RegExp(`source: "${escape(source)}",\\s+destination: "${escape(destination)}",\\s+permanent: false,`)
    )
  }
  assert.doesNotMatch(config, /permanent: true/)
})

test('/items/는 전역 헤더·푸터를 생략하는 경로다(헤더 이중 렌더 방지)', () => {
  assert.match(read('src/components/layout/path-aware-site-chrome.tsx'), /pathname\.startsWith\('\/items\/'\)/)
})

test('상세 layout은 id 형식을 검사해 실제 HTTP 404를 보내고, (solvook) not-found 화면이 있다', () => {
  const layout = read('src/app/(solvook)/items/[itemId]/layout.tsx')
  assert.match(layout, /UUID_PATTERN\.test\(itemId\)/)
  assert.match(layout, /notFound\(\)/)
  assert.doesNotMatch(layout, /supabase|market-items-server/)
  assert.ok(existsSync(join(root, 'src/app/(solvook)/items/[itemId]/loading.tsx')))
  assert.match(read('src/app/(solvook)/not-found.tsx'), /페이지를 찾을 수 없습니다\./)
})

test('상세 page는 과목을 상품 기준으로 맞추고 게시판을 보지 않는다', () => {
  const page = read('src/app/(solvook)/items/[itemId]/page.tsx')
  assert.match(page, /isWorkspaceSubject\(subjectParam\)/)
  assert.match(page, /getPublishedMarketItemById\(itemId\)/)
  assert.match(page, /redirect\(`\/items\/\$\{itemId\}\?subject=\$\{item\.workspace_subject\}`\)/)
  assert.match(page, /notFound\(\)/)
  assert.doesNotMatch(page, /getVisibleMarketMenuEntryBySlugForWorkspace|menu_entry_id|slug/)
  for (const loader of [
    'listMarketItemFiles',
    'countActiveMarketItemSamplePages',
    'listMarketSubproductPublicSummaries',
    'getMarketBundlePublicSummary',
    'listCompletedMarketPurchasesForItem',
    'listMarketSubproductDownloadFilesForUser',
    'listMarketItemReviewsForItem',
  ]) {
    assert.match(page, new RegExp(loader))
  }
})

test('상세 page는 카테고리 목록을 60초 공유 캐시로 읽고 count 조회를 직접 부르지 않는다', () => {
  const page = read('src/app/(solvook)/items/[itemId]/page.tsx')
  assert.match(page, /from '@\/lib\/market-category-tree-cache'/)
  assert.doesNotMatch(page, /listMarketCategory(Menu|Tree)\(true\)/)
  assert.match(read('src/app/(solvook)/categories/[id]/page.tsx'), /from '@\/lib\/market-category-tree-cache'/)
  const cache = read('src/lib/market-category-tree-cache.ts')
  assert.match(cache, /unstable_cache\(\s+\(\) => listMarketCategoryMenu\(true\),\s+\['category-menu-with-counts'\],\s+\{ revalidate: 60 \}/)
})

test('예전 preview 상세 page는 새 주소로 보내는 stub이다', () => {
  const stub = read('src/app/preview/solvook-concept/boards/[slug]/items/[itemId]/page.tsx')
  assert.match(stub, /redirect\(`\/items\/\$\{itemId\}/)
  assert.doesNotMatch(stub, /listMarketCategoryMenu|market-material-detail|market-items-server/)
  assert.match(stub, /isWorkspaceSubject\(subjectValue\)/)
})

test('상세 화면은 게시판 prop 없이 홈 > 그룹 > 항목 > 상품 경로를 보인다', () => {
  const detail = read('src/app/preview/solvook-concept/_components/detail/market-material-detail.tsx')
  assert.doesNotMatch(detail, /MarketMenuEntry|category\.slug|category\.title|solvook-concept\/boards/)
  assert.match(detail, /href=\{`\/\?subject=\$\{item\.workspace_subject\}`\}/)
  assert.match(detail, /\{activeGroup\.title\}/)
  assert.match(detail, /href=\{`\/categories\/\$\{activeCategory\.id\}\?subject=\$\{item\.workspace_subject\}`\}/)
})

test('보관함 상세 링크는 상품 상세 가능 여부로 정하고 /items 주소를 쓴다', () => {
  const view = read('src/app/(solvook)/library/_components/library-view.tsx')
  assert.match(view, /const detailHref = row\.detailAvailable\s+\? `\/items\/\$\{row\.itemId\}\?subject=\$\{subject\}`\s+: null/)
  const server = read('src/lib/market-items-server.ts')
  assert.match(server, /detailAvailable: item\?\.status === 'published' && item\.is_active && item\.deleted_at === null/)
})
