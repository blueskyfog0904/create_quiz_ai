import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

// docs/market-category-tree-plan.md 8.5(T2): 카테고리 트리 계약
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url))

test('그룹·항목 라우트는 없고 칸(노드) 라우트만 있다', () => {
  for (const path of [
    'src/app/api/admin/market-categories/groups/route.ts',
    'src/app/api/admin/market-categories/groups/[groupId]/route.ts',
    'src/app/api/admin/market-categories/items/route.ts',
    'src/app/api/admin/market-categories/items/[itemId]/route.ts',
  ]) {
    assert.equal(exists(path), false, path)
  }
  const list = read('src/app/api/admin/market-categories/route.ts')
  const node = read('src/app/api/admin/market-categories/[nodeId]/route.ts')
  assert.match(list, /export async function GET/)
  assert.match(list, /export async function POST/)
  assert.match(node, /export async function PATCH/)
  assert.match(node, /export async function DELETE/)
  for (const source of [list, node]) {
    assert.match(source, /revalidateTag\(MARKET_CATEGORY_TREE_CACHE_TAG, \{ expire: 0 \}\)\n\s+revalidateTag\(MARKET_PUBLIC_LIST_CACHE_TAG, \{ expire: 0 \}\)/)
  }
})

test('서버는 하위 상품·하위 칸이 있으면 409, depth5 아래 추가는 400으로 막는다', () => {
  const server = read('src/lib/market-categories-server.ts')
  assert.match(server, /'연결된 상품이 있어 삭제할 수 없습니다\. 비활성화하거나 상품을 옮긴 뒤 삭제해주세요\.'/)
  assert.match(server, /'하위 칸을 먼저 삭제해주세요\.'/)
  assert.match(server, /parent\.depth >= MARKET_CATEGORY_MAX_DEPTH[\s\S]+?new MarketCategoryError\(400, `depth\$\{MARKET_CATEGORY_MAX_DEPTH\} 아래에는 칸을 추가할 수 없습니다\.`\)/)
  assert.doesNotMatch(server, /market_category_groups|createCategoryGroup|createCategoryItem|MegaMenuGroup|listMarketCategoryMenu/)
})

test('캐시 키·태그와 사용처: 카테고리·상세 page는 공유 캐시만 쓰고 layout이 노드 캐시로 404를 판정한다', () => {
  const cache = read('src/lib/market-category-tree-cache.ts')
  assert.match(cache, /listMarketCategoryTree\(true\),\s+\['category-tree-with-counts'\],\s+\{ revalidate: 60, tags: \[MARKET_CATEGORY_TREE_CACHE_TAG\] \}/)
  assert.match(cache, /listMarketCategoryTree\(false\),\s+\['category-tree-nodes'\],\s+\{ revalidate: 60, tags: \[MARKET_CATEGORY_TREE_CACHE_TAG\] \}/)
  assert.match(read('src/lib/market-images.ts'), /export const MARKET_CATEGORY_TREE_CACHE_TAG = 'market-category-tree'/)

  for (const path of ['src/app/(solvook)/categories/[id]/page.tsx', 'src/app/(solvook)/items/[itemId]/page.tsx']) {
    const page = read(path)
    assert.match(page, /from '@\/lib\/market-category-tree-cache'/, path)
    assert.match(page, /getCachedCategoryTree\(\)/, path)
    assert.doesNotMatch(page, /listMarketCategory(Menu|Tree)\(true\)/, path)
  }
  const layout = read('src/app/(solvook)/categories/[id]/layout.tsx')
  assert.match(layout, /getCachedCategoryNodes\(\)/)
  assert.match(layout, /notFound\(/)
})

test('메가메뉴 API는 depth2까지 자른 트리를 보낸다', () => {
  assert.match(read('src/app/api/market/category-menu/route.ts'), /toMegaMenuTree\(await listMarketCategoryTree\(true\), 2\)/)
})

test('카테고리 관리 화면은 공용 편집기를 쓰고 depth 용어만 쓴다', () => {
  const page = read('src/app/(admin)/admin/market-categories/page.tsx')
  const editor = read('src/components/admin/market-category-tree-editor.tsx')
  assert.match(page, /import \{ MarketCategoryTreeEditor \} from '@\/components\/admin\/market-category-tree-editor'/)
  assert.match(page, /<MarketCategoryTreeEditor key=\{workspaceSubject\} subject=\{workspaceSubject\} \/>/)
  assert.match(editor, /const canAddChild = node\.depth < MARKET_CATEGORY_MAX_DEPTH/)
  assert.match(editor, /window\.confirm\('이 칸을 삭제할까요\?'\)/)
  assert.match(editor, /href=\{`\/categories\/\$\{node\.id\}\?subject=\$\{subject\}`\}/)
  for (const source of [page, editor]) {
    assert.doesNotMatch(source, /2단계|3단계|그룹|항목|카테고리 미지정으로 풀립니다/)
  }
})
