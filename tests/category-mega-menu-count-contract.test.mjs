import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('메가메뉴 API는 왼쪽 목록과 같은 상품 수 계산을 쓰고, 실패하면 수 없이 메뉴만 다시 읽는다', () => {
  const route = read('src/app/api/market/category-menu/route.ts')
  assert.match(
    route,
    /try \{\n\s+return toMegaMenuTree\(await getCachedCategoryTree\(\), 2\)\n\s+\} catch \(error\) \{\n\s+console\.error\([^)]*error\)\n\s+return toMegaMenuTree\(await getCachedCategoryNodes\(\), 2\)\n\s+\}/,
  )
  assert.match(route, /const data = await loadCategoryMenu\(\)/)
  assert.match(route, /'Cache-Control': 'public, max-age=60, s-maxage=60'/)
})

test('메가메뉴는 상품 수가 있을 때만 왼쪽 목록과 같은 형식의 (N)을 표시한다', () => {
  const menu = read('src/components/layout/category-mega-menu.tsx')
  assert.match(menu, /interface CategoryMenuItem \{[\s\S]*?itemCount\?: number[\s\S]*?\}/)
  assert.match(menu, /\{item\.itemCount !== undefined \? \(/)
  assert.doesNotMatch(menu, /itemCount \?\? 0/, '수를 못 읽었을 때 (0)으로 보이면 안 된다')
  const countSpan = /<span className="whitespace-nowrap text-\[var\(--studio-muted\)\]">\(\{\(?item\.itemCount(?: \?\? 0\))?\.toLocaleString\(\)\}\)<\/span>/
  assert.match(menu, countSpan)
  assert.match(read('src/components/market/MarketCategorySidebar.tsx'), countSpan)
})

test('메가메뉴는 트리 형태 전용 주소로 읽고, 예전 형태 응답이면 오류 없이 메뉴를 숨긴다', () => {
  const menu = read('src/components/layout/category-mega-menu.tsx')
  assert.match(menu, /fetch\('\/api\/market\/category-menu\?v=tree'\)/)
  assert.match(menu, /if \(!Array\.isArray\(value\)\) return \[\]/)
  assert.match(menu, /Array\.isArray\(\(node as \{ children\?: unknown \}\)\.children\)/)
  assert.match(menu, /Array\.isArray\(group\.children\) \? group\.children : \[\]/)
  assert.match(menu, /href=\{`\/categories\/\$\{group\.id\}\?subject=\$\{activeSubject\}`\}/)
})

test('메가메뉴는 패널을 처음 열 때만 트리를 요청하고, API는 카테고리 트리 공유 캐시를 쓴다', () => {
  const menu = read('src/components/layout/category-mega-menu.tsx')
  assert.match(menu, /if \(open && !requested\) setRequested\(true\)/)
  assert.match(menu, /if \(!requested\) return\n\s+let cancelled = false/)
  assert.match(menu, /\}, \[requested\]\)/)
  const route = read('src/app/api/market/category-menu/route.ts')
  assert.match(route, /from '@\/lib\/market-category-tree-cache'/)
  assert.doesNotMatch(route, /listMarketCategoryTree/)
})
