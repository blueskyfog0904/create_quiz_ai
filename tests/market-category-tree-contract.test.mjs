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

test("카테고리 관리 화면은 공용 편집기를 쓰고 'N단계' 용어를 쓴다", () => {
  const page = read('src/app/(admin)/admin/market-categories/page.tsx')
  const editor = read('src/components/admin/market-category-tree-editor.tsx')
  assert.match(page, /import \{ MarketCategoryTreeEditor \} from '@\/components\/admin\/market-category-tree-editor'/)
  assert.match(page, /<MarketCategoryTreeEditor key=\{workspaceSubject\} subject=\{workspaceSubject\} \/>/)
  assert.match(editor, /const canAddChild = node\.depth < MARKET_CATEGORY_MAX_DEPTH/)
  assert.match(editor, /window\.confirm\('이 칸을 삭제할까요\?'\)/)
  assert.match(editor, /href=\{`\/categories\/\$\{node\.id\}\?subject=\$\{subject\}`\}/)
  for (const source of [page, editor]) {
    // 화면 문구에 depth1·depth{n} 같은 표기를 쓰지 않는다(코드의 node.depth는 허용)
    assert.doesNotMatch(source, /depth(\d|\{|\$\{)|그룹|항목|카테고리 미지정으로 풀립니다/)
  }
  assert.match(editor, /\{node\.depth\}단계/)
  // 처음에는 모두 접힌 상태(펼친 칸만 기억)
  assert.match(editor, /const \[expandedIds, setExpandedIds\] = useState<Set<string>>\(\(\) => new Set\(\)\)/)
  assert.match(editor, /const collapsed = !expandedIds\.has\(node\.id\)/)
  // 기본 이미지는 2단계부터
  assert.match(editor, /\{node\.depth > 1 \? \(\s+<MarketImageField/)
})

test("'더 자세히 찾기'는 depth2 격자(빈 칸 없음) 아래로 경로의 하위 칸을 줄마다 보여 주고, 사이드바는 depth2까지만 그린다", () => {
  const view = read('src/app/(solvook)/categories/[id]/_components/category-items-view.tsx')
  assert.doesNotMatch(view, /filler/)
  assert.match(view, /grow basis-\[calc\(50%-1px\)\][^"]*md:basis-\[calc\(100%\/var\(--finder-columns\)-1px\)\]/)
  assert.match(view, /const gridColumns = Math\.ceil\(grid\.items\.length \/ gridRows\)/)
  assert.match(view, /rows\.push\(\{ items: children, activeId: path\[index \+ 1\]\?\.id \?\? null, parentId: path\[index\]\.id \}\)/)
  // depth3 이상은 필터: 다시 누르면 해제(부모가 페이지 칸이면 필터 없음, 아니면 부모 칸으로)
  assert.match(view, /const nextFilter = active \? \(level\.parentId === pageId \? null : level\.parentId\) : item\.id/)
  assert.match(view, /aria-pressed=\{active\}/)
  const page = read('src/app/(solvook)/categories/[id]/page.tsx')
  assert.match(page, /const baseId = pathIds\[Math\.min\(pathIds\.length, 2\) - 1\]/)
  assert.match(page, /filtered\.ancestors\.some\(\(ancestor\) => ancestor\.id === category\.id\)/)
  const sidebar = read('src/components/market/MarketCategorySidebar.tsx')
  assert.match(sidebar, /const SIDEBAR_MAX_DEPTH = 2/)
  assert.match(sidebar, /const children = item\.depth < SIDEBAR_MAX_DEPTH \? item\.children : \[\]/)
})
