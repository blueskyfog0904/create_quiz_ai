import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('메가메뉴 API는 왼쪽 목록과 같은 상품 수 계산을 쓰고, 실패하면 수 없이 메뉴만 다시 읽는다', () => {
  const route = read('src/app/api/market/category-menu/route.ts')
  assert.match(
    route,
    /try \{\n\s+return await listMarketCategoryMenu\(true\)\n\s+\} catch \(error\) \{\n\s+console\.error\([^)]*error\)\n\s+return listMarketCategoryMenu\(\)\n\s+\}/,
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
